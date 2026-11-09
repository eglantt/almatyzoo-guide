/* Набор sw: Service Worker в песочнице Node (vm) с поддельными кэшами и сетью. */
'use strict';
const vm = require('vm');
const { suite, read } = require('./harness');

const ORIGIN = 'https://zoo.test/app/';
const abs = u => new URL(u, ORIGIN).href;

/** Поддельный мир: кэши, сеть, события. */
function world(net = {}) {
  const stores = new Map();
  const log = { fetched: [], skipWaiting: 0, claim: 0 };
  class Cache {
    constructor() { this.m = new Map(); }
    key(r) { return abs(typeof r === 'string' ? r : r.url); }
    async match(r, o) { let k = this.key(r); if (o && o.ignoreSearch) k = k.split('?')[0]; return this.m.get(k); }
    async put(r, res) { this.m.set(this.key(r), res); }
    async addAll(list) { const out = []; for (const r of list) { const res = await sb.fetch(r); if (!res.ok) throw new Error('addAll: ' + r.url); out.push([r, res]); } out.forEach(([r, res]) => this.m.set(this.key(r), res)); }
    async keys() { return [...this.m.keys()].map(url => ({ url })); }
    async delete(r) { return this.m.delete(this.key(r)); }
  }
  const caches = {
    async open(n) { if (!stores.has(n)) stores.set(n, new Cache()); return stores.get(n); },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); }
  };
  const mkRes = (url, status = 200) => ({ url, ok: status >= 200 && status < 300, status, clone() { return mkRes(url, status); } });
  const listeners = {};
  const sb = {
    self: null, caches, URL, Promise, setTimeout, clearTimeout, console,
    Request: class { constructor(u, o) { this.url = abs(u); this.cache = o && o.cache; this.method = 'GET'; } },
    Response: { error: () => ({ ok: false, status: 0, error: true }) },
    async fetch(r) {
      const url = abs(typeof r === 'string' ? r : r.url);
      log.fetched.push(url);
      if (net.offline) throw new TypeError('offline');
      const path = url.replace(ORIGIN, '');
      if (net.delay && net.delay[path] != null) await new Promise(res => setTimeout(res, net.delay[path]));
      if (net.status && net.status[path]) return mkRes(url, net.status[path]);
      return mkRes(url, 200);
    }
  };
  sb.self = {
    location: { origin: 'https://zoo.test', href: ORIGIN },
    addEventListener: (t, f) => { listeners[t] = f; },
    skipWaiting: async () => { log.skipWaiting++; },
    clients: { claim: async () => { log.claim++; } }
  };
  sb.addEventListener = sb.self.addEventListener;
  vm.createContext(sb);
  vm.runInContext(read('sw.js'), sb);
  /** Событие с waitUntil/respondWith; возвращает {responded, response, waits}. */
  async function fire(type, data = {}) {
    const waits = []; let responded = null;
    const ev = Object.assign({ waitUntil: p => waits.push(p), respondWith: p => { responded = p; } }, data);
    listeners[type](ev);
    const response = responded ? await responded : undefined;
    return { responded: !!responded, response, waits, settle: () => Promise.allSettled(waits) };
  }
  const req = (u, mode = 'no-cors') => ({ request: { url: abs(u), method: 'GET', mode } });
  return { sb, caches, stores, log, fire, req, net };
}

module.exports = async function () {
  const { check, done } = suite('sw');
  const src = read('sw.js');
  const ver = src.match(/CACHE_VERSION = '([^']+)'/)[1];
  const APP = 'app-' + ver;
  const core = eval('(' + src.match(/const CORE_FILES = (\[[\s\S]*?\]);/)[1] + ')');

  // S1. Установка: только каркас, мимо HTTP-кэша, skipWaiting
  { const W = world(); const r = await W.fire('install'); await Promise.all(r.waits);
    const c = W.stores.get(APP);
    check('S1a. Установка кладёт в кэш весь каркас', c && core.every(u => c.m.has(abs(u))), c && c.m.size);
    check('S1b. При установке не качаются шрифты (они не в каркасе)', !W.log.fetched.some(u => u.includes('/fonts/')));
    check('S1c. skipWaiting вызван', W.log.skipWaiting === 1); }

  // S2. Недоступный файл каркаса отменяет установку (старый воркер работает дальше)
  { const W = world({ status: { 'data.json': 404 } }); const r = await W.fire('install'); const res = await Promise.allSettled(r.waits);
    check('S2. 404 файла каркаса — установка отменяется, skipWaiting не вызван', res[0].status === 'rejected' && W.log.skipWaiting === 0); }

  // S3. Активация: старые кэши удалены, ресурсы и тайлы сохранены, claim
  { const W = world(); for (const n of ['app-0.0.9', 'assets-v1', 'tiles-v1', 'zoo-old']) await W.caches.open(n);
    const r = await W.fire('activate'); await Promise.all(r.waits);
    const keys = await W.caches.keys();
    check('S3a. Старые кэши удалены', !keys.includes('app-0.0.9') && !keys.includes('zoo-old'), keys);
    check('S3b. Кэши ресурсов и тайлов сохранены', keys.includes('assets-v1') && keys.includes('tiles-v1'), keys);
    check('S3c. clients.claim вызван', W.log.claim === 1); }

  // S4. Страница: из сети, если сеть отвечает
  { const W = world(); const r = await W.fire('fetch', W.req('./', 'navigate'));
    check('S4. Страница берётся из сети', r.response && r.response.ok && W.log.fetched.some(u => u === abs('./'))); await r.settle(); }

  // S5. Офлайн — страница из кэша
  { const W = world(); const c = await W.caches.open(APP); await c.put('./index.html', { ok: true, status: 200, cached: true, clone() { return this; } });
    W.net.offline = true; const r = await W.fire('fetch', W.req('./', 'navigate')); await r.settle();
    check('S5. Без сети страница отдаётся из кэша', r.response && r.response.cached === true); }

  // S6. Долгий ответ (> 3,5 с) — из кэша; запоздавший ответ ложится в кэш
  { const W = world({ delay: { '': 4200 } }); const c = await W.caches.open(APP); await c.put('./index.html', { ok: true, status: 200, cached: true, clone() { return this; } });
    const t0 = Date.now(); const r = await W.fire('fetch', W.req('./', 'navigate')); const dt = Date.now() - t0;
    check('S6a. Медленная сеть — через ~3,5 с отдаётся кэш', r.response && r.response.cached === true && dt >= 3400 && dt < 4100, dt + ' мс');
    await r.settle();
    const after = await c.match('./index.html');
    check('S6b. Запоздавший ответ сети сохранён в кэш к следующему открытию', after && !after.cached); }

  // S7. Фоновая докачка ресурсов: один раз, по одному файлу
  { const W = world(); const r1 = await W.fire('fetch', W.req('./', 'navigate')); await r1.settle();
    const fontsFetched = () => W.log.fetched.filter(u => u.includes('/fonts/')).length;
    const n1 = fontsFetched();
    const r2 = await W.fire('fetch', W.req('./', 'navigate')); await r2.settle();
    check('S7a. Шрифты докачаны в кэш ресурсов', n1 === 6 && (await W.caches.open('assets-v1')).m.size >= 6, n1);
    check('S7b. Повторная навигация не качает их снова', fontsFetched() === n1); }

  // S8. Обычный файл — «сначала кэш»
  { const W = world(); const c = await W.caches.open(APP); await c.put('./app.js', { ok: true, status: 200, cached: true, clone() { return this; } });
    const r = await W.fire('fetch', W.req('./app.js'));
    check('S8. Файл из кэша без обращения к сети', r.response.cached === true && !W.log.fetched.includes(abs('./app.js'))); }

  // S9. Тайлы карты: кэшируются, повторно берутся из кэша
  { const W = world(); const url = 'https://tile.openstreetmap.org/17/1/2.png';
    const r1 = await W.fire('fetch', { request: { url, method: 'GET', mode: 'cors' } });
    const r2 = await W.fire('fetch', { request: { url, method: 'GET', mode: 'cors' } });
    check('S9a. Тайл OSM обработан воркером', r1.responded && r1.response.ok);
    check('S9b. Второй раз тайл взят из кэша, сеть не трогается', r2.responded && W.log.fetched.filter(u => u === url).length === 1); }

  // S10. Тайл без сети и без кэша — ошибка, но не падение
  { const W = world({ offline: true }); const r = await W.fire('fetch', { request: { url: 'https://tile.openstreetmap.org/17/9/9.png', method: 'GET', mode: 'cors' } });
    check('S10. Тайл офлайн — пустой ответ без исключения', r.responded && r.response.error === true); }

  // S11. Прочие чужие сайты и служебные папки — мимо воркера
  { const W = world();
    const a = await W.fire('fetch', { request: { url: 'https://2gis.kz/almaty', method: 'GET', mode: 'navigate' } });
    const b = await W.fire('fetch', W.req('./tests/run.js'));
    const d = await W.fire('fetch', W.req('./demo/demo_1.html', 'navigate'));
    check('S11. Чужие сайты, tests/ и demo/ воркер не обрабатывает', !a.responded && !b.responded && !d.responded); }

  // S12. Ограничение размера кэша тайлов
  { const W = world(); const max = +src.match(/TILES_MAX = (\d+)/)[1];
    const c = await W.caches.open('tiles-v1'); for (let i = 0; i < max + 120; i++) await c.put(`https://tile.openstreetmap.org/z/${i}.png`, { ok: true });
    for (let i = 0; i < 50; i++) await W.fire('fetch', { request: { url: `https://tile.openstreetmap.org/new/${i}.png`, method: 'GET', mode: 'cors' } });
    await new Promise(r => setTimeout(r, 50));
    check('S12. Кэш тайлов обрезается до предела', c.m.size <= max, c.m.size + ' > ' + max); }

  // S13. POST не перехватывается
  { const W = world(); const r = await W.fire('fetch', { request: { url: abs('./data.json'), method: 'POST', mode: 'cors' } });
    check('S13. Запросы не GET воркер пропускает', !r.responded); }
  return done();
};
