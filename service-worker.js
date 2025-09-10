const POMOTICA_CACHE = 'pomotica-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './styles-base.css',
  './themes.css',
  './script.js',
  './manifest.webmanifest',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(POMOTICA_CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k !== POMOTICA_CACHE ? caches.delete(k) : null)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(POMOTICA_CACHE).then((cache) => cache.put(request, copy));
          return response;
        }).catch(() => {
          if (request.destination === 'document') return caches.match('./index.html');
        });
      })
    );
  }
});
