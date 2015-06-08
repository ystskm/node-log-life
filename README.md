# log-life
  
[![Rank](https://nodei.co/npm/log-life.png?downloads=true&amp;downloadRank=true&amp;stars=true)](https://nodei.co/npm/log-life/)  
  
[![Version](https://badge.fury.io/js/log-life.png)](https://npmjs.org/package/log-life)
[![Build status](https://travis-ci.org/ystskm/node-log-life.png)](https://travis-ci.org/ystskm/node-log-life)  
  
Wrapper for Simple Log Management.

## Install

Install with [npm](http://npmjs.org/):

    npm install log-life
    
## USAGE - Set functions by args

```js
    // To begin log-life, simply call with the target log file.
    var LogLife = require('log-life');
    LogLife('/var/log/mylog');
```

```js
    // Available for specify multiple files
    LogLife('/var/log/mylog1', '/var/log/mylog2');
```

## OPTIONS

```js
    * span  
      ... executing maintenance interval milli-seconds
    * stock 
      ... preserve num of log archive
```

## API for __LogLife__

```js
    // start log maintenance
    // *automatically* starts when LogLife() calls.
    LogLife.start(<Number>checking_interval_millisec || 1000)
```

```js
    // stop log maintenance
    LogLife.stop()
```

```js
    // getting a life for a file
    LogLife.get(<String>filepath)
```

```js
    // stop log maintenance
    LogLife.stop()
```

## API for __Life__ (a life for a file)

```js
    // logfile filepath 
    life.filepath
    // logfile mainteanace span
    life.span
    // logfile stock archives num
    life.stock
```

```js
    // logfile size 
    var life = LogLife.get(filepath);
    life.size().then(function(size) { ... })
```

```js
    // logfile related archive list 
    var life = LogLife.get(filepath);
    life.list().then(function(list) { ... })
```
