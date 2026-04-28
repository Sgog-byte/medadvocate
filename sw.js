// MedAdvocate Service Worker — v3

const CACHE_NAME = 'medadvocate-v3';
const ASSETS = [
  '/index.html',
  '/advocate-app.html',
  '/advocate-symptoms.html',
  '/advocate-labs.html',
  '/advocate-credibility.html',
  '/advocate-iep.html',
  '/advocate-er.html',
  '/advocate-insurance.html',
  '/advocate-explain.html',
  '/advocate-myadvocate.html',
  '/advocate-privacy.html',
  '/advocate-summary.html',
  '/advocate-scripts.html',
  '/advocate-documents.html',
  '/advocate-recorder.html',
  '/advocate-locked.html',
  '/advocate-checkout.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(ASSETS).catch(err => console.warn('Cache error:', err))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('anthropic.com') || event.request.url.includes('replit.app')) return;

  // HTML — network first so updates always land
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(res => { const c=res.clone(); caches.open(CACHE_NAME).then(cache=>cache.put(event.request,c)); return res; })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Fonts — network first
  if (event.request.url.includes('fonts.googleapis.com') || event.request.url.includes('fonts.gstatic.com')) {
    event.respondWith(
      fetch(event.request)
        .then(res => { const c=res.clone(); caches.open(CACHE_NAME).then(cache=>cache.put(event.request,c)); return res; })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else — cache first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
