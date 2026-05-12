const CACHE = 'medadvocate-v3';

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

  e.respondWith(
    caches.match(e.request).then(cached => {
      // Return cached copy immediately, then update in background
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
