/***/
module.exports = YMDHMS;
function YMDHMS(n) {

  n = n ? new Date(n): new Date();
  n = new Date(n.getTime() + 9 * 60 * 60 * 1000); // UTC => JST

  var s = '';
  s += n.getFullYear();
  s += ('0' + (n.getMonth() + 1)).substr(-2);
  s += ('0' + n.getDate()).substr(-2);
  s += '_';
  s += ('0' + n.getHours()).substr(-2);
  s += ('0' + n.getMinutes()).substr(-2);
  s += ('0' + n.getSeconds()).substr(-2);
  return s;

}
