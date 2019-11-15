/**
 * Index file for LogLife
 * Usage: LogLife( logFile_0, logFile_1, [option] )
 * プロセスの再起動なくログローテーションを行う 
 */
var NULL = null, TRUE = true, FALSE = false;
(function() {
    
  var Life = require('./lib/Life');
  var supr = require('supertimer');
  var Lifes = {}, TickTimer;
  
  var staticFncs = {
    start: start,
    exec: exec,
    stop: stop,
    get: get,
    die: die
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
   * @param <String> logFile_0, logFile_1, ...
   * @param @optional <Object> options
   * @returns
   */
  function LogLife() {
  
    var args = Array.prototype.slice.call(arguments);
    var opts = is( 'string', args.slice(-1)[0] ) ? { }: args.pop();
  
    var files = [], pusher = function(fp) {
      if( !is('string', fp) ) {
        console.warn('Unexpected path type: ' + fp);
        return;
      }
      files.push(fp);
    };
  
    args.forEach(function(arg) {
      isArray(arg) ? arg.forEach(pusher): pusher(arg);
    });
    files.forEach(function(fp) {
  
      if(Lifes[ fp ]) {
        outWarn('Duplicated loglife and renewal life: ' + fp);
        die(fp);
      }
      // console.log('Set log-life file: ' + fp);
      Lifes[ fp ] = new Life(fp, opts);
      
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
  function stop() {
    if(!TickTimer) {
      return;
    }
    supr.clearInterval(TickTimer);
    TickTimer = NULL;
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
    // TODO Call any life method?
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
    Object.keys( Lifes ).forEach(function(fp) {
      var rap = Date.now();
      proc = proc.then(function(){
        // outLog('Go check for: ' + fp, procTime, Date.now() - rap);
      }).then(function() {
        
        return get( procFile = fp ).check( procTime );
        
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