self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

const MEDIA_ROUTE_CONFIG = [
  { prefix: '/media/thumb/', cacheName: 'lifeserver-media-thumb-v2', maxEntries: 50 },
  { prefix: '/media/preview/', cacheName: 'lifeserver-media-thumb-v2', maxEntries: 50 },
  { prefix: '/media/journal-inline/', cacheName: 'lifeserver-media-thumb-v2', maxEntries: 50 },
  { prefix: '/media/display/', cacheName: 'lifeserver-media-display-v1', maxEntries: 4 },
  { prefix: '/media/full/', cacheName: 'lifeserver-media-full-v2', maxEntries: 6 }
];
const ACTIVE_CACHE_NAMES = new Set(MEDIA_ROUTE_CONFIG.map((entry) => entry.cacheName));

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith('lifeserver-media-') && !ACTIVE_CACHE_NAMES.has(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function getMediaRouteConfig(url) {
  return MEDIA_ROUTE_CONFIG.find((entry) => url.pathname.startsWith(entry.prefix)) || null;
}

function shouldHandleRequest(request) {
  if (!request || request.method !== 'GET') return false;
  if (request.headers.has('range')) return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;

  const route = getMediaRouteConfig(url);
  if (!route) return false;

  if (route.prefix === '/media/full/' && request.destination === 'video') return false;
  return true;
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((request) => cache.delete(request)));
}

async function putResponseInCache(cacheName, maxEntries, request, response) {
  if (!response || !response.ok || response.status !== 200 || response.type === 'error') return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  await trimCache(cacheName, maxEntries);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!shouldHandleRequest(request)) return;

  const route = getMediaRouteConfig(new URL(request.url));
  if (!route) return;

  event.respondWith((async () => {
    const cache = await caches.open(route.cacheName);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) {
      return cached;
    }

    const response = await fetch(request);
    await putResponseInCache(route.cacheName, route.maxEntries, request, response);
    return response;
  })());
});
