var nodeunit = require('nodeunit');

var fs = require('fs'), cp = require('child_process');
var LogLife = require('../index');

module.exports = nodeunit.testCase({
  'readme': function(t) {

    var logdir = 'log', logf = './' + logdir + '/mylog.log';
    var Num = 3, Span = 1000;
    Promise.resolve().then(pipe(function(rsl, rej) {

      // clear working directory
      cp.exec('rm -Rf ./' + logdir, function(er) {
        er ? rej(er): rsl();
      });

    })).then(pipe(function(rsl, rej) {

      // make working directory
      fs.mkdir(logdir, function(er) {
        t.ok(true);
        er ? rej(er): rsl();
      });

    })).then(pipe(function(rsl, rej) {

      // make working log file
      cp.exec('touch ' + logf, function(er) {
        t.ok(true);
        er ? rej(er): rsl();
      });

    })).then(pipe(function(rsl, rej) {

      LogLife(logf, {

        // This file is archived and refreshed for each 1 second
        span: Span,

        // And 3 archives are preserved maximumly.
        stock: Num

      });
      rsl();

    })).then(pipe(function(rsl, rej) {

      var life = LogLife.get(logf);
      t.equals(life.stock, Num);
      life.size().then(function(size) {
        t.equals(0, size);
        rsl();
      }, rej);

    })).then(pipe(function(rsl, rej) {

      var life = LogLife.get(logf);
      life.list().then(function(a) {
        t.ok(Array.isArray(a), 'Initial list is array.');
        t.equals(a.length, 0, 'length == 0.');
        rsl();
      }, rej);

    })).then(pipe(function(rsl, rej) {

      cp.exec('echo "aaaaa"', function(er) {
        er ? rej(er): rsl();
      });

    })).then(pipe(function(rsl, rej) {

      // waiting until max number of tars are created.
      var life = LogLife.get(logf);
      setTimeout(function() {
        life.list().then(function(a) {

          var ok = a.length == Num || a.length == Num + 1;
          t.ok(ok, 'max length == ' + Num + '~' + (Num + 1));

          life.size().then(function(size) {
            t.equals(0, size);
            rsl();
          });

        }, rej);
      }, (Num + 3) * Span);

    })).then(pipe(function(rsl, rej) {

      // clear working directory
      cp.exec('rm -Rf ./' + logdir, function(er) {
        er ? rej(er): rsl();
      });

    })).then(function() {
      LogLife.stop();
      t.done();
    })['catch'](function(e) {
      LogLife.stop();
      console.error(e);
      t.fail(e);
    });

  }
});

function pipe(fn) {
  return function() {
    return new Promise(fn);
  };
}
