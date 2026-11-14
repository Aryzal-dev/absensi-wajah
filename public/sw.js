const CACHE_NAME = 'absensi-v2.3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/face-detector.js',
  '/js/api.js',
  '/js/geo.js',
  '/js/camera.js',
  '/js/app.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Selalu bypass API dan request non-GET
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) {
    return;
  }

  // Network-first untuk skrip dan dokumen agar selalu terupdate saat online
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request).then((cached) => cached || caches.match('/index.html')))
  );
});
