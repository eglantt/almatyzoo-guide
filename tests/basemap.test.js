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
    check('Б2o. Спутник посетителя — обычный адрес снимков, без меток (0.1.10)', u2.length === 1 && /arcgisonline/.test(u2[0]) && !/\?/.test(u2[0]), u2);
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

  // ---- 0.1.11 ----
  const topo = JSON.parse(read('map/topo.json')), base = JSON.parse(read('map/base.json'));
  const inPoly = (pt, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi) c = !c; } return c; };
  const place = id => D.places.find(p => p.id === id);
  const enterField = async A => {
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
    A.$('#authInput').value = '12345'; A.click('#authOk'); await A.wait(900); A.click('[data-p="field"]'); await A.wait(5);
    A.click('[data-tab="map"]'); await A.wait(5);
  };

  // Б5. Здания: из исходных линий чертежа + OSM там, где топосъёмка их не перекрывает
  { const bld = topo.features.filter(f => f.c === 'tbld');
    check('Б5a. Зданий на схеме не меньше 170 (было 106)', bld.length >= 170, bld.length);
    const pr = place('predators');
    check('Б5b. Дом хищников (круглое здание) на схеме', bld.some(f => inPoly([pr.lat, pr.lng], f.g[0])));
    const el = place('elephant'), hp = place('hippos');
    const near = (p, m) => bld.some(f => f.g[0].some(([la, lo]) => Math.hypot((la - p.lat) * 111320, (lo - p.lng) * 81000) < m));
    check('Б5c. Здания у слонов и бегемотов на месте (ближе 40 м)', near(el, 40) && near(hp, 40));
    const lines = topo.features.filter(f => f.t === 'l');
    check('Б5d. У каждой ограды и стенки свой номер', lines.every(f => typeof f.id === 'string' && f.id.length >= 6) && new Set(lines.map(f => f.id)).size === lines.length);
    check('Б5e. data.json: basemapHide — список номеров, все есть в карте', Array.isArray(D.basemapHide) && D.basemapHide.every(id => lines.some(f => f.id === id)), D.basemapHide); }

  // Б6. Зелень OSM: везде, кроме участка у слонов и бегемотов
  { const green = base.features.filter(f => f.t === 'p' && /^(grass|park|wood)$/.test(f.c));
    const el = place('elephant'), hp = place('hippos');
    const covers = p => green.some(f => inPoly([p.lat, p.lng], f.g[0]) && !(f.g.slice(1).some(h => inPoly([p.lat, p.lng], h))));
    check('Б6a. У слонов и бегемотов зелени OSM нет', !covers(el) && !covers(hp));
    const zoo = D.meta.boundary;
    check('Б6b. В остальной части зоопарка зелень OSM осталась', green.filter(f => f.g[0].some(pt => inPoly(pt, zoo))).length >= 2); }

  // Б7. Гибрид — только в полевом режиме
  { const A = await launch({ lang: 'ru', now: SUMMER, basemap: true });
    await A.app.basemapReady; await A.wait(5);
    const map = A.app.map, Ly = A.app.layers;
    const btns = () => A.$$('#baseSwitch button').map(b => b.dataset.base);
    check('Б7a. У посетителя «Схема / Спутник», без «Гибрида»', JSON.stringify(btns()) === '["osm","sat"]', btns());
    await enterField(A);
    check('Б7b. В полевом режиме — «Схема / Спутник / Гибрид»', JSON.stringify(btns()) === '["osm","sat","hyb"]' && A.$('[data-base="hyb"]').textContent === 'Гибрид', btns());
    A.click('[data-base="hyb"]'); await A.wait(5);
    const urls = []; map.eachLayer(l => { if (l._url) urls.push(l._url); });
    map.setZoom(16, { animate: false });
    check('Б7c. «Гибрид»: снимок спутника + линии, без заливок схемы', /arcgisonline/.test(urls.join()) && map.hasLayer(Ly.baseHybrid) && !map.hasLayer(Ly.baseMain) && !map.hasLayer(Ly.baseFence), urls);
    check('Б7d. В гибриде ограды и стенки видны и на масштабе 16', map.hasLayer(Ly.baseHybrid) && Ly.baseHybrid.getLayers().length > 500, Ly.baseHybrid && Ly.baseHybrid.getLayers().length);
    check('Б7e. Подписи улиц в гибриде — на месте, светлые (класс base-hyb)', map.hasLayer(Ly.baseLabels) && map.getContainer().classList.contains('base-hyb'));
    A.click('[data-f="exit"]'); await A.wait(5);
    check('Б7f. После выхода — у посетителя схема, без гибрида и без кнопки «Гибрид»', map.hasLayer(Ly.baseMain) && !map.hasLayer(Ly.baseHybrid) && JSON.stringify(btns()) === '["osm","sat"]', btns());
    await enterField(A);
    check('Б7g. Снова в полевом режиме — гибрид запомнился', map.hasLayer(Ly.baseHybrid) && A.$('[data-base="hyb"]').getAttribute('aria-pressed') === 'true');
    check('Б7h. Без ошибок', A.errors.length === 0, A.errors);
    A.close(); }
  { const A = await launch({ lang: 'ru', now: SUMMER, basemap: true, storage: { zoo_base: 'hyb' } });
    await A.app.basemapReady; await A.wait(5);
    check('Б7i. У посетителя «гибрид» из хранилища не включается — схема', A.app.map.hasLayer(A.app.layers.baseMain) && !A.app.map.hasLayer(A.app.layers.baseHybrid));
    A.close(); }

  // Б8. «Линии схемы»: убрать, «Вернуть», вернуть из списка, экспорт
  { const A = await launch({ lang: 'ru', now: SUMMER, basemap: true });
    await A.app.basemapReady; await A.wait(5);
    const map = A.app.map, Ly = A.app.layers;
    await enterField(A);
    A.click('[data-base="osm"]'); map.setZoom(18, { animate: false }); await A.wait(5);
    const n0 = Ly.baseFence.getLayers().length, h0 = Ly.baseHybrid.getLayers().length;
    A.click('[data-f="blines"]');
    check('Б8a. «Линии схемы» — подсказка «нажмите на ограду или стенку»', /Линии схемы/.test(A.$('#fieldbar').textContent));
    const f = topo.features.find(x => x.c === 'tfence' && x.g.length >= 2), m = [(f.g[0][0] + f.g[1][0]) / 2, (f.g[0][1] + f.g[1][1]) / 2];
    map.fire('click', { latlng: { lat: m[0], lng: m[1] } }); await A.wait(5);
    const bar = A.$('#fieldbar').textContent, sel = (bar.match(/(?:Ограда|Подпорная стенка) (\w+)/) || [])[1];
    check('Б8b. Нажатие у линии — она выбрана, кнопки «Убрать» / «Отмена»', !!sel && !!A.$('[data-f="lineHide"]') && !!A.$('[data-f="lineSelCancel"]'), bar);
    A.click('[data-f="lineHide"]'); await A.wait(5);
    const recs = () => JSON.parse(A.w.localStorage.getItem('zoo_field') || '[]').filter(x => x.type === 'linehide');
    check('Б8c. «Убрать» — линия исчезла со схемы и с гибрида', Ly.baseFence.getLayers().length === n0 - 1 && Ly.baseHybrid.getLayers().length === h0 - 1, [Ly.baseFence.getLayers().length, n0]);
    check('Б8d. Запись «убрана» сохранена', recs().length === 1 && recs()[0].line === sel, recs());
    check('Б8e. 5 секунд — «Вернуть»', !A.$('#toast').hidden && !!A.$('[data-f="undoDel"]'));
    A.click('[data-f="undoDel"]'); await A.wait(5);
    check('Б8f. «Вернуть» — линия снова на месте, записи нет', Ly.baseFence.getLayers().length === n0 && recs().length === 0);
    map.fire('click', { latlng: { lat: m[0], lng: m[1] } }); await A.wait(5); A.click('[data-f="lineHide"]'); await A.wait(5);
    A.click('[data-f="back"]'); A.click('[data-f="list"]'); await A.wait(5);
    const ret = A.$$('#fieldbar [data-f="del"]').find(b => b.textContent === 'Вернуть');
    check('Б8g. В «Списке» убранная линия — с кнопкой «Вернуть»', !!ret && /убрана/.test(A.$('#fieldbar').textContent));
    if (ret) { A.click(ret); await A.wait(5); }
    check('Б8h. «Вернуть» из списка — линия снова на схеме', Ly.baseFence.getLayers().length === n0 && recs().length === 0);
    A.click('[data-f="back"]'); A.click('[data-f="blines"]'); map.fire('click', { latlng: { lat: m[0], lng: m[1] } }); await A.wait(5); A.click('[data-f="lineHide"]'); await A.wait(5);
    const ex = A.app.fn.fieldExport().features.find(x => x.properties.kind === 'linehide');
    check('Б8k. Экспорт: отметка с признаком basemapHide (номер линии) и геометрией линии', !!ex && ex.properties.basemapHide === sel && ex.geometry.type === 'LineString' && ex.geometry.coordinates.length >= 2, ex && ex.properties);
    A.click('[data-f="back"]'); A.click('[data-f="exit"]'); await A.wait(5);
    check('Б8i. Вне полевого режима на этом телефоне линия тоже убрана', Ly.baseFence.getLayers().length === n0 - 1, [Ly.baseFence.getLayers().length, n0]);
    check('Б8j. Без ошибок', A.errors.length === 0, A.errors);
    A.close(); }

  // Б9. basemapHide в data.json — линии нет у посетителя; экспорт отметки
  { const f = topo.features.find(x => x.c === 'tfence');
    const A = await launch({ lang: 'ru', now: SUMMER, basemap: true, patch: d => { d.basemapHide = [f.id]; } });
    await A.app.basemapReady; await A.wait(5);
    const n = A.app.layers.baseFence.getLayers().length, total = topo.features.filter(x => x.c === 'tfence').length;
    check('Б9a. Линия из basemapHide у посетителя не рисуется', n === total - 1, [n, total]);
    A.close(); }
  return done();
};
