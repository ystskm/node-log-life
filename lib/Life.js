/***/
var fs = require('fs'), YMDHMS = require('./_YMDHMS');
var zlib = require('zlib');
var Default = {

  span: 1000 * 60 * 60 * 24 * 30,
  cap: 500 * 1000,
  stock: 1,

  dirc: function() {
    var fp = this.filepath;
    return fp.split('/').slice(0, -1).join('/');
  },
  head: function() {
    var fp = this.filepath;
    return fp.split('.').slice(0, -1);
  },
  tail: function() {
    return '.gz';
  },
  file: function(n, ext) {
    return this.head().concat(YMDHMS(n), ext).join('.');
  },
  kick: function(n) {

    var life = this;
    if(n.getTime() - life.prev > life.span)
      return true;

    return life.size().then(function(size) {
      rsl(size > life.cap);
    });

  },
  sort: function(t1, t2) {
    return t1 < t2 ? -1: 1;
  }
}

module.exports = Life;
function Life(filepath, options) {

  var life = this;
  var fp = life.filepath = filepath, opts = life.options = options || '';
  life.born = Date.now(), life.prev = life.born;

  life.span = opts.span || Default.span;
  life.cap = opts.cap || Default.cap;
  life.stock = opts.stock || Default.stock;

  ['dirc', 'head', 'tail', 'file', 'kick', 'sort'].forEach(function(k) {
    life[k] = (opts[k] || Default[k]).bind(life);
  });

}

var LifeProtos = {
  check: check,
  maintain: maintain,
  size: size,
  list: list
};
for( var k in LifeProtos)
  Life.prototype[k] = LifeProtos[k];

function check(now) {

  var life = this;
  now = now || new Date();

  return Promise.resolve().then(function() {
    return life.kick(now);
  }).then(function(a) {

    return a !== true || life.maintain(now).then(function() {
      life.prev = now;
    });

  });

}

function maintain(now) {

  var life = this;
  if(life._exec) {
    return Promise.reject(new Error('Another maintenance is in-porcess.'));
  }

  life._exec = now;

  // 1) create backup gz
  // 2) flush
  var fp = life.filepath, ws, gzip;
  return Promise.resolve().then(function() {

    return new Promise(function(rsl, rej) {
      ws = fs.createWriteStream(life.file(now, 'gz'));
      ws.on('open', rsl).on('error', rej);
    });

  }).then(function() {

    return new Promise(function(rsl, rej) {
      gzip = zlib.createGzip();
      fs.createReadStream(fp).pipe(gzip).pipe(ws);
      ws.on('close', rsl);
    });

  }).then(function() {
    // flush log-file
    fs.truncateSync(fp);

  }).then(function() {
    // preserved gzip maintenance
    return new Promise(function(rsl, rej) {
      life.list().then(function(a) {

        if(a.length <= life.stock)
          return rsl();

        a.slice(0, life.stock * -1).forEach(function(fnam) {
          fs.unlinkSync([life.dirc(), fnam].join('/'));
        });
        rsl();

      });
    });

  }).then(function() {
    delete life._exec;
  })['catch'](function(e) {
    delete life._exec;
    throw e;
  });
  //  .then(function() {
  //    console.log('FIN.');
  //  })['catch'](function(e) {
  //    console.log(e)
  //  });

}

function size() {
  var life = this;
  return new Promise(function(rsl, rej) {
    fs.stat(life.filepath, function(er, stat) {
      er ? rej(er): rsl(stat.size);
    });
  });
}

function list() {
  var life = this;
  return new Promise(function(rsl, rej) {
    var fh = life.head().pop().split('/').pop();
    fs.readdir(life.dirc(), function(er, a) {

      er ? rej(er): rsl(a.filter(function(fnam) {
        if(fnam.indexOf(fh) !== 0)
          return false;
        if(fnam.slice(-3) != life.tail())
          return false;
        return true;
      }).sort(life.sort));

    });
  });
}
