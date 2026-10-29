// Smart App Banner: its "Open" hands the app this page's full URL, board included (the app
// reads the board from the link itself). A file of its own because the page's
// Content-Security-Policy allows no inline scripts; it runs early in <head>, before the
// banner is read.
(function () {
  var meta = document.createElement("meta");
  meta.name = "apple-itunes-app";
  function update() {
    // commas separate the banner's settings, so none may appear inside the URL
    meta.content = "app-id=6810430522, app-argument=" + location.href.replace(/,/g, "%2C");
  }
  update();
  document.head.appendChild(meta);
  window.addEventListener("hashchange", update);
})();
