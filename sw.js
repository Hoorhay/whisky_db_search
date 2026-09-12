const CACHE_NAME = 'whisky-tracker-v1';

// Relative paths allow this to work regardless of repository name or domain subfolder
const ASSETS_TO_CACHE = [
  './',
'./index.html',
'./app.js',
'./manifest.json',
// Include icons/stylesheets using relative paths below:
'./icon-192.png',
'./icon-512.png'
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
