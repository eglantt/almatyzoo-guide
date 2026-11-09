/* =====================================================================
   Путеводитель по Алматинскому зоопарку — Service Worker
   По образцу SLDT (docs/ref-sldt-update-and-key-gate.md) + кэш тайлов карты.
   ПРАВИЛО РЕЛИЗА: CACHE_VERSION меняется вместе с версией приложения
   (проверяется тестом version). ASSETS_VERSION — только при замене
   содержимого существующих шрифтов/картинок.
   ===================================================================== */
const CACHE_VERSION = '0.1.0-alpha';
const ASSETS_VERSION = 'v1';
const TILES_VERSION = 'v1';
const APP_CACHE = `app-${CACHE_VERSION}`;
const ASSETS_CACHE = `assets-${ASSETS_VERSION}`;
const TILES_CACHE = `tiles-${TILES_VERSION}`;
const NAV_TIMEOUT_MS = 3500;
const TILES_MAX = 1500;          // предел числа тайлов в кэше (≈ 30–40 МБ)

// Каркас: маленький и обязательный. Без него установка не проходит.
const CORE_FILES = [
  './', './index.html', './styles.css', './app.js', './data.json', './manifest.json',
  './lib/leaflet.js', './lib/leaflet.css',
  './logo.svg', './icons/sprite.svg',
  './icons/app-192.png', './icons/app-512.png',
  './icons/app-maskable-192.png', './icons/app-maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon.svg', './icons/favicon-32.png', './icons/favicon-16.png'
];
// Тяжёлое: докачивается в фоне один раз.
const ASSET_FILES = [
  './fonts/nunito-latin-400-normal.woff2', './fonts/nunito-cyrillic-400-normal.woff2', './fonts/nunito-cyrillic-ext-400-normal.woff2',
  './fonts/nunito-latin-700-normal.woff2', './fonts/nunito-cyrillic-700-normal.woff2', './fonts/nunito-cyrillic-ext-700-normal.woff2',
  './logo-white.svg'
];
// Тайлы подложки: OSM и спутник (только полевой режим)
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];

const isAssetPath = p => p.includes('/fonts/') || p.endsWith('/logo-white.svg');
const isCacheable = r => r && r.ok;
// Служебные папки репозитория не кэшируются
const isExcluded = p => /\/(tests|demo|docs)\//.test(p);

self.addEventListener('install', e => e.waitUntil(
  caches.open(APP_CACHE)
    .then(c => c.addAll(CORE_FILES.map(u => new Request(u, { cache: 'reload' }))))   // мимо HTTP-кэша
    .then(() => self.skipWaiting())
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys
      .filter(k => k !== APP_CACHE && k !== ASSETS_CACHE && k !== TILES_CACHE)
      .map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (err) { return Response.error(); }
}

/** Тайлы: «сначала кэш», без сети — ошибка (Leaflet покажет пустой квадрат). Размер кэша ограничен. */
let tilePuts = 0;
async function tileFirst(request) {
  const cache = await caches.open(TILES_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
      if (++tilePuts % 50 === 0) trimTiles(cache);
    }
    return response;
  } catch (err) { return Response.error(); }
}
async function trimTiles(cache) {
  const keys = await cache.keys();
  const extra = keys.length - TILES_MAX;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);   // сначала самые старые
}

function handleNavigation(event) {
  const network = fetch(event.request, { cache: 'no-cache' })
    .then(async r => {
      if (isCacheable(r)) (await caches.open(APP_CACHE)).put('./index.html', r.clone());
      return r;
    });
  event.waitUntil(network.catch(() => {}));            // запоздавший ответ — к следующему открытию
  event.respondWith((async () => {
    let net = null;
    try {
      net = await Promise.race([network, new Promise(res => setTimeout(() => res(null), NAV_TIMEOUT_MS))]);
      if (net && net.ok) return net;
    } catch (e) { /* офлайн */ }
    const cache = await caches.open(APP_CACHE);
    const cached = (await cache.match(event.request, { ignoreSearch: true })) ||
                   (await cache.match('./index.html')) || (await cache.match('./'));
    if (cached) return cached;
    if (net) return net;
    try { return await network; } catch (e) { return Response.error(); }
  })());
}

let assetsPrefetchStarted = false;
function prefetchAssetsOnce() {
  if (assetsPrefetchStarted) return Promise.resolve();
  assetsPrefetchStarted = true;
  return (async () => {
    const cache = await caches.open(ASSETS_CACHE);
    for (const url of ASSET_FILES) {
      try {
        if (await cache.match(url)) continue;
        const response = await fetch(url);
        if (isCacheable(response)) await cache.put(url, response);
      } catch (err) { /* следующий файл */ }
    }
  })();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (TILE_HOSTS.includes(url.hostname)) event.respondWith(tileFirst(req));
    return;                                              // прочие чужие сайты — мимо воркера
  }
  if (isExcluded(url.pathname)) return;
  if (req.mode === 'navigate') { handleNavigation(event); event.waitUntil(prefetchAssetsOnce()); return; }
  event.respondWith(cacheFirst(req, isAssetPath(url.pathname) ? ASSETS_CACHE : APP_CACHE));
});
