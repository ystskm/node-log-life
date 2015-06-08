/***/
module.exports = LogLife;

var Life = require('./lib/Life');
var supr = require('supertimer');
var Lifes = {}, TickTimer;
function LogLife() {

  var args = Array.prototype.slice.call(arguments);
  var opts = typeof args.slice(-1)[0] == 'string' ? {}: args.pop();
  args.forEach(function(fp) {
    if(Lifes[fp])
      throw new Error('Duplicated loglife call for: ' + fp);
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
  if(TickTimer)
    stop();
  TickTimer = supr.setInterval(_exec, intv || 1000);
}
function stop() {
  if(!TickTimer)
    return;
  supr.clearInterval(TickTimer);
  TickTimer = null;
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
    return Promise.reject(new Error('On maintenance (' + _exec.now + ')'));
  }

  var now = _exec.now = new Date();
  var promise = Promise.resolve();
  Object.keys(Lifes).forEach(function(fp) {
    var life = get(fp);
    promise = promise.then(function() {
      return life.check(now);
    });
  });

  promise.then(function() {
    delete _exec.now;
  })['catch'](function() {
    delete _exec.now;
  });

  return promise;

}
