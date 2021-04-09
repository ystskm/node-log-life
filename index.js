/**
 * Index file for LogLife
 * Usage: LogLife( logFile_0, logFile_1, [option] )
 * プロセスの再起動なくログローテーションを行う 
 */
(function() {
    
  const NULL = null, TRUE = true, FALSE = false, UNDEF = undefined;
  const Life = require('./lib/Life');
  const supr = require('supertimer');
  let Lifes = { }, TickTimer;
  
  const staticFncs = {
    start: start,
    exec: exec,
    stop: stop,
    get: get,
    die: die,
    rotate: rotate
  };
  Object.keys( staticFncs ).forEach(function(k) {
    LogLife[ k ] = staticFncs[ k ];
  });

  // Interval timer starts on require.
  start();
  
  module.exports = LogLife;
  return; // <-- END_OF_MAIN <--

  /**
   * @static LogLife
   * @param <Array>.<String> [ logFile_0, logFile_1, ... ] | <String> logFile_0, logFile_1, ...
   * @param @optional <Object> options
   * @returns
   */
  function LogLife() {
  
    var args = Array.prototype.slice.call(arguments);
    var opts;
    if( isArray(args[0]) ) {
      opts = args[1], args = args[0];
    } else {
      opts = is( 'string', args.slice(-1)[0] ) ? { }: args.pop();
    }
    opts = opts || { };
  
    var files = [ ], pusher = function(ipt) {
      var fp, fp_opts;
      if( is('string', ipt) ) {

        // console.log('ipt=string');
        fp = ipt, fp_opts = clone(opts);
        fp_opts.id = fp;

      } else {

        // console.log('ipt=object', ipt);
        fp = ipt.id, fp_opts = clone(opts);
        Object.keys(ipt).forEach(function(ipt_k) {
          fp_opts[ipt_k] = ipt[ipt_k];
        });
        // console.log('=>', fp, fp_opts);

      }
      if( !is('string', fp) ) {
        console.warn('Unexpected path type: ' + fp, ipt);
        return;
      }
      files.push([ fp, fp_opts ]);
    };
  
    args.forEach(function(a) {
      isArray(a) ? a.forEach(pusher): pusher(a);
    });
    files.forEach(function(pair) {
  
      var fp = pair[0], fp_opts = pair[1];
      if(Lifes[ fp ]) {
        outWarn('Duplicated loglife and renewal life: ' + fp);
        die(fp);
      }
      // console.log('Set log-life file: ' + fp);
      Lifes[ fp ] = new Life(fp, fp_opts);
      
    });
  
  }
    
  /**
   * 
   * @param intv
   * @returns
   */
  function start(intv) {
    if(TickTimer) {
      stop();
    }
    // This is a check interval for LogLife.
    TickTimer = supr.setInterval(exec, intv || 10 * 1000);
  }
  
  /**
   * 
   * @returns
   */
  function stop(timerOnly) {
    if(!TickTimer) {
      return;
    }
    supr.clearInterval(TickTimer);
    TickTimer = NULL;
    if(!timerOnly) {
      Object.keys(Lifes).forEach(function(fp) { die(fp); });
    }
  }
  
  /**
   * 
   * @param fp
   * @returns
   */
  function get(fp) {
    return Lifes[ fp ];
  }
  
  /**
   * 
   * @param fp
   * @returns
   */
  function die(fp) {
    var life = Lifes[ fp ];
    life.close();
    delete Lifes[ fp ];
    return life;
  }
  
  /**
   * 
   * @returns
   */
  function exec() {
  
    var n = exec.procTime;
    if(n) {
      if(Date.now() - n.getTime() > 600 * 1000) {
        
        outLog('LogLife is stopped for too-long process. ( start at: ' + n + ' )');
        delete exec.procTime, stop();
        return;
        
      }
      outLog('On processing ( start at: ' + n + ' )');
      return;
    }
  
    var procFile;
    var procTime = exec.procTime = new Date();
    var proc = Promise.resolve();
    Object.keys( Lifes ).forEach(function(fp, idx) {
      var rap = Date.now();
      proc = proc.then(function(){
        // outLog('Go check for: ' + fp, procTime, Date.now() - rap);
      }).then(function() {
        
        return get( procFile = fp ).check( procTime, idx );
        
      }).then(function(){
        // outLog('Ok check for: ' + fp, procTime, Date.now() - rap);
      });
    });
  
    proc = proc.then(function() {
      delete exec.procTime;
    })['catch'](function(e) {
      outLog('Process end up with Error:', procFile, e);
      delete exec.procTime;
    });
    return proc;
  
  }
  
  /**
   *
   */
  function rotate() {
    return Life.rotate.apply(NULL, arguments);
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
    args.unshift(new Date().toGMTString() + ' - [LogLife]');
    return args;
  }
  
  // ----- //
  function clone(x) {
    if(x == NULL) {
      return x;
    }
    if(!isArray(x) && !is('object', x)) {
      switch(TRUE) {
      case x instanceof Date:
        return new Date(x);
      default:
        return x;
      }
    }
    var new_x;
    if(isArray(x)) {
      new_x = [ ];
      x.forEach(function(v) {
        new_x.push(clone(v));
      });
    } else {
      new_x = { };
      Object.keys(x).forEach(function(k) {
        new_x[k] = clone(x[k]);
      });
    }
    return new_x;
  }
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