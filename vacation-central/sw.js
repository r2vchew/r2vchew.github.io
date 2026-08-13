/* Vacation Central service worker — offline app shell cache.
   Bump CACHE when shipping new asset versions, and bump the matching ?v=N
   on styles.css/config.js/app.js in index.html too — otherwise the plain
   HTTP cache (separate from this service worker) can keep serving stale JS
   after an update. Same gotcha route-optimizer's OPERATIONS.md documents. */
const CACHE = 'vacation-central-v5';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=5',
  './config.js?v=5',
  './app.js?v=5',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Never cache Supabase/weather/Maps calls — those need to be live.
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => cached))
  );
});
