/***/
module.exports = YMDHMS;
function YMDHMS(n) {

  n = n ? new Date(n): new Date();

  var s = '';
  s += String(n.getFullYear()).substr(-2);
  s += ('0' + (n.getMonth() + 1)).substr(-2);
  s += ('0' + n.getDate()).substr(-2);
  s += '_';
  s += ('0' + n.getHours()).substr(-2);
  s += ('0' + n.getMinutes()).substr(-2);
  s += ('0' + n.getSeconds()).substr(-2);
  return s;

}
