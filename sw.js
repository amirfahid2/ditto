var CACHE = "ditto-v4";

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(["./", "about/", "icon-180.png", "icon-512.png"]); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Always ask the server first. GitHub Pages lets browsers keep a file for 10 minutes, so a
// plain fetch could hand back the previous version right after a publish; "no-cache" checks
// with the server every time (a cheap "not modified" when nothing changed). The saved copies
// are only for when there's no connection.
function fresh(req) {
  try { return fetch(new Request(req, { cache: "no-cache" })); }
  catch (err) { return fetch(req); }   // an older browser that can't copy a page request
}

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  var inAbout = url.pathname.indexOf("/about/") === 0;
  e.respondWith(
    fresh(e.request).then(function (r) {
      if (r.ok) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return r;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (m) {
        return m || caches.match(inAbout ? "about/" : "./");
      });
    })
  );
});
