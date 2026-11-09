// Keeps the Label Station working without internet once it has been opened.
// Bump VERSION when you upload a new copy so tablets pick up the change.
const VERSION = "payaz-labels-v4";
const FILES = [
  "./", "index.html", "manifest.webmanifest",
  "js/app.js", "js/labels.js", "js/printer.js", "js/log.js", "js/lzma.js",
  "fonts/Montserrat-Regular.ttf", "fonts/Montserrat-Medium.ttf", "fonts/Montserrat-Bold.ttf",
  "fonts/Montserrat-Black.ttf", "fonts/AtkinsonHyperlegible-Bold.ttf",
  "img/logo-white.png", "img/icon-192.png", "img/icon-512.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first (so updates arrive), falling back to the saved copy when offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
