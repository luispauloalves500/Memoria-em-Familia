const CACHE_APP = 'memorias-familia-app-v2.1.0';
const CACHE_MEDIA = 'memorias-familia-media-v2.1.0';
const APP_SHELL = [
  './', './index.html', './styles.css', './app.js', './vault.js', './manifest.webmanifest',
  './assets/vault/manifest.json',
  './assets/icons/app-icon-192.png', './assets/icons/app-icon-512.png',
  './assets/icons/apple-touch-icon.png', './assets/icons/favicon-32.png', './assets/icons/favicon-16.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_APP).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![CACHE_APP, CACHE_MEDIA].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Nunca intercepta rádio, APIs ou outros domínios.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_APP);
        if (response.ok) cache.put('./index.html', response.clone());
        return response;
      } catch (_) {
        return (await caches.open(CACHE_APP)).match('./index.html');
      }
    })());
    return;
  }

  // Fotos do casamento continuam criptografadas também no cache offline.
  if (url.pathname.includes('/assets/vault/')) {
    event.respondWith(staleWhileRevalidate(request, CACHE_MEDIA));
    return;
  }

  // Arquivos estáticos do app: cache-first, sem devolver index.html para imagens/JS que falharem.
  event.respondWith(cacheFirst(request, CACHE_APP).catch(() => new Response('', { status: 504 })));
});
