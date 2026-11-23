/*
 * Service worker sin dependencias. Funciona con Rutas relativas (base './').
 * Objetivo: después de la primera carga, la aplicación abre y calcula sin red.
 */
const VERSION = 'solar-cuba-v6';
const CACHE = VERSION + '-shell';

const CORE = [
  '',
  'index.html',
  'manifest.webmanifest',
  'fonts/space-grotesk.woff2',
  'fonts/instrument-serif-regular.woff2',
  'fonts/instrument-serif-italic.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable.png',
];

function scopeUrl(path) {
  return new URL(path.replace(/^\.\//, ''), self.registration.scope).toString();
}

async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(CORE.map((path) => cache.add(scopeUrl(path))));
  try {
    const response = await cache.match(scopeUrl('index.html'));
    if (!response) return;
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|woff2|png|svg))"/g)]
      .map((match) => match[1])
      .filter((url) => !url.startsWith('http') && !url.startsWith('data:'));
    await Promise.allSettled(assets.map((url) => cache.add(scopeUrl(url))));
  } catch (_) {
    // Si no se puede leer el HTML, el caché en tiempo de ejecución cubre el resto.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(scopeUrl('index.html'), copy));
          return response;
        })
        .catch(async () => (await caches.match(scopeUrl('index.html'))) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
