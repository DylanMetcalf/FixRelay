// ManOp service worker.
//  - Caches only PUBLIC, versioned static files (app code under /_next/static, icons, brand assets) for speed.
//  - NEVER caches pages, API responses, attachments or anything tenant-specific, so there is nothing to leak
//    between users or companies on a shared device.
//  - Navigations go to the network; if the device is offline, a branded offline page is shown.
//  - Offline data entry is NOT supported (see BUILD_STATUS.md).
const VERSION = "manop-v4";
const SHELL = ["/offline.html", "/icon-192.png", "/icon.svg", "/apple-touch-icon.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });
const isStatic = (url) => url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || /^\/(icon|apple-touch|favicon|brand\/)/.test(url.pathname));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  if (isStatic(url)) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  }
});
