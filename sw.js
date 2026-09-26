// sw.js
// Bump CACHE_NAME whenever you deploy changes to any cached file.
const CACHE_NAME = 'whisky-db-v8';

// Without these the app can't run at all, so install fails if any are missing.
const CORE_ASSETS = [
  './',
'./index.html',
'./style.css',
'./app.js',
'./fuse.min.js',
'./manifest.json'
];

// Nice to have: a missing icon must not break offline support.
const OPTIONAL_ASSETS = [
  './assets/favicon-96x96.png',
'./assets/apple-touch-icon.png',
'./assets/web-app-manifest-192x192.png',
'./assets/web-app-manifest-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // 'reload' bypasses the HTTP cache so we never precache a stale copy.
    await cache.addAll(CORE_ASSETS.map((url) => new Request(url, { cache: 'reload' })));

    await Promise.all(OPTIONAL_ASSETS.map((url) =>
    cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
      console.warn('SW: optional asset not cached:', url, err);
    })
    ));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Stale-while-revalidate for same-origin GETs: answer instantly from cache,
// refresh the cache in the background when the network is reachable.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Leave cross-origin requests (Firebase API) to the page's own error handling.
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Every page navigation (including ?query or #hash variants) maps to index.html.
    const key = req.mode === 'navigate' ? './index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: true });

    const network = fetch(req)
    .then((res) => {
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);

    if (cached) {
      event.waitUntil(network); // let the background refresh finish
      return cached;
    }

    const res = await network;
    return res || Response.error();
  })());
});
