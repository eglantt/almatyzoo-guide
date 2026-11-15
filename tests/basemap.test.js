/* Набор basemap (0.1.9): своя карта-подложка — файлы, отрисовка, детали по масштабу, подписи улиц, подпись OSM, спутник. */
'use strict';
const { suite, launch, read } = require('./harness');

const SUMMER = '2026-07-08T12:00:00';

module.exports = async function () {
  const { check, done } = suite('basemap');
  const D = JSON.parse(read('data.json'));

  // К1. Файлы карты
  { let base = null, topo = null;
    try { base = JSON.parse(read('map/base.json')); } catch (e) { /* нет файла */ }
    try { topo = JSON.parse(read('map/topo.json')); } catch (e) { /* нет файла */ }
    check('Б1a. map/base.json есть и читается', !!base && Array.isArray(base.features));
    check('Б1b. map/topo.json есть и читается', !!topo && Array.isArray(topo.features));
    if (base && topo) {
      const kb = f => Math.round(Buffer.byteLength(read(f)) / 1024);
      check('Б1c. Размер: город до 1,5 МБ, топосъёмка до 300 КБ', kb('map/base.json') <= 1536 && kb('map/topo.json') <= 300, { base: kb('map/base.json'), topo: kb('map/topo.json') });
      const [[s, w], [n, e]] = D.meta.bounds, py = (n - s) * 0.06, px = (e - w) * 0.06;
      const pts = f => f.t === 'p' ? f.g.flat() : f.g;
      const out = [...base.features, ...topo.features].filter(f => pts(f).some(([la, lo]) => la < s - py || la > n + py || lo < w - px || lo > e + px));
      check('Б1d. Все координаты внутри рамки карты (с запасом)', out.length === 0, out.slice(0, 2));
      const okC = /^(resid|grass|park|wood|pitch|play|parking|pool|water|bld|fenceArea|river|stream|road-[a-z_]+|foot|steps|fence|hedge)$/;
      check('Б1e. У каждого объекта города известный класс', base.features.every(f => okC.test(f.c) && (f.t === 'p' || f.t === 'l')), base.features.find(f => !okC.test(f.c)));
      const tc = {}; topo.features.forEach(f => { tc[f.c] = (tc[f.c] || 0) + 1; });
      check('Б1f. Топосъёмка: здания, водоёмы, ограды, стенки', tc.tbld > 50 && tc.twater > 5 && tc.tfence > 100 && tc.twall > 0, tc);
      check('Б1g. Подписи трёх улиц: Есенберлина, Орманова, Апорт', JSON.stringify((base.labels || []).map(l => l.id).sort()) === JSON.stringify(['aport', 'ormanov', 'yesenberlin']), base.labels);
      check('Б1h. Источник OSM указан в файле (ODbL)', /OpenStreetMap/.test(base.source) && /ODbL/.test(base.source), base.source);
    }
    const ui = D.ui, three = k => ui[k] && ['kz', 'ru', 'en'].every(l => ui[k][l]);
    check('Б1i. Названия улиц и подпись OSM — на трёх языках', ['street_yesenberlin', 'street_ormanov', 'street_aport', 'osmAttr'].every(three));
    check('Б1j. Картинки OSM отключены настройкой (settings.osmTiles = false)', D.settings.osmTiles === false, D.settings.osmTiles);
  }

  // Б2. Отрисовка в приложении
  { const A = await launch({ lang: 'ru', now: SUMMER, basemap: true });
    const ok = await A.app.basemapReady; await A.wait(10);
    const map = A.app.map, Ly = A.app.layers;
    check('Б2a. Подложка загружена', ok === true, ok);
    const count = g => g ? g.getLayers().length : 0;
    check('Б2b. Город и топосъёмка нарисованы (тысячи объектов)', count(Ly.baseMain) > 4000, count(Ly.baseMain));
    const urls = []; map.eachLayer(l => { if (l._url) urls.push(l._url); });
    check('Б2c. Ни одного слоя картинок: ни OSM, ни спутника', urls.length === 0, urls);
    check('Б2d. Подложка — под всеми слоями приложения (панель 150 ниже тайлов 200 и слоёв 400)', map.getPane('basemap').style.zIndex === '150', map.getPane('basemap').style.zIndex);
    map.setZoom(16, { animate: false });
    check('Б2e. Масштаб 16: оград и стенок нет', !map.hasLayer(Ly.baseFence) && !map.hasLayer(Ly.baseWall));
    map.setZoom(17, { animate: false });
    check('Б2f. Масштаб 17: ограды есть, стенок нет', map.hasLayer(Ly.baseFence) && !map.hasLayer(Ly.baseWall));
    map.setZoom(18, { animate: false });
    check('Б2g. Масштаб 18: ограды и стенки', map.hasLayer(Ly.baseFence) && map.hasLayer(Ly.baseWall));
    // подписи улиц и подпись OSM на языке интерфейса
    const street = id => { const el = A.$(`[data-street="${id}"]`); return el ? el.textContent : null; };
    const attr = () => map.attributionControl.getContainer().textContent;
    check('Б2h. Подписи улиц по-русски', street('yesenberlin') === 'улица Есенберлина' && street('ormanov') === 'улица Гали Орманова' && street('aport') === 'улица Апорт',
      [street('yesenberlin'), street('ormanov'), street('aport')]);
    check('Б2i. Подписи повёрнуты по направлению улицы', /rotate\(-?\d/.test(A.$('[data-street="ormanov"]').getAttribute('style')));
    check('Б2j. Подпись OSM: «© участники OpenStreetMap»', attr().includes('© участники OpenStreetMap'), attr());
    A.click('.langsw [data-lang="kz"]'); await A.wait(5);
    check('Б2k. Казахский: «Есенберлин көшесі», «© OpenStreetMap қатысушылары»', street('yesenberlin') === 'Есенберлин көшесі' && attr().includes('OpenStreetMap қатысушылары') && !attr().includes('участники'), [street('yesenberlin'), attr()]);
    A.click('.langsw [data-lang="en"]'); await A.wait(5);
    check('Б2l. Английский: «Gali Ormanov Street», «© OpenStreetMap contributors»', street('ormanov') === 'Gali Ormanov Street' && attr().includes('OpenStreetMap contributors'), [street('ormanov'), attr()]);
    check('Б2m. Подписи не задвоились после смены языка', A.$$('[data-street]').length === 3, A.$$('[data-street]').length);
    // спутник у посетителя: подложка скрыта, снимки без метки полевого режима (не сохраняются)
    A.click('[data-base="sat"]'); await A.wait(5);
    const u2 = []; map.eachLayer(l => { if (l._url) u2.push(l._url); });
    check('Б2n. «Спутник»: своя схема и подписи скрыты', !map.hasLayer(Ly.baseMain) && !map.hasLayer(Ly.baseFence) && !map.hasLayer(Ly.baseLabels));
    check('Б2o. Спутник посетителя — без метки ?zoo=field', u2.length === 1 && /arcgisonline/.test(u2[0]) && !/zoo=field/.test(u2[0]), u2);
    A.click('[data-base="osm"]'); await A.wait(5);
    check('Б2p. Обратно «Схема» — подложка и подписи на месте', map.hasLayer(Ly.baseMain) && map.hasLayer(Ly.baseLabels) && map.getContainer().classList.contains('base-scheme'));
    check('Б2q. Без ошибок', A.errors.length === 0, A.errors);
    A.close(); }

  // Б3. Файлов карты нет (первый запуск без сети) — приложение работает, остальная карта на месте
  { const A = await launch({ lang: 'ru', now: SUMMER });
    const ok = await A.app.basemapReady; await A.wait(5);
    const log = JSON.parse(A.w.localStorage.getItem('zoo_errors') || '[]');
    check('Б3a. Без файлов карты — без падения, ошибка записана в журнал', ok === false && A.errors.length === 0 && log.some(x => /basemap/.test(x.m)), log);
    check('Б3b. Маркеры и контур зоопарка на месте', Object.keys(A.app.markers).length > 10);
    A.close(); }

  // Б4. settings.osmTiles = true — картинки OSM снова показываются поверх своей схемы
  { const A = await launch({ lang: 'ru', now: SUMMER, basemap: true, patch: d => { d.settings.osmTiles = true; } });
    await A.app.basemapReady; await A.wait(5);
    const urls = []; A.app.map.eachLayer(l => { if (l._url) urls.push(l._url); });
    check('Б4. osmTiles: true — слой tile.openstreetmap.org на «Схеме»', urls.length === 1 && /tile\.openstreetmap\.org/.test(urls[0]), urls);
    A.close(); }

  return done();
};
