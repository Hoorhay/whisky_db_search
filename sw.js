const CACHE_NAME = 'whisky-tracker-v3';

// Relative paths allow this to work regardless of repository name or domain subfolder.
// Everything here is now same-origin (Fuse.js is vendored locally instead of pulled
// from a CDN, and the Google Fonts dependency was dropped in favor of system fonts),
// so a plain cache.addAll() is safe: no cross-origin/opaque-response handling needed.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './fuse.min.js',
  './manifest.json',
  './assets/favicon.svg'
];

// Install Event: Cache core application shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use addAll with relative paths so GitHub Pages resolves them dynamically
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up legacy caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Serve static assets from cache; force network for Firebase JSON APIs
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // 1. Bypass Service Worker cache completely for Firebase API requests
  if (requestUrl.hostname.includes('firebaseio.com') || requestUrl.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Return custom offline JSON payload if offline
        return new Response(
          JSON.stringify({ error: 'Offline, network unavailable' }),
                            { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // 2. Cache-First strategy for static UI assets (HTML, JS, CSS, Images)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Do not cache non-successful responses or cross-origin GET requests
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});
