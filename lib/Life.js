/**
 * 規定数にバックアップを限定しながら、ログローテーションを実施します。
 * Linux にも LogLotate 機能は存在するが、下記ブログにあるように、プロセスの再起動をしないと新しいファイルに書き込まれない問題があり、
 * LogLife はその問題の解決に挑んでいる。
 * https://qiita.com/Esfahan/items/a8058f1eb593170855a1
 */
(g=>{
  
  const NULL = null, TRUE = true, FALSE = false, UNDEF = undefined;
  const fs = require('fs'), cp = require('child_process'), os = require('os'), ds = require('diskstatus');
  const subary = Buffer.subarray ? (buf, s, e)=>e === UNDEF ? buf.subarray(s): buf.subarray(s, e - s): (buf, s, e)=>e === UNDEF ? buf.slice(s): buf.slice(s, e);
  const YMDHMS = require('./_YMDHMS');
  const ActionType = {
    Sweep: 'sweep',
    Rotate: 'rotate'
  };
  const Default = {
    span: 7 * 4 * 24 * 60 * 60 * 1000,
    cap: 100 * Math.pow(1024, 2),
    stock: 5,
    dirc: function(){
      
      // !! ATTENTION !! CANNOT USE ARROW FUNCTION BECAUSE OF USING "this"
      // Get directory for the log
      const fp = this.filepath, fpa = fp.split('/'); fpa.pop();
      return fpa.length == 0 ? '.': fpa.join('/');
      
    },
    head: function() {
      
      // !! ATTENTION !! CANNOT USE ARROW FUNCTION BECAUSE OF USING "this"
      // Get full path without ext
      // e.g.) /home/ystskm/nohup.out => /home/ystskm/nohup
      const fp = this.filepath, fpa = fp.split('/'), fna = fpa.pop().split('.');
      if(fna.length == 1) { fna.push(fna[0]); }
      return fpa.concat( fna.slice(0, -1).join('.') ).join('/');
      
    },
    tail: ()=>('.gz'),
    file: function(n, ext) {
      // !! ATTENTION !! CANNOT USE ARROW FUNCTION BECAUSE OF USING "this"
      const life = this;
      return [ life.head(), YMDHMS(n), ext ].join('.');
    },
    kick: function(n) {
      // !! ATTENTION !! CANNOT USE ARROW FUNCTION BECAUSE OF USING "this"
      const life = this, opts = life.options;
      if(n.getTime() - life.prev > life.span) {
        return TRUE;
      }
      // outLog( 'Not yet (span)', n.getTime() - life.prev, life.span );
      switch(life.action) {

      case ActionType.Sweep:
        return FALSE;
        
      case ActionType.Rotate:
      default:
        return life.size().then(size=>{
          // outLog( 'Not yet (size)', size, life.cap );
          return size > life.cap;
        });

      }
    },
    sort: function(t1, t2) {
      return t1 < t2 ? -1: 1;
    }
  }

  const Lifes = [ ], FDs = { }, report = { DS_count: 0, RO_count: 0 };
  const LifeStatic = {
    rotate
  };
  const LifeProtos = {
    
    check,
    maintain,
    cleanup,
    size,
    list,
    send,
    close,
    
    renewalStreams,
    createReadStream,
    createWriteStream,
    createSymlink
    
  };
  Object.keys( LifeStatic ).forEach(k=>Life[ k ] = LifeStatic[ k ]);
  Object.keys( LifeProtos ).forEach(k=>Life.prototype[ k ] = LifeProtos[ k ]);
  process.on('exit', ()=>Lifes.forEach( x=>x.close() ));
  
  module.exports = Life;
  return // <-- END_OF_MAIN <--
  
  /**
   * @constructor Life
   * @param filepath
   * @param options
   * @returns
   * @explain Life is an constructor with customizable prototypes.
   *  "dirc", "head", "tail", "file", "kick" and "sort"
   */
  function Life(filepath, options) {
  
    const life = this, opts = life.options = options || { }
    let fp = filepath;
    let is_new_fd = TRUE;
    let fp_trash;

    if(fp == 'process.stdout' || fp == 'process.stderr') {
      life.type = 'process';
      fp = [ process.cwd(), fp + '.out' ].join('/');
    } else {
      life.type = 'file';
    }
    
    life.filepath = fp;
    life.born = Date.now();
    life.prev = life.sent = life.born;
  
    ['span', 'cap', 'stock'].forEach(k=>{
      life[ k ] = _unit2Int( opts[ k ] || Default[ k ] );
    });
    
    ['dirc', 'head', 'tail', 'file', 'kick', 'sort'].forEach(k=>{
      let func = opts[ k ] || Default[ k ], v = func;
      if(!isFunction(func)) {
        func = ()=>v;
      }
      life[ k ] = func.bind(life);
    });
    
    // Initialize LogLife action
    let action = opts.action;
    if(action == NULL) {
      switch(TRUE) {
      
      case opts.directory != NULL:
        action = ActionType.Sweep;
        break;
      
      default:
        action = ActionType.Rotate;
        break;
        
      }
    }
    life.action = action;
    
    // If same filepath is still open, close immediately
    if(opts.reflesh && FDs[fp] != NULL) {
      try { fs.closeSync( FDs[fp] ) } catch(e) { } delete FDs[fp];
    }
    
    life.fd = NULL;
    life.rs = life.ws = NULL;
    switch(action) {
    
    case ActionType.Sweep:
      // (19/11/20 sakamoto) new feature: Directory sweeper
      life.ready = Promise.resolve();
      break;
    
    case ActionType.Rotate:
    default:
      life.ready = Promise.resolve().then(()=>{
        Lifes.push(life);
        if(life.fd = FDs[ fp ]) {
          is_new_fd = FALSE;
          return;
        }
        if(life.type == 'process') {
          life.rs = FDs[ fp ] = process[ filepath.split('.').pop() ];
          is_new_fd = FALSE;
          return;
        }
        return new Promise((rsl, rej)=>{
          
          // Open file and get fd, mode "w+" for ftruncate
          fs.open(fp, 'w+', (er, fd)=>er ? rej(er): rsl(FDs[ fp ] = life.fd = fd));
          
        });
      }).then(()=>{
        return life.renewalStreams();
      }).then(()=>{ 
        return; // !! IMPORTANT !! DONNOT /dev/null for reboot process (cannot inherit fd)
        if(!is_new_fd) {
          return;
        }
        return new Promise(function(rsl, rej) { 
          
          // Move file and lost the file position for the fd.
          fp_trash = fp + '.trash';
          fs.rename(fp, fp_trash, function(er) { er ? rej(er): rsl(); });
          
        });
      }).then(function() { return; // !! IMPORTANT !! DONNOT /dev/null for reboot process (cannot inherit fd)
        if(!is_new_fd) {
          return;
        }
        return new Promise(function(rsl, rej) { 
          
          // Remove file and /dev/null for the fd
          fs.unlink(fp_trash, function(er) { er ? rej(er): rsl(); });
          
        });
      }).then(()=>{
        outLog(`Planning successfully for: ${fp}, (fd: ${life.fd}=>${life.ws.fd})`);
      })['catch'](e=>{
        outLog(`Planning failed, log-life stopped silently for: ${fp}`, e);
        if(life.readTimer) { 
          clearInterval(life.readTimer);
          life.readTimer = NULL;
        }
        life.fd = NULL;
        life.rs = life.ws = NULL;
        life.ready = Promise.reject(e);
      });
    
    }
    
    
  }
  
  /**
   * 
   * @prototype Life
   * @param procTime
   * @returns
   */
  function check(procTime, checkIndex, options = { }) {
    const life = this, opts = life.options;
    return Promise.resolve(life.ready).then(()=>{
      return life.kick( procTime = procTime || new Date() );
    }).then(operate=>{
      // outLog('result of check: ' + rotate + ', for: ' + life.filepath);
      if(operate !== TRUE) { 
        return; 
      }
      switch(life.action) {
      
      case ActionType.Sweep:
        return life.cleanup(procTime);
        
      case ActionType.Rotate:
      default:
        return life.maintain(procTime);

      }
    })['catch'](e=>{
      outLog('Unexpected check or action error occurs?', e);
      switch(life.action) {
      
      case ActionType.Sweep:
        return;
        
      case ActionType.Rotate:
      default:
        return life.renewalStreams();
        
      }
    }).then(()=>{
      // (19/11/21 sakamoto) new feature: os reporting, execute only the first check Life instance
      const r_opts = opts.report;
      if(r_opts == NULL || checkIndex != 0) {
        return;
      }
      let next = new Date(life.sent);
      let time = (r_opts.time || '00:00').split(':').map(t=>parseInt(t));
      next.setDate(next.getDate() + (r_opts.span || 1));
      next.setHours(time[0] || 0);
      next.setMinutes(time[1] || 0);
      next.setSeconds(0);
      next.setMilliseconds(0);
      outLog(`Compare procTime:${procTime}, next: ${next}`);
      if(next.getTime() < procTime) {
        
        life.sent = next.getTime();
        reportOs(life); // needless to wait
        
      }
    }).then(()=>{
      life.prev = procTime;
    });
  }
  
  /**
   * 
   * @internal
   */
  function reportOs(life) {
    const opts = life.options;
    return Promise.resolve().then(()=>{
     return ds.checkPart().then( r=>ds.likely(r) );
    }).then(info=>{

      const use = parseInt( (info.used / info.size ) * 100 );
      const sbj = `#${++report.DS_count} [LogLife] Disc space notify - ${use}% (${os.hostname()})`;
      const bdy = [ ];
      bdy.push(`DATE  : ${new Date().toGMTString()}`);
      bdy.push(`DISK (${info.filesystem}): ${info.size}, used=${info.used}, ratio=${info.ratio}`);
      return life.send(sbj, bdy.join("\n"));

    })['catch'](e=>{
      outLog('[reportOs] Occurs error:', e);
      // throw e; => Ignore errors
    });
  }
  
  /**
   * 
   * @internal
   */
  function reportRotate(life, OLD_wp) {
    const opts = life.options;
    return Promise.resolve().then(()=>{
      return ds.checkPart().then( r=>ds.likely(r) );
    }).then(info=>{

      const use = parseInt( (info.used / info.size ) * 100 );
      const sbj = `#${++report.RO_count} [LogLife] Rotate notify - ${life.filepath} (${os.hostname()})`;
      const bdy = [ ];
      bdy.push(`DATE  : ${new Date().toGMTString()}`);
      bdy.push(`ROTATE: ${OLD_wp} (${fs.statSync(OLD_wp).size}byte) => ${life.writepath}` );
      return life.send(sbj, bdy.join("\n"));

    })['catch'](e=>{
      outLog('[reportRotate] Occurs error:', e);
      // throw e; => Ignore errors
    });
  }
  
  /**
   * 
   * @prototype Life
   * @explain renewal streams and create log-archive
   * @param procTime
   * @returns
   */
  function maintain(procTime) {
    const life = this, opts = life.options, fp = life.filepath;
    let wp = life.writepath, gzip, gz;
    let myturn;
    outLog('maintain BEGIN for #' + fp);
    // 1) Create backup gz
    // 2) Remove gzipped file
    // 3) Preserved gzip maintenance
    if(wp == NULL) {
      return Promise.resolve(); // Nothing to do.
    }
    return life.ready = Promise.resolve(life.ready).then(()=>{
    
      if(life.procTime) {
        throw new Error(`[${fp}] Another maintenance is in-porcess.( starts at: ${life.procTime} )`);
      }
      myturn = TRUE;
      life.procTime = procTime;
    
    }).then(()=>{
      return life.renewalStreams();
    }).then(()=>{
      // 1) Create backup gz
      // (1-1)
      return new Promise((rsl, rej)=>{
        
        gz = fs.createWriteStream( wp.split('.').slice(0, -1).join('.') + life.tail() );
        gz.on('open', rsl).on('error', rej);
        
      });
    }).then(()=>{
      // (1-2)
      return new Promise((rsl, rej)=>{
        
        gzip = require('zlib').createGzip();
        fs.createReadStream(wp).pipe(gzip).pipe(gz);
        gz.on('close', rsl).on('error', rej);
        
      });
    }).then(()=>{
      // 2) Remove archived file
      return new Promise(rsl=>fs.unlink(wp, rsl));
    }).then(()=>{
      // 3) Preserved archives maintenance
      return life.list().then(a=>{
  
        if(a.length <= life.stock) {
          return;
        }
        a.slice(0, life.stock * -1).forEach(fnam=>{
          fs.unlinkSync([ life.dirc(), fnam ].join('/'));
        });

      })['catch']( Function() );
    }).then(()=>{
      if(myturn) {
        delete life.procTime;
      }
    })['catch'](e=>{
      outLog(`[${fp}] maintain error:`, e);
      if(myturn) {
        delete life.procTime;
      }
      throw e;
    });
  }

  /**
   * 
   * @prototype Life
   * @explain sweep a directory
   * @param procTime
   * @returns
   */
  function cleanup(procTime) {
    const life = this, opts = life.options, fp = life.filepath;
    let myturn;
    outLog(`cleanup BEGIN for #${fp}`);
    // 1) Drain files in the directory
    // 2) Remove file 
    return life.ready = Promise.resolve(life.ready).then(()=>{
    
      if(life.procTime) {
        throw new Error(`[${fp}] Another cleanup is in-porcess.( starts at: ${life.procTime} )`);
      }
      myturn = TRUE;
      life.procTime = procTime;
    
    }).then(()=>{
      let normalize = opts.normalize;
      let timePos = opts.timePosition || { }; // { from: }
      let timeStr, timeObj;
      fs.readdirSync(opts.directory).forEach(fnam=>{

        let cfp = [ opts.directory, fnam ].join('/');
        if(!_isFile(cfp)) {
          return;
        }
        let subn, subInt = (fr, to)=>{
          return parseInt(to == NULL ? timeStr.substr(fr): timeStr.substr(fr, to));
        };
        if(isFunction(normalize)) {
          subn = normalize(fnam);
        } else {
          subn = fnam;
        }
        if(!subn) {
          return; // NOT TARGET
        }
        if(timePos.from) {
          timeStr = subn.substr(timePos.from);
          timeObj = new Date(timeStr.length == 8 ?subInt(0, 4): (2000 + subInt(0, 2)), subInt(-4, 2), subInt(-2));
        } else {
          timeObj = NULL;
        }
        if(timeObj == NULL || ( timeObj.getTime() < procTime.getTime() - _unit2Int(opts.span || life.span) )) {
          outLog(`remove on cleanup: ${fnam}`);
          fs.unlink(cfp, ()=>{ /*NEEDLESS TO WAIT*/ });
        }

      });
    }).then(()=>{
      if(myturn) {
        delete life.procTime;
      }
    })['catch'](e=>{
      outLog(`[${fp}] cleanup error:`, e);
      if(myturn) {
        delete life.procTime;
      }
      throw e;
    });
  }
  
  /**
   * 
   * @prototype Life
   * @returns
   */
  function size() {
    const life = this, opts = life.options;
    const wp = life.writepath;
    return new Promise((rsl, rej)=>fs.stat(wp, (er, stat)=>{
        
      // outLog('size result:', wp, stat);
      er ? rej(er): rsl(stat.size);
        
    }));
  }
  
  /**
   * 
   * @prototype Life
   * @returns
   */
  function list() {
    const life = this;
    return new Promise((rsl, rej)=>{
      const fd = life.dirc(), wp = life.writepath;
      const fh = life.head().substr(fd.length + 1); // /home/ystskm/nohup.out => nohup
      fs.readdir(fd, (er, a)=>{
  
        if(er) {
          return rej(er);
        }
        const t = life.tail();
        // outLog('list result for: ' + life.filepath, a, ', filter by tail: ' + t);
        rsl( a.filter(fnam=>{
          if(fnam.indexOf(fh) !== 0) {
            return FALSE;
          }
          if(fnam.slice(-1 * t.length) != t) {
            return FALSE;
          }
          return TRUE;
        }).sort(life.sort) );
  
      });
    });
  }
  
  /**
   * 
   * @prototype Life
   */
  function send(sbj, bdy) {
    const life = this, opts = life.options;
    let reporter, r_opts = opts.report || { }, message = { };
    if( !r_opts.reporter && !r_opts.server ) return Promise.resolve(FALSE);
    return new Promise((rsl, rej)=>{
      report.count, report.options = r_opts;
      try {
        switch(r_opts.reporter) {

        case 'http':
          reporter = byHttp();
          break;

        case 'mailer':
        default:
          reporter = byMail();

        }
      } catch(e) {
        outLog('reporter is disabled. reason: ' + (e ? e.message || e: 'unknown'), sbj, bdy);
        rsl();
        return;
      }
      if(is('string', sbj)) {
        message.subject = sbj
      } else {
        message = sbj;
      }
      if(r_opts.from) {
        message.from = [ ].concat(message.from || [ ], r_opts.from);
      }
      if(r_opts.to) {
        message.to   = [ ].concat(message.to   || [ ], r_opts.to  );
      }
      outLog('reporter:', message, bdy);
      try {
        reporter.message(message).body(bdy).send(er=>{
          let reply, replyCode;
          if(er) {
            reply = er.reply || { }, replyCode = reply.code;
            if(replyCode != 200) {
              return rej(er);
            }
          }
          // https://www.asahi-net.or.jp/~ax2s-kmtn/ref/smtp.html
          return rsl();
        });
      } catch(e) {
        outLog('reporting is failed. reason: ' + (e ? e.message || e: 'unknown'));
        rsl();
        return;
      }
    });
    function byMail() {
      
      try {
        return require('mail').Mail(r_opts.server);
      } catch(e) {
        outLog('Unexpected error for report and returns ignored sender: ' + e.message);
        return new DummyReporter();
      }
      
    } // ( <-- function byMail() { ... } <-- ): from foonyah/index.js
    function byHttp() {

      Object.assign(HTTPagent.prototype, { message, body, send });
      return new HTTPagent();

      // HTTP agent is the same API as "mail" module
      // for non-change reporting call.
      function HTTPagent() {
        const agent = this;
        agent.settings = {

          secure: r_opts.secure || FALSE,
          hostname: r_opts.host || r_opts.hostname,
          port: r_opts.port || 80,
          path: r_opts.path || '/report',
          method: r_opts.method || 'POST',
          headers: r_opts.headers || {
            'Content-Type': 'application/json',
          }

        };
      }

      function message(param) {
        const agent = this;
        return agent._message = param, agent;
      }

      function body(contents) {
        const agent = this;
        return agent._body = contents, agent;
      }

      function send(callback) {
        const agent = this;
        if(!f.isFunction(callback)) callback = f.noop();
        return new Promise((rsl, rej)=>{

          const settings = agent.settings;
          const c_ty = settings.secure ? 'https': 'http';
          const req = require(c_ty).request(settings, res=>{

            res.setEncoding('utf8');
            res.on('data', d=>{
              // Only for start consuming.
              // http://stackoverflow.com/questions/23817180/node-js-response-from-http-request-not-calling-end-event-without-including-da
            });
            res.on('end', rsl);

          });

          // TODO Error handling
          req.on('error', rej);

          // write data to request body
          req.write(JSON.stringify({
            message: agent._message,
            body: agent._body
          }));
          req.end();

        }).then(()=>{
          outLog('[byHttp] No more data in response.');
          callback();
        })['catch'](e=>{
          outLog('[byHttp] problem with request:', e);
          callback(e)
        });
      }

    } // ( <-- function byHttp() { ... } <-- ): from foonyah/index.js
  }
  
  /**
   * 
   * @returns
   */
  function renewalStreams(symlink) {
    const life = this, opts = life.options;
    let fp = life.filepath;
    let OLD_wp;
    outLog('renewalStreams:', life.filepath);
    return Promise.resolve().then(()=>{
      if(life.type == 'process') {
        return;
      }
      const fd_size = fs.fstatSync(life.fd).size;
      if(life.ws == NULL) {
        return; // => without writable end
      }
      return new Promise((rsl, rej)=>{

        OLD_wp = life.writepath;
        clearInterval(life.readTimer);
        life.readTimer = NULL;

        // (2024.03.09 sakamoto) life.offsetPosition が初期で、全量をバックアップする仕様がよくない。（再起動が続いた時、ログがたまる。）
        // life.offsetPosition が NULL の時は現状のサイズから先を取得する。
        //   => ここは関係なく、read() と truncate の関係性が悪かったことが原因だった。
        let time = new Date();
        let size = fd_size - (life.offsetPosition || fd_size);
        let smax = Default.cap;
        let rbuf, rext;
        if(size > smax) {
          life.offsetPosition += (size - smax);
          size = smax;
        }
        if(size > 0) {

          // outLog('Goto remains output!');
          fs.readSync(life.fd, rbuf = Buffer.alloc(size), 0, size, life.offsetPosition);
          life.ws.write(rbuf);
          life.ws.end(`${time.toGMTString()} - [LogLife] Close write stream.`);
          // => write remain buffer and sign

        }
        // outLog('Goto truncate!');
        // https://milestone-of-se.nesuke.com/sv-basic/linux-basic/logrotate/
        // copytruncate
        // 更新中のログファイルを別名に mv するのではなく、cp した後に更新中のログファイルを空にします。
        // これはログファイルを Open し続ける(i-node番号の変化に対応できない)アプリケーションで効果的ですが、
        // cp してから空にするまでの間に書き込まれたログは失われてしまいます。
        // これが指定された場合は create は無視されます。
        fs.ftruncate(life.fd, er=>er ? rej(er): rsl());

      }).then(()=>{

        return confirmTrancate(life.fd, size);
        // => check trancated and retry if not enough

      });
    }).then(()=>{
      return life.createWriteStream(symlink);
    }).then(()=>{
      return life.createReadStream();
    }).then(()=>{
      if(OLD_wp) reportRotate(life, OLD_wp);
    });
  }
  
  /**
   * 
   * @returns
   */
  function createReadStream() {
    const life = this, opts = life.options;
    let fp = life.filepath;
    return Promise.resolve().then(()=>{
      const rs = life;
      switch(life.type) {
      
      case 'process': 
        // !! IMPORTANT !! stdxxx is both readable and writable!
        rs._write = (function (buf, enc, cb) {
          life.ws.write(buf);
          life.rs._writeGeneric(FALSE, buf, enc, cb);
        }).bind(rs);
        break;

      case 'file':
      default:
        return new Promise((rsl, rej)=>{
        
          // Copy reading chunk buffer gradually
          const once = 256 * 1024, intv = 3 * 1000;
          if(life.readTimer) {
            clearInterval( life.readTimer );
          }
          // Create readStream expects the truncated log file
          life.offsetPosition = 0;
          life.readTimer = setInterval(()=>{
            let buf = Buffer.alloc(once);
            fs.read(life.fd, buf, 0, once, life.offsetPosition, (er, byteRead)=>{

              // outLog('Goto read buffer size: ' + once, life.offsetPosition);
              // outLog('  ... results: ' + byteRead, er, '=>' + life.writepath + ' (fd:' + life.ws.fd + ')');
              if(er) {
                outLog('Read error:', er);
                return;
              }
              if(byteRead == 0) {
                return;
              }

              // buf は広めにとっているので、少ない部分は削除
              buf = subary(buf, 0, byteRead);

              // (2024.03.09 sakamoto) byteRead と offsetPosition の関係が整合しなくなって読めなくなることがあるのか？
              //  => trancate 中に read することで、truncate が停止し、その（無効データ）部分も書き込んでしまうことが原因のよう。
              const s_pos = buf.lastIndexOf(0) + 1;
              const w_buf = subary(buf, s_pos);
              if(s_pos != 0) {
                outLog(`Reading ${life.filepath} buffer includes 0 at: ${s_pos}/${byteRead}`);
              }
              life.offsetPosition += s_pos + w_buf.length;
              life.ws.write(w_buf);
              
            });
          }, intv);
          rsl();
        
        });
      }
    }).then(()=>{
      outLog(`Open readStream: ${life.filepath}`);
    });
  }
  
  /**
   * 
   * @returns
   */
  function createWriteStream(symlink) {
    const life = this, opts = life.options;
    let fp = life.filepath, wp;
    return Promise.resolve().then(()=>{
      wp = life.writepath = life.file(new Date(), 'log');
    }).then(()=>{
      if(life.ws != NULL) try { life.ws.close(); } catch(e) { /*IGNORE*/ } // => lose the old stream
    }).then(()=>{
      return new Promise((rsl, rej)=>{

        life.ws = fs.createWriteStream(wp, {
          flags: 'w+',
          autoClose: FALSE
        }).on('open', rsl).on('error', rej);
        
        life.ws.on('drain', ()=>{
          // outLog('Writable stream writable: ' + wp, life.writepath);
        });
        life.ws.on('finish', ()=>{
          // outLog('Writable stream finished: ' + wp, life.writepath);
        });
        life.ws.on('close', ()=>{
          outLog(`Writable stream closed: ${wp}`, life.writepath);
        });

      });
    }).then(()=>{
      if(symlink) life.createSymlink();
    }).then(()=>{
      outLog(`Open writeStream: ${wp}`, life.writepath);
    });
  }
  
  /**
   * 
   * @returns
   */
  function createSymlink() {
    const life = this, opts = life.options;
    let fp = life.filepath;
    return Promise.resolve().then(()=>{
      if(life.type == 'process') { return; }
      return new Promise(rsl=>{ 
        
        // remove Symlink space at filepath if exist
        fs.unlink(fp, rsl);
        
      });
    }).then(()=>{
      if(life.type == 'process') { return; }
      return new Promise(rsl=>{ 
        
        // create Symlink at filepath to writepath
        fs.symlink(life.writepath, fp, er=>{
          if(er) { outLog('Failed to create symlink:', er); } rsl();
        });
        
      });
    });
  }
  
  /**
   * 
   * @returns
   */
  function close() {
    const life = this, opts = life.options;
    let fp = life.filepath;
    clearInterval( life.readTimer );
    if(life.rs) try { 
      life.rs.close(); outLog('done readable close', fp);
      life.rs = NULL;
    } catch(e) { outLog('failed to close readable', fp, e); /*IGNORE*/ };
    if(life.ws) try { 
      life.ws.close(); outLog('done writable close', fp);
      life.ws = NULL;
    } catch(e) { outLog('failed to close writable', fp, e); /*IGNORE*/ };
    if(life.fd) try { 
      fs.closeSync(life.fd); outLog('done descriptor close', fp);
      life.fd = NULL; delete FDs[fp];
    } catch(e) { outLog('failed to close descriptor', fp, e); /*IGNORE*/ }
  }
  
  /**
   * 
   * @returns
   */
  function rotate(fp, jFunc, options) {
    const stamp = new Date();
    const opts = Object.assign({ }, options || { });
    let fd, fd_stat, fd_size, fp_copy;
    let rs, ws;
    return Promise.resolve().then(()=>new Promise((rsl, rej)=>{
      fs.open(fp, 'a+', (er, rd)=>er ? rej(er): rsl(fd = rd));
    })).then(()=>{
      fd_stat = fs.fstatSync(fd), fd_size = fd_stat.size;
      return isFunction(jFunc) ? jFunc.call(fd, fd_stat): TRUE;
    }).then(j=>{

      if(j !== TRUE) {
        fs.closeSync(fd);
        return FALSE;
      }
      fp_exts = opts.ext || ('.' + fp.split('.').pop());
      fp_copy = `${fp.split('.').slice(0, -1).join('.')}_${YMDHMS(stamp)}${fp_exts}`; // 
      rs = fs.createReadStream(fp, {
        fd, start: 0, end: fd_size,
        autoClose: FALSE, emitClose: FALSE
      });
      ws = fs.createWriteStream(fp_copy, {
        fd: NULL, flags: 'w',
        autoClose: TRUE, emitClose: TRUE
      });
      return new Promise((rsl, rej)=>{

        // (1) copy fd 
        rs.on('error', e=>{
          outLog('(rotate.copy) rs error', e);
          rej(e);
        });
        rs.on('readable', ()=>{
          // outLog('(rotate.copy) rs readable');
          // fd is already opened for fstatSync and should kick read() by hand.
          while(rs.read());
        });
        rs.on('end', ()=>{
          // outLog('(rotate.copy) rs end');
        });

        ws.on('error', e=>{
          outLog('(rotate.copy) ws error', e);
          rej(e);
        });
        ws.on('pipe', src=>{
          // outLog('(rotate.copy) ws pipe:', src === rs);
        });
        ws.on('close', ()=>{
          // outLog('(rotate.copy) ws close');
          rsl();
        });

        // Implement pipe condition
        rs.pipe(ws);
 
      }).then(()=>new Promise((rsl, rej)=>{

        // (2) truncate fd
        // mongodb の場合、truncate はされるが、cursor（書き出し位置）が維持されて大きなスペースができる場合がある。
        // いつもではないので、open したタイミングによるものと考えられる。
        fs.ftruncate(fd, er=>er ? rej(er): rsl());

      })).then(()=>{

        return confirmTrancate(fd, fd_size);
        // => check trancated and retry if not enough

      }).then(()=>new Promise((rsl, rej)=>{

        // (3) close fd
        fs.close(fd, er=>er ? rej(er): rsl());

      })).then(()=>{
        // returns the rotate result
        return { src: fp, dst: fp_copy, ext: fp_exts, stamp };
      });

    })['catch'](e=>{
      if(e) {
        if(e.code == 'EISDIR') return FALSE; // IGNORE ERROR
      }
      try { fs.closeSync(fd); } catch(e) { /*IGNORE*/ }
      try { if(rs && !rs.destroyed) rs.destroy(); } catch(e) { /*IGNORE*/ }
      try { if(ws && !ws.destroyed) ws.destroy(); } catch(e) { /*IGNORE*/ }
      throw e;
    });
  }

  /**
   * @returns
   */
  function confirmTrancate(fd, cut_size) {
    // ここでサイズが前回サイズを下回っていることを確認する。
    // 前回のスタート地点から現在サイズまでを取得し、ftruncate 後に書き戻す
    const MAX_RETRY = 8;
    let cnt_retry = 0;
    return new Promise((rsl, rej)=>{
      outLog(`(pending) Extecute confirmTrancate ...`);
      const once =()=>{
        const cur_size = fs.fstatSync(fd).size;
        if(cnt_retry == MAX_RETRY) {
          outLog(`(bad-resolve) Cannot confirm trancated: cut_size=${cut_size}, cur_size=${cur_size}`);
          rsl();
          return;
        }
        cnt_retry++;
        if(cur_size < cut_size) {
          // trancate 完了確認条件
          outLog(`(good-resolve) Comfirmed trancated on confirmTrancate: cut_size=${cut_size}, cur_size=${cur_size}`);
          rsl();
          return;
        }
        const size = cur_size - cut_size;
        let rbuf;
        Promise.resolve().then(()=>{
          fs.readSync(life.fd, rbuf = Buffer.alloc(size), 0, size, cut_size);
        }).then(()=>new Promise((rsl, rej)=>{
          fs.ftruncate(fd, er=>er ? rej(er): rsl());
        })).then(()=>{
          fs.writeSync(life.fd, rbuf, 0);
        }).then(()=>{
          setTimeout(once, parseInt(Math.random() * 320));
        })['catch'](e=>{
          outLog(`(resolve) Error on confirmTrancate:`, e);
          rsl();
        });
      };
      once();
    });
  }

  /**
   * 
   * @returns
   */
  function DummyReporter() {
    const rep = this;
    rep.message = ()=>{
      outLog('[DummyReporter] message', arguments[0]);
      return rep;
    };
    rep.body = ()=>{
      outLog('[DummyReporter] body', arguments[0]);
      return rep;
    };
    rep.send = cb=>{
      outLog('[DummyReporter] send');
      cb(NULL, { code: 200 });
    };
  }
  
  
  // ----- //
  /**
   * @ignore
   */
  function _isFile(x) {
    return fs.statSync(x).isFile();
  }
  /**
   * @ignore
   */  
  function _unit2Int(s) {
  
    if(typeof s == 'number')
      return s;
  
    let mtc;
    s = String(s);
  
    if(mtc = s.match(/(k(b)?(yte)?s?)$/i)) {
      return parseFloat(s.replace(mtc[1], '')) * 1000;
    }
    if(mtc = s.match(/(M(b)?(yte)?s?)$/i)) {
      return parseFloat(s.replace(mtc[1], '')) * Math.pow(1000, 2);
    }
    if(mtc = s.match(/(G(b)?(yte)?s?)$/i)) {
      return parseFloat(s.replace(mtc[1], '')) * Math.pow(1000, 2);
    }
  
    if(mtc = s.match(/(sec(ond)?s?)$/i)) {
      return parseFloat(s.replace(mtc[1], '')) * 1000;
    }
    if(mtc = s.match(/(min(ute)?s?)$/i)) {
      return parseFloat(s.replace(mtc[1], '')) * 60 * 1000;
    }
    if(mtc = s.match(/(h(our)?s?)$/i)) {
      return parseFloat(s.replace(mtc[1], '')) * 60 * 60 * 1000;
    }
    if(mtc = s.match(/(d(ay)?s?)$/i)) {
      return parseFloat(s.replace(mtc[1], '')) * 24 * 60 * 60 * 1000;
    }
    if(mtc = s.match(/(w(eek)?s?)$/i)) {
      return parseFloat(s.replace(mtc[1], '')) * 7 * 24 * 60 * 60 * 1000;
    }
    throw new Error('Unexpected string expression: ' + s)
  
  }

  // ----- //
  function outLog() {
    console.log.apply(console, _getLogArgs(arguments));
  }
  function outWarn() {
    console.warn.apply(console, _getLogArgs(arguments));
  }
  function _getLogArgs(a) {
    var args = Array.prototype.slice.call(a);
    args.unshift(new Date().toGMTString() + ' - [LogLife.Life]');
    return args;
  }
  
  // ----- //
  function is(ty, x) {
    return typeof x == ty;
  }
  function isFunction(x) {
    return is('function', x);
  }
  function isArray(x) {
    return Array.isArray(x);
  }

})(global);
