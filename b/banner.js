// Smart App Banner: its "Open" hands the app this page's URL with the board in it (the app
// reads the board from the link itself). A file of its own because the page's
// Content-Security-Policy allows no inline scripts; it runs early in <head>, before the
// banner is read.
(function () {
  // The same clean link as cleanHash() in board.js (a module, so it can't be loaded this
  // early): "#d1=<payload>" without what messengers add at the end, which the app refuses.
  var MAX = 200000 + 64;   // board.js: LIMITS.payloadChars + HASH_SLACK
  function isB64(c) {
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 95;
  }
  function cleanHash(hash) {
    var frag = String(hash || "");
    if (frag.length > MAX) return "";
    if (frag.charAt(0) === "#") frag = frag.slice(1);
    try { frag = decodeURIComponent(frag); } catch (e) { /* the app says it's broken */ }
    var m = /^d(\d{1,6})=/.exec(frag);
    if (!m) return "";
    var p = frag.slice(m[0].length), amp = p.indexOf("&");
    if (amp >= 0) p = p.slice(0, amp);
    var end = p.length;
    while (end > 0 && !isB64(p.charCodeAt(end - 1))) end--;
    return "#d" + m[1] + "=" + p.slice(0, end);
  }

  var meta = document.createElement("meta");
  meta.name = "apple-itunes-app";
  function update() {
    // commas separate the banner's settings, so none may appear inside the URL
    var url = location.origin + location.pathname + cleanHash(location.hash);
    meta.content = "app-id=6810430522, app-argument=" + url.replace(/,/g, "%2C");
  }
  update();
  document.head.appendChild(meta);
  window.addEventListener("hashchange", update);
})();
