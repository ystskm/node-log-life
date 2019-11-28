/**
 * Basic test for LogLife
 * 1s ごとにローテートファイルを作成する
 */
var NULL = null, TRUE = true, FALSE = false, UNDEF = undefined;
var nodeunit = require('foonyah-ci');

var fs = require('fs'), cp = require('child_process');
var LogLife = require('../index');

module.exports = nodeunit.testCase({
  'readme': function(t) {

    var logdir = 'log', logf = './' + logdir + '/mylog.log';
    var Num = 3, Span = 1000;
    Promise.resolve().then(pipe((rsl, rej)=>{

      // initialize(1/2) cleanup
      // clear working directory
      cp.exec('rm -Rf ./' + logdir, er=>er ? rej(er): rsl());

    })).then(pipe(function(rsl, rej) {

      // initialize(2/2) setup
      // make working directory
      fs.mkdir(logdir, er=>{
        t.ok(TRUE); er ? rej(er): rsl();
      });

    })).then(pipe(function(rsl, rej) {

      // make working log file
      cp.exec('touch ' + logf, er=>{
        t.ok(TRUE); er ? rej(er): rsl();
      });

    })).then(pipe(function(rsl, rej) {

      LogLife.start(1000); // => change interval (Default: 10sec)
      LogLife(logf, {

        // This file is archived and refreshed for each 1 second
        span: Span,

        // And 3 archives are preserved maximumly.
        stock: Num,
        
        // rotation notifier
        report: FALSE ? { }: {
          server: { host: 'smtp.gmail.com', username: '0123@gmail.com', password: '0123', domain: 'gmail.com' },
          from: '0123<0123@gmail.com>',
          to: [ 'sakamoto@startup-cloud.co.jp' ]
        }

      });
      ( LogLife.get(logf).ready ).then(rsl, rej);

    })).then(pipe(function(rsl, rej) {

      var life = LogLife.get(logf);
      t.equals(life.stock, Num);
      life.size().then(size=>{ t.equals(0, size); rsl(); }, rej);

    })).then(pipe(function(rsl, rej) {

      var life = LogLife.get(logf);
      life.list().then(a=>{
        t.ok(Array.isArray(a), 'Initial list is array.');
        t.equals(a.length, 0, 'length == 0.');
        rsl();
      }, rej);

    })).then(pipe(function(rsl, rej) {

      cp.exec('echo "abcde"', er=>er ? rej(er): rsl());

    })).then(pipe(function(rsl, rej) {

      // waiting until max number of tars are created.
      var life = LogLife.get(logf);
      setTimeout(function() {
        life.list().then(a=>{

          console.log('Log archives:', a);
          var ok = a.length == Num || a.length == Num + 1;
          t.ok(ok, 'max length == ' + [ Num,  Num + 1 ].join('~'));

          life.size().then(function(size) {
            t.equals(0, size);
            rsl();
          });

        }, rej);
      }, (Num + 3) * Span);

    })).then(pipe(function(rsl, rej) {

      // clear working directory
      cp.exec('rm -Rf ./' + logdir, er=>er ? rej(er): rsl());

    })).then(pipe(function(rsl, rej) {
      LogLife.get(logf).close();
      rsl();
    })).then(function() {

      console.log('DONE => LogLife stop(1S)');
      LogLife.stop();
      t.done();
      
    })['catch'](function(e) {
      
      console.log('FAIL => LogLife stop(1E)', e);
      LogLife.stop();
      t.fail(e);
      
    });

  },
  'readme_sweep': function(t) {
    
    var logdir = 'log', id = 'sweep1';
    var Num = 3, Span = 1000;
    var generator, gens = { log: 0, txt: 0 };
    Promise.resolve().then(pipe((rsl, rej)=>{

      // initialize(1/2) cleanup
      // clear working directory
      cp.exec('rm -Rf ./' + logdir, er=>er ? rej(er): rsl());

    })).then(pipe(function(rsl, rej) {

      // initialize(2/2) setup
      // make working directory
      fs.mkdir(logdir, er=>{
        t.ok(TRUE); er ? rej(er): rsl();
      });

    })).then(pipe(function(rsl, rej) {

      // generate 5 files per 1 sec ( .log => .txt => .log => .txt ... )
      generator = setInterval(function() {
        var idx = gens.log + gens.txt + 1;
        var ext = gens.log == gens.txt ? '.log': '.txt';
        gens[ext.substr(1)] += 1;
        cp.exec('touch ./' + logdir + '/file' + idx + ext, er=>er && console.error('touch error:', er));
      }, 200);
      
      LogLife.start(1000); // => change interval (Default: 10sec)
      LogLife([{
        
        id: id,
        directory: logdir,
        normalize: function(n) {
          // console.log('In the normalize: ' + n);
          if(n.split('.').pop() == 'log') return n;
        }
      
      }], {

        // This file is archived and refreshed for each 1 second
        span: Span

      });
      ( LogLife.get(id).ready ).then(rsl, rej);

    })).then(pipe(function(rsl, rej) {

      // waiting until max number of tars are created.
      var life = LogLife.get(id);
      setTimeout(function() {
        Promise.resolve( fs.readdirSync(logdir) ).then(a=>{

          var len;
          console.log('Generated and exising files:', a);
          len = a.filter( t=>(/\.log$/).test(t) ).length;
          t.ok(len <= 5, 'existing .log file count is 0 ~ 5');
          rsl();

        }, rej);
      }, (Num + 3) * Span);

    })).then(function() {

      console.log('DONE => LogLife stop(2S)');
      clearInterval(generator);
      LogLife.stop();
      t.done();
      
    })['catch'](function(e) {
      
      console.log('FAIL => LogLife stop(2E)', e);
      clearInterval(generator);
      LogLife.stop();
      t.fail(e);
      
    });
    
  }
}, __filename.split('/').pop());

function pipe(fn) {
  return function() {
    return new Promise(fn);
  };
}
