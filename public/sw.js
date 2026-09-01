/* Service Worker — Reino Mágico do Saber
 * APP_BUILD é substituído em cada deploy por scripts/generate-version.js
 */
const APP_BUILD = '20260830-192950';
const STATIC_CACHE = `reino-static-${APP_BUILD}`;
const PRECACHE_URLS = [
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icon-any-192.png',
  '/icon-any-512.png',
];

function isNavigation(request) {
  return request.mode === 'navigate'
    || (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

function isNetworkOnly(url) {
  return url.pathname.startsWith('/api/')
    || url.pathname === '/version.json'
    || url.pathname === '/changelog.json'
    || url.pathname === '/sw.js'
    || url.pathname === '/app-update.js';
}

function versionedUrl(pathname) {
  const url = new URL(pathname, self.location.origin);
  url.searchParams.set('v', APP_BUILD);
  return url.toString();
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error('offline');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await caches.match(request);
  const networkPromise = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }
  const response = await networkPromise;
  if (response) return response;
  throw new Error('offline');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const assets = [
      versionedUrl('/question-engine/issue-codes.js'),
      versionedUrl('/question-engine/knowledge-key.js'),
      versionedUrl('/question-engine/retry-strategy.js'),
      versionedUrl('/question-engine/known-facts.js'),
      versionedUrl('/question-engine.js'),
      ...PRECACHE_URLS.map((path) => versionedUrl(path)),
    ];
    await Promise.all(assets.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'no-cache' });
        if (response.ok) await cache.put(url, response);
      } catch {
        /* ignorar falhas pontuais no precache */
      }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('reino-static-') && key !== STATIC_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isNetworkOnly(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (isNavigation(event.request) || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});
