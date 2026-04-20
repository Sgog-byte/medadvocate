// Advocate PWA Service Worker
// Caches all app files for offline use

const CACHE_NAME = 'medadvocate-v1';
const ASSETS = [
  '/advocate-home.html',
  '/advocate-app.html',
  '/advocate-symptoms.html',
  '/advocate-labs.html',
  '/advocate-credibility.html',
  '/advocate-iep.html',
  '/advocate-tools3.html',
  '/advocate-myadvocate.html',
  '/advocate-privacy.html',
  '/manifest.json'
];

// Install — cache all core files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(err => {
        // If some assets fail (e.g. in local dev), continue anyway
        console.warn('Some assets could not be cached:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch — serve from cache, fall back to network
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // For API calls to Anthropic — always use network (never cache)
  if (event.request.url.includes('anthropic.com')) {
    return; // let it pass through normally
  }

  // For Google Fonts and CDN resources — network first, cache fallback
  if (
    event.request.url.includes('fonts.googleapis.com') ||
    event.request.url.includes('fonts.gstatic.com') ||
    event.request.url.includes('cdnjs.cloudflare.com')
  ) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For app files — cache first, then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for HTML pages
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('/advocate-home.html');
        }
      });
    })
  );
});

// Background sync — post message when back online
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
