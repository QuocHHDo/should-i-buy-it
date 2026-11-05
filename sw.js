// Offline support: the app shell and food data are cached on first visit.
// Same-origin files are served from the cache and refreshed in the background,
// so the app opens instantly in a store with no signal and still picks up updates.
// The barcode library (375 KB) is not precached: scanning needs a connection anyway, and it is cached on first use.
const CACHE = "self-check-v49";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "about.html",
  "privacy.html",
  "js/foods.js",
  "js/prices-data.js",
  "js/prices.js",
  "js/additives-data.js",
  "js/additive-notes.js",
  "js/additives.js",
  "js/ingredients.js",
  "js/supplement.js",
  "js/labelocr.js",
  "js/dom.js",
  "js/compare.js",
  "js/camera.js",
  "js/labelscan.js",
  "js/allergens.js",
  "js/verdict.js",
  "js/sources.js",
  "js/search.js",
  "js/card.js",
  "js/walmart.js",
  "js/bookmarklet.js",
  "js/learn.js",
  "js/meals.js",
  "js/backup.js",
  "js/app.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return; // USDA and Open Food Facts calls always go to the network

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: sameOrigin });
      const network = fetch(req)
        .then(res => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
