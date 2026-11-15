/* =====================================================================
   Путеводитель по Алматинскому зоопарку — Service Worker
   По образцу SLDT (docs/ref-sldt-update-and-key-gate.md) + кэш тайлов карты.
   ПРАВИЛО РЕЛИЗА: CACHE_VERSION меняется вместе с версией приложения
   (проверяется тестом version). ASSETS_VERSION — только при замене
   содержимого существующих шрифтов/картинок.
   ===================================================================== */
const CACHE_VERSION = '0.1.14-alpha';
const ASSETS_VERSION = 'v1';
const TILES_VERSION = 'v2';          // 0.1.9: старый кэш tiles-v1 (с картинками OSM) удаляется
const APP_CACHE = `app-${CACHE_VERSION}`;
const ASSETS_CACHE = `assets-${ASSETS_VERSION}`;
const TILES_CACHE = `tiles-${TILES_VERSION}`;
// 0.1.12: «Вид сверху» — свои плитки map/top/<TOP_VERSION>/ (= settings.topView в data.json, проверяется тестом).
// Отдельный кэш: новая сборка рендера — новая версия, старые плитки удаляются при активации.
const TOP_VERSION = 'r3';
const TOP_DIR = `./map/top/${TOP_VERSION}/`;
const TOP_CACHE = `top-${TOP_VERSION}`;
const TOP_PARALLEL = 6;
const NAV_TIMEOUT_MS = 3500;
const TILES_MAX = 1500;          // предел числа снимков спутника в кэше (≈ 30–40 МБ)

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
  './logo-white.svg',
  './map/base.json', './map/topo.json'          // 0.1.9: своя карта-подложка
];
// Снимки спутника сохраняются в телефоне — и у посетителя, и в полевом режиме (0.1.10, как до 0.1.9; к релизу — отдельное решение).
// Картинки OSM идут мимо воркера: правила OSM не разрешают хранение для офлайна.
const SAT_HOST = 'server.arcgisonline.com';
const isSatTile = url => url.hostname === SAT_HOST;

const isAssetPath = p => p.includes('/fonts/') || p.includes('/map/') || p.endsWith('/logo-white.svg');
const isCacheable = r => r && r.ok;
// Служебные папки репозитория не кэшируются
const isExcluded = p => /\/(tests|demo|docs|tools)\//.test(p);

self.addEventListener('install', e => e.waitUntil(
  caches.open(APP_CACHE)
    .then(c => c.addAll(CORE_FILES.map(u => new Request(u, { cache: 'reload' }))))   // мимо HTTP-кэша
    .then(() => self.skipWaiting())
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys
      .filter(k => k !== APP_CACHE && k !== ASSETS_CACHE && k !== TILES_CACHE && k !== TOP_CACHE)
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
    await prefetchTopView();
  })();
}
/** «Вид сверху»: список плиток из index.json → все плитки в кэш (по TOP_PARALLEL одновременно), уже лежащие — пропускаются. */
async function prefetchTopView() {
  try {
    const cache = await caches.open(TOP_CACHE);
    const ixUrl = TOP_DIR + 'index.json';
    let ix = await cache.match(ixUrl);
    if (!ix) { const r = await fetch(ixUrl); if (!isCacheable(r)) return; await cache.put(ixUrl, r.clone()); ix = r; }
    const list = ((await ix.json()).tiles || []).map(k => TOP_DIR + k + '.webp');
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const url = list[i++];
        try { if (await cache.match(url)) continue; const r = await fetch(url); if (isCacheable(r)) await cache.put(url, r); } catch (e) { /* следующая */ }
      }
    };
    await Promise.all(Array.from({ length: TOP_PARALLEL }, worker));
  } catch (err) { /* без сети — докачается при следующем открытии */ }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (isSatTile(url)) event.respondWith(tileFirst(req));
    return;                                              // прочие чужие сайты — мимо воркера
  }
  if (isExcluded(url.pathname)) return;
  if (req.mode === 'navigate') { handleNavigation(event); event.waitUntil(prefetchAssetsOnce()); return; }
  const cacheName = url.pathname.includes('/map/top/') ? TOP_CACHE : isAssetPath(url.pathname) ? ASSETS_CACHE : APP_CACHE;
  event.respondWith(cacheFirst(req, cacheName));
});
