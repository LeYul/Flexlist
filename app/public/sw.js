// Service worker : application disponible hors connexion (coquille) + cache des affiches.
const SHELL_CACHE = 'flexlist-shell-v1';
const IMG_CACHE = 'flexlist-img-v1';
const SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/ui.js',
  '/js/views/discover.js',
  '/js/views/swipe.js',
  '/js/views/search.js',
  '/js/views/favorites.js',
  '/js/views/library.js',
  '/js/views/settings.js',
  '/js/views/detail.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL_CACHE, IMG_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Affiches et photos : cache d'abord.
  if (/(^|\.)image\.tmdb\.org$|static\.tvmaze\.com$/.test(url.hostname)) {
    e.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') {
          cache.put(req, res.clone());
          trim(IMG_CACHE, 1500);
        }
        return res;
      }),
    );
    return;
  }

  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Coquille : réseau d'abord (mises à jour immédiates), cache en secours.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/index.html'))),
  );
});
