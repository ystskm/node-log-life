/**
 * 規定数にバックアップを限定しながら、ログローテーションを実施します。
 * Linux にも LogLotate 機能は存在するが、下記ブログにあるように、プロセスの再起動をしないと新しいファイルに書き込まれない問題があり、
 * LogLife はその問題の解決に挑んでいる。
 * https://qiita.com/Esfahan/items/a8058f1eb593170855a1
 */
var NULL = null, TRUE = true, FALSE = false, UNDEF = undefined;
(function() {
  
  var fs = require('fs'), cp = require('child_process'), os = require('os');
  var zlib = require('zlib');
  var YMDHMS = require('./_YMDHMS');
  var Default = {
    span: 7 * 4 * 24 * 60 * 60 * 1000,
    cap: 100 * Math.pow(1024, 2),
    stock: 5,
    dirc: function() {
      
      // Get directory for the log
      var fp = this.filepath, fpa = fp.split('/'); fpa.pop();
      return fpa.length == 0 ? '.': fpa.join('/');
      
    },
    head: function() {
      
      // Get full path without ext
      // e.g.) /home/ystskm/nohup.out => /home/ystskm/nohup
      var fp = this.filepath, fpa = fp.split('/'), fna = fpa.pop().split('.');
      if(fna.length == 1) { fna.push(fna[0]); }
      return fpa.concat( fna.slice(0, -1).join('.') ).join('/');
      
    },
    tail: function() {
      return '.gz';
    },
    file: function(n, ext) {
      return [ this.head(), YMDHMS(n), ext ].join('.');
    },
    kick: function(n) {

      var life = this;
      if(n.getTime() - life.prev > life.span) {
        return TRUE;
      } else {
        // outLog( 'Not yet (span)', n.getTime() - life.prev, life.span );
      }
      return life.size().then(function(size) {
        // outLog( 'Not yet (size)', size, life.cap );
        return size > life.cap;
      });

    },
    sort: function(t1, t2) {
      return t1 < t2 ? -1: 1;
    }
  }

  var FDs = { };
  var LifeProtos = {
    
    check: check,
    maintain: maintain,
    size: size,
    list: list,
    
    renewalStreams: renewalStreams,
    createReadStream: createReadStream,
    createWriteStream: createWriteStream,
    createSymlink: createSymlink,
    
  };
  Object.keys( LifeProtos ).forEach(function(k) {
    Life.prototype[ k ] = LifeProtos[ k ];
  });
  process.on('exit', function() {
    Object.keys(FDs).forEach(function(fp) {
      try { fs.closeSync( FDs[fp] ); } catch(e) { outLog('Cannot close fd for:' + fp); }
    });
  });
  
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
  
    var life = this, opts = life.options = options || { }
    var fp = filepath;
    var is_new_fd = TRUE;
    var fp_trash;
    
    if(fp == 'process.stdout' || fp == 'process.stderr') {
      life.type = 'process';
      fp = [ process.cwd(), fp + '.out' ].join('/');
    } else {
      life.type = 'file';
    }
    
    life.filepath = fp;
    life.born = Date.now();
    life.prev = life.born;
  
    ['span', 'cap', 'stock'].forEach(function(k) {
      life[ k ] = _unit2Int( opts[ k ] || Default[ k ] );
    });
    
    ['dirc', 'head', 'tail', 'file', 'kick', 'sort'].forEach(function(k) {
      var func = opts[ k ] || Default[ k ], v = func;
      if(!isFunction(func)) {
        func = function() { return v; };
      }
      life[ k ] = func.bind(life);
    });
    
    if(opts.reflesh && FDs[fp] != NULL) {
      try { fs.closeSync( FDs[fp] ) } catch(e) { } 
      delete FDs[fp];
    }
    
    life.fd = NULL;
    life.rs = life.ws = NULL;
    life.ready = Promise.resolve().then(function() {
      if(life.fd = FDs[ fp ]) {
        is_new_fd = FALSE;
        return;
      }
      if(life.type == 'process') {
        life.rs = FDs[ fp ] = process[ filepath.split('.').pop() ];
        is_new_fd = FALSE;
        return;
      }
      return new Promise(function(rsl, rej) {
        
        // Open file and get fd, mode "w+" for ftruncate
        fs.open(fp, 'w+', function(er, fd) { er ? rej(er): rsl(FDs[ fp ] = life.fd = fd); });
        
      });
    }).then(function() {
      return life.renewalStreams();
    }).then(function() { return; // !! IMPORTANT !! DONNOT /dev/null for reboot process (cannot inherit fd)
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
    }).then(function() {
      outLog('Planning successfully for: ' + fp, '(fd: ' + life.fd +  '=>' + life.ws.fd + ')');
    })['catch'](function(e) {
      outLog('Planning failed, log-life stopped silently for: ' + fp, e);
      if(life.readTimer) { 
        clearInterval(life.readTimer);
        life.readTimer = NULL;
      }
      life.fd = NULL;
      life.rs = life.ws = NULL;
      life.ready = Promise.reject(e);
    });
    
  }
  
  /**
   * 
   * @param procTime
   * @returns
   */
  function check(procTime) {
    var life = this, opts = life.options;
    return Promise.resolve(life.ready).then(function() {
      
      procTime = procTime || new Date();
  
    }).then(function() {
      return life.kick(procTime);
    }).then(function(rotate) {
      
      outLog('result of check: ' + rotate + ', for: ' + life.filepath);
      if(rotate !== TRUE) { 
        return; 
      }
      return life.maintain(procTime);
  
    })['catch'](function(e) {
      
      outLog('Unexpected check error occurs and force lotate:', e);
      return life.renewalStreams();
      
    }).then(function() {
      life.prev = procTime;
    });
  }
  
  /**
   * @explain renewal streams and create log-archive
   * @param procTime
   * @returns
   */
  function maintain(procTime) {
    var life = this, opts = life.options;
    var wp = life.writepath, gzip, gz;
    // 1) Create backup gz
    // 2) Remove gzipped file
    // 3) Preserved gzip maintenance
    if(wp == NULL) {
      return Promise.resolve(); // Nothing to do.
    }
    return life.ready = Promise.resolve(life.ready).then(function() {
    
      var life = this
      if(life.procTime) {
        throw new Error('Another maintenance is in-porcess.( starts at: ' + life.procTime + ' )');
      }
    
    }).then(function() {
      return life.renewalStreams();
    }).then(function() {
      // 1) Create backup gz
      // (1-1)
      return new Promise(function(rsl, rej) {
        
        gz = fs.createWriteStream( wp.split('.').slice(0, -1).join('.') + life.tail() );
        gz.on('open', rsl).on('error', rej);
        
      });
    }).then(function() {
      // (1-2)
      return new Promise(function(rsl, rej) {
        
        gzip = zlib.createGzip();
        fs.createReadStream(wp).pipe(gzip).pipe(gz);
        gz.on('close', rsl).on('error', rej);
        
      });
    }).then(function() {
      // 2) Remove archived file
      return new Promise(function(rsl) {
        
        fs.unlink(wp, rsl);
        
      });
    }).then(function() {
      // 3) Preserved archives maintenance
      return life.list().then(function(a) {
  
        if(a.length <= life.stock) {
          return;
        }
        a.slice(0, life.stock * -1).forEach(function(fnam) {
          fs.unlinkSync([ life.dirc(), fnam ].join('/'));
        });

      })['catch'](Function());
    }).then(function() {
      delete life.procTime;
    })['catch'](function(e) {
      delete life.procTime;
      throw e;
    });
  }
  
  /**
   * 
   * @returns
   */
  function size() {
    var life = this, opts = life.options;
    var wp = life.writepath;
    return new Promise(function(rsl, rej) {
      fs.stat(wp, function(er, stat) {
        
        // outLog('size result:', wp, stat);
        er ? rej(er): rsl(stat.size);
        
      });
    });
  }
  
  /**
   * 
   * @returns
   */
  function list() {
    var life = this;
    return new Promise(function(rsl, rej) {
      var fd = life.dirc(), wp = life.writepath;
      var fh = life.head().substr(fd.length + 1); // /home/ystskm/nohup.out => nohup
      fs.readdir(fd, function(er, a) {
  
        if(er) {
          return rej(er);
        }
        var t = life.tail();
        // outLog('list result for: ' + life.filepath, a, ', filter by tail: ' + t);
        rsl( a.filter(function(fnam) {
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
   * @returns
   */
  function renewalStreams(symlink) {
    var life = this, opts = life.options;
    var fp = life.filepath;
    outLog('renewalStreams:', life.filepath);
    return Promise.resolve().then(function() {
      if(life.type == 'process') return;
      if(life.ws == NULL) return;
      return new Promise(function(rsl, rej) {
        
        clearInterval(life.readTimer);
        life.readTimer = NULL;
        
        var rwait = Promise.resolve();
        var time = new Date();
        var size = fs.fstatSync(life.fd).size - (life.offsetPosition || 0);
        var smax = 10 * Math.pow(1024, 2);
        var rbuf, rext;
        if(size > smax) {
          life.offsetPosition += (size - smax);
          size = smax;
        }
        if(size > 0) {
            
          // outLog('Goto remains output!');
          fs.readSync(life.fd, rbuf = Buffer(size), 0, size, life.offsetPosition);
          life.ws.write(rbuf);
          life.ws.end(time.toGMTString()  + ' - [LogLife] Close write stream.')
          // => write remain buffer and sign
          
        }
        // outLog('Goto truncate!');
        fs.ftruncate(life.fd, function(er) { er ? rej(er): rsl(); });
      
      });
    }).then(function() {
      return life.createWriteStream(symlink);
    }).then(function() {
      return life.createReadStream();
    });
  }
  
  /**
   * 
   * @returns
   */
  function createReadStream() {
    var life = this, opts = life.options;
    var fp = life.filepath;
    return Promise.resolve().then(function() {
      switch(life.type) {
      
      case 'process': 
        // !! IMPORTANT !! stdxxx is both readable and writable!
        life.rs._write = function(buf, enc, cb) { 
          life.ws.write(buf);
          life.rs._writeGeneric(FALSE, buf, enc, cb);
        }.bind(life.rs);
        break;

      case 'file':
      default:
        return new Promise(function(rsl, rej) {
        
          // Copy reading chunk buffer gradually
          var once = 256 * 1024, intv = 3 * 1000;
          if(life.readTimer) {
            clearInterval( life.readTimer );
          }
          // Create readStream expects the truncated log file
          life.offsetPosition = 0;
          life.readTimer = setInterval(function() {
            var buf = Buffer(once);
            fs.read(life.fd, buf, 0, once, life.offsetPosition, function(er, byteRead) {

              // outLog('Goto read buffer size: ' + once, life.offsetPosition);
              // outLog('  ... results: ' + byteRead, er, '=>' + life.writepath + ' (fd:' + life.ws.fd + ')');
              if(er) {
                outLog('Read error:', er);
                return;
              }
              if(byteRead == 0) {
                return;
              }
              
              life.offsetPosition += byteRead;
              life.ws.write(buf.slice(0, byteRead));
              
            });
          }, intv);
          rsl();
        
        });
      }
    }).then(function() {
      outLog('Open readStream: ' + life.filepath);
    });
  }
  
  /**
   * 
   * @returns
   */
  function createWriteStream(symlink) {
    var life = this, opts = life.options;
    var fp = life.filepath, wp;
    return Promise.resolve().then(function() {
      wp = life.writepath = life.file(new Date(), 'log');
    }).then(function() {
      return new Promise(function(rsl, rej) {

        life.ws = fs.createWriteStream(wp, {
          flags: 'w+',
          autoClose: FALSE
        }).on('open', rsl).on('error', rej);
        
        life.ws.on('drain', function() {
          // outLog('Writable stream writable: ' + wp, life.writepath);
        });
        life.ws.on('finish', function() {
          // outLog('Writable stream finished: ' + wp, life.writepath);
        });
        life.ws.on('close', function() {
          outLog('Writable stream closed: ' + wp, life.writepath);
        });

      });
    }).then(function() {
      if(symlink) life.createSymlink();
    }).then(function() {
      outLog('Open writeStream: ' + life.writepath);
    });
  }
  
  /**
   * 
   * @returns
   */
  function createSymlink() {
    var life = this, opts = life.options;
    var fp = life.filepath;
    return Promise.resolve().then(function() {
      if(life.type == 'process') { return; }
      return new Promise(function(rsl) { 
        
        // remove Symlink space at filepath if exist
        fs.unlink(fp, rsl);
        
      });
    }).then(function() {
      if(life.type == 'process') { return; }
      return new Promise(function(rsl) { 
        
        // create Symlink at filepath to writepath
        fs.symlink(life.writepath, fp, function(er) {
          if(er) { outLog('Failed to create symlink:', er); } rsl();
        });
        
      });
    });
  }
  
  // ----- //
  /**
   * @ignore
   */
  function _unit2Int(s) {
  
    if(typeof s == 'number')
      return s;
  
    var mtc;
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
  
})();
