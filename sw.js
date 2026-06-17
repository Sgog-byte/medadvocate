const CACHE = 'medadvocate-v6';

const PRECACHE = [
  '/', '/index.html', '/manifest.json', '/supabase-client.js',
  '/advocate-app.html', '/advocate-symptoms.html', '/advocate-labs.html',
  '/advocate-timeline.html', '/advocate-er.html', '/advocate-medications.html',
  '/advocate-careteam.html', '/advocate-credibility.html', '/advocate-iep.html',
  '/advocate-insurance.html', '/advocate-explain.html', '/advocate-flare.html',
  '/advocate-research.html', '/advocate-summary.html', '/advocate-myadvocate.html',
  '/advocate-scripts.html', '/advocate-login.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE).catch(() => {})) // don't fail install if a page 404s
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET, cross-origin, and API calls
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/.netlify/')) return;

  // HTML navigations are network-first so a new deploy is visible immediately.
  // Fall back to the cached copy only when the network is unavailable (offline).
  const isHTML = e.request.mode === 'navigate'
    || e.request.destination === 'document'
    || url.pathname.endsWith('.html');

  if (isHTML) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request)) // offline: serve last-cached page
    );
    return;
  }

  // Static assets (JS/CSS/images/fonts) stay cache-first: serve cached copy
  // immediately, refresh in the background for next time.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached); // offline: fall back to cache

      return cached || networkFetch;
    })
  );
});
