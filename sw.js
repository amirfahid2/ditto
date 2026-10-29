var CACHE = "ditto-v5";
// What the site needs with no connection: the app, its pages and scripts, and the bridge to the
// iPhone's squares (which then says "can't reach" instead of failing to load).
var PRECACHE = ["./", "about/", "privacy.html", "figures.js", "intro.js", "sample-notes.js", "manifest.webmanifest",
  "icon-180.png", "icon-512.png", "link/link-core.js", "link/phone-board.js"];
// A page that isn't saved: the app itself for its own addresses, otherwise the browser's offline page
var SHELL = { "/": "./", "/index.html": "./", "/about": "about/", "/about/": "about/", "/about/index.html": "about/" };

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
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
  // Shared boards (/b/) travel in the link's "#…", which a saved copy would keep on disk:
  // never saved, always straight from the network.
  if (url.pathname === "/b" || url.pathname.indexOf("/b/") === 0) return;
  e.respondWith(
    fresh(e.request).then(function (r) {
      if (r.ok) {
        var copy = r.clone();
        e.waitUntil(caches.open(CACHE).then(function (c) { return c.put(e.request, copy); }));
      }
      return r;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (m) {
        if (m) return m;
        if (e.request.mode === "navigate" && SHELL[url.pathname]) return caches.match(SHELL[url.pathname]);
        return Response.error();   // a script or picture never saved: a plain failure, not the app's HTML in its place
      });
    })
  );
});
