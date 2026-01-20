/* ===============================
   Simple Service Worker for PWA
   Offline Cache + Fast Load
   =============================== */

const CACHE_NAME = "budget-app-v1";

// ไฟล์หลักที่อยาก cache
const ASSETS = [
  "./",
  "./index.html"
];

/* ---------- Install ---------- */
self.addEventListener("install", event => {
  console.log("[SW] Installing...");
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

/* ---------- Activate ---------- */
self.addEventListener("activate", event => {
  console.log("[SW] Activated");
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ---------- Fetch ---------- */
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return (
        response ||
        fetch(event.request).then(fetchRes => fetchRes)
      );
    })
  );
});
