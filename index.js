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

  if(_exec.now) {
    return console.log('On maintenance (' + _exec.now + ')');
  }

  var now = _exec.now = new Date();
  var promise = Promise.resolve();
  Object.keys(Lifes).forEach(function(fp) {
    var rap = Date.now();
    promise = promise.then(function(){
      // console.log('Goto check for: ' + fp, now, Date.now() - rap);
    }).then(function() {
      
      return get(fp).check(now)
      
    }).then(function(){
      // console.log('Ok check for: ' + fp, now, Date.now() - rap);
    });
  });

  promise.then(function() {
    delete _exec.now;
  })['catch'](function(e) {
    delete _exec.now;
  });

  return promise;

}
