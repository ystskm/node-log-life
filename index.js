/***/
var NULL = null, TRUE = true, FALSE = false;
module.exports = LogLife;

var Life = require('./lib/Life');
var supr = require('supertimer');
var Lifes = {}, TickTimer;
function LogLife() {

  var args = Array.prototype.slice.call(arguments);
  var opts = typeof args.slice(-1)[0] == 'string' ? {}: args.pop();

  var files = [], pusher = function(fp) {

    if(typeof fp != 'string') {
      console.warn('Unexpected path type: ' + fp);
      return;
    }

    files.push(fp);
  };

  args.forEach(function(arg) {
    Array.isArray(arg) ? arg.forEach(pusher): pusher(arg);
  });
  files.forEach(function(fp) {

    if(Lifes[fp]) {
      console.warn('Duplicated loglife and renewal life: ' + fp);
      die(fp);
    }

    // console.log('Set log-life file: ' + fp);
    Lifes[fp] = new Life(fp, opts);
    
  });

}

var ops = {
  start: start,
  stop: stop,
  get: get,
  die: die
};
for( var k in ops)
  LogLife[k] = ops[k];

// Interval timer starts on require.
start();

function start(intv) {
  if(TickTimer) {
    stop();
  }
  // This is a check interval for LogLife.
  TickTimer = supr.setInterval(_exec, intv || 10 * 1000);
}
function stop() {
  if(!TickTimer)
    return;
  supr.clearInterval(TickTimer);
  TickTimer = NULL;
}

function get(fp) {
  return Lifes[fp];
}
function die(fp) {
  var life = Lifes[fp];
  return delete Lifes[fp], life;
}

function _exec() {

  var n = _exec.now;
  if(n) {
    if(Date.now() - n.getTime() > 600 * 1000) {
      
      outLog('LogLife is stopped for too-late execution. (' + n + ')');
      return delete _exec.now, stop();
      
    }
    return outLog('On maintenance (' + n + ')');
  }

  var now = _exec.now = new Date();
  var promise = Promise.resolve();
  Object.keys(Lifes).forEach(function(fp) {
    var rap = Date.now();
    promise = promise.then(function(){
      // outLog('Goto check for: ' + fp, now, Date.now() - rap);
    }).then(function() {
      
      return get(fp).check(now)
      
    }).then(function(){
      // outLog('Ok check for: ' + fp, now, Date.now() - rap);
    });
  });

  promise.then(function() {
    delete _exec.now;
  })['catch'](function(e) {
    delete _exec.now;
  });

  return promise;

}

// ----------- //
function outLog() {
  console.log.apply(console, _getLogArgs(arguments));
}
function outWarn() {
  console.warn.apply(console, _getLogArgs(arguments));
}
function _getLogArgs(a) {
  var args = Array.prototype.slice.call(a);
  args.unshift(new Date().getGMTString() + ' - [LogLife]');
  return args;
}
