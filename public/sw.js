// FixRelay service worker. Deliberately minimal:
//  - makes the app installable and shows a friendly page when the device is offline;
//  - caches NOTHING that belongs to a tenant (no pages, no API responses, no attachments), so there is
//    no cross-tenant or cross-user cache to isolate. Offline data entry is NOT supported (see BUILD_STATUS.md).
const CACHE = "fixrelay-shell-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/offline.html", "/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match("/offline.html")));
});
