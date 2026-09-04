/* Service Worker — Reino Mágico do Saber
 * APP_BUILD e PRECACHE_URLS são gerados por scripts/generate-version.js
 */
const APP_BUILD = '20260904-113010';
const STATIC_CACHE = `reino-static-${APP_BUILD}`;

// GENERATED_PRECACHE_START
const PRECACHE_URLS = [
  '/answer-events-sync.js?v=20260904-113010',
  '/app-update.js?v=20260904-113010',
  '/favicon.ico',
  '/game-history.js?v=20260904-113010',
  '/html-escape.js?v=20260904-113010',
  '/icon-any-192.png',
  '/icon-any-512.png',
  '/index.html',
  '/knowledge-repository.js?v=20260904-113010',
  '/manifest.webmanifest',
  '/multiplayer-controller.js?v=20260904-113010',
  '/multiplayer-sync.js?v=20260904-113010',
  '/player-names.js?v=20260904-113010',
  '/question-bank.js?v=20260904-113010',
  '/question-engine.js?v=20260904-113010',
  '/question-engine/adivinha-answer-pool.js?v=20260904-113010',
  '/question-engine/adivinha-distractors.js?v=20260904-113010',
  '/question-engine/adivinha-verify.js?v=20260904-113010',
  '/question-engine/age-validators.js?v=20260904-113010',
  '/question-engine/category-validators.js?v=20260904-113010',
  '/question-engine/content-safety-data.js?v=20260904-113010',
  '/question-engine/content-safety.js?v=20260904-113010',
  '/question-engine/difficulty-estimate.js?v=20260904-113010',
  '/question-engine/engine-config.js?v=20260904-113010',
  '/question-engine/factual-verify.js?v=20260904-113010',
  '/question-engine/format-validators.js?v=20260904-113010',
  '/question-engine/issue-codes.js?v=20260904-113010',
  '/question-engine/issue-overrides.js?v=20260904-113010',
  '/question-engine/knowledge-key-compute.js?v=20260904-113010',
  '/question-engine/knowledge-key.js?v=20260904-113010',
  '/question-engine/known-facts.js?v=20260904-113010',
  '/question-engine/mc-assembly.js?v=20260904-113010',
  '/question-engine/mc-validators.js?v=20260904-113010',
  '/question-engine/persistent-history.js?v=20260904-113010',
  '/question-engine/prompt-builder.js?v=20260904-113010',
  '/question-engine/pt-pt-validators.js?v=20260904-113010',
  '/question-engine/question-scoring.js?v=20260904-113010',
  '/question-engine/repetition-validators.js?v=20260904-113010',
  '/question-engine/reported-content.js?v=20260904-113010',
  '/question-engine/retry-strategy.js?v=20260904-113010',
  '/question-engine/semantic-validators.js?v=20260904-113010',
  '/question-engine/telemetry.js?v=20260904-113010',
  '/supabase-client.js?v=20260904-113010',
  '/supabase-config.js?v=20260904-113010',
];
// GENERATED_PRECACHE_END

function isNavigation(request) {
  return request.mode === 'navigate'
    || (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

function isNetworkOnly(url) {
  return url.pathname.startsWith('/api/')
    || url.pathname === '/version.json'
    || url.pathname === '/changelog.json'
    || url.pathname === '/sw.js'
    || url.pathname === '/app-update.js'
    || url.pathname.startsWith('/admin/')
    || url.pathname === '/admin-reports.html';
}

function isStaticAsset(pathname) {
  return /\.(js|css|woff2?|png|jpe?g|webp|svg|ico)$/i.test(pathname);
}

async function cacheMatchFlexible(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  if (isStaticAsset(new URL(request.url).pathname)) {
    return caches.match(request, { ignoreSearch: true });
  }
  return undefined;
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
    const cached = await cacheMatchFlexible(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cacheMatchFlexible(request);
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
  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(PRECACHE_URLS.map(async (urlPath) => {
      try {
        const url = new URL(urlPath, self.location.origin).toString();
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
