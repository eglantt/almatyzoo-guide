/* Набор places (0.1.3): контур и дорожки из OSM, сезонные объекты, временные закрытия,
   зимники, «Найти рядом» мимо закрытого, переключатель «Схема / Спутник», служебные объекты для полевого режима. */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('places');
  const D = JSON.parse(read('data.json'));
  const P = id => D.places.find(p => p.id === id) || {};
  const SUMMER = '2026-07-08T12:00:00';       // среда, лето
  const WINTER = '2026-12-09T12:00:00';       // среда, зима
  const visible = (A, sel) => { let el = typeof sel === 'string' ? A.$(sel) : sel; if (!el) return false; for (; el && el.nodeType === 1; el = el.parentElement) { if (el.hidden || A.w.getComputedStyle(el).display === 'none') return false; } return true; };
  const tiles = A => { const u = []; A.app.map.eachLayer(l => { if (l._url) u.push(/arcgisonline/.test(l._url) ? 'sat' : 'osm'); }); return u.sort().join(','); };
  const enterField = async A => {
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
    A.$('#authInput').value = '12345'; A.click('#authOk'); await A.wait(900); A.click('[data-p="field"]');
  };
  const popupText = (A, id) => { A.app.markers[id].openPopup(); const el = A.w.document.querySelector('.leaflet-popup'); return el ? el.textContent : ''; };

  // М1. Контур и дорожки из OpenStreetMap
  { const B = D.meta.boundary || [];
    const k = 111320 * Math.cos(43.2635 * Math.PI / 180), m = 110540;
    let area = 0; for (let i = 0, j = B.length - 1; i < B.length; j = i++) area += (B[j][1] * k) * (B[i][0] * m) - (B[i][1] * k) * (B[j][0] * m);
    const ha = Math.abs(area / 2) / 1e4;
    check('М1a. Контур зоопарка — многоугольник OSM (не меньше 60 точек), не ориентировочный', B.length >= 60 && D.meta.boundaryApprox === false, { points: B.length, approx: D.meta.boundaryApprox });
    check('М1b. Площадь контура ≈ 21 га (данные зоопарка)', ha > 20.5 && ha < 22.5, ha.toFixed(2));
    check('М1c. Дорожки: не меньше 50 участков, у каждого 2+ точки', Array.isArray(D.paths) && D.paths.length >= 50 && D.paths.every(p => p.coords.length >= 2), D.paths && D.paths.length);
    const minLng = Math.min(...B.map(p => p[1])), e = D.meta.entrance;
    check('М1d. Центральный вход — на западной стороне контура', B.length && e.lng - minLng < 0.0006, e);
    check('М1e. Источник указан: OpenStreetMap, ODbL', !!(D.meta.osm && /OpenStreetMap/.test(D.meta.osm.source) && /ODbL/.test(D.meta.osm.source)));
    const A = await launch({ lang: 'ru', now: SUMMER });
    check('М1f. На карте слой дорожек — все участки', !!A.app.layers.paths && A.app.layers.paths.getLayers().length === (D.paths || []).length);
    let dashed = null; A.app.map.eachLayer(l => { if (l.getLatLngs && l.options && l.options.fillOpacity === 0.08) dashed = l.options.dashArray; });
    check('М1g. Контур сплошной (пунктир был признаком ориентировочного)', dashed === null || dashed === undefined, dashed);
    check('М1h. Запуск без ошибок', A.errors.length === 0, A.errors);
    A.close(); }

  // М2. «Работает только летом» — зимой иконки нет
  check('М2a. Пример: ларёк kiosk-1 — только летом', P('kiosk-1').summerOnly === true);
  { const A = await launch({ lang: 'ru', now: SUMMER });
    check('М2b. Летом ларёк на карте', !!A.app.markers['kiosk-1']); A.close(); }
  { const A = await launch({ lang: 'ru', now: WINTER });
    check('М2c. Зимой ларька на карте нет', !A.app.markers['kiosk-1']);
    check('М2d. Зимой другие объекты на месте', !!A.app.markers['kiosk-2'] && !!A.app.markers['cafe-1']);
    A.close(); }

  // М3. Временное закрытие «с — по» с причиной — иконка скрыта, потом возвращается сама
  const cl = (P('wc-1').closures || [])[0] || {};
  check('М3a. Пример: туалет wc-1 закрыт на ремонт (даты и причина на kz/ru/en)', /^\d{4}-\d\d-\d\d$/.test(cl.from) && /^\d{4}-\d\d-\d\d$/.test(cl.to) && cl.reason && cl.reason.kz && cl.reason.ru && cl.reason.en, cl);
  if (cl.from) {
    const day = (s, add) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + add); return d.toISOString().slice(0, 10) + 'T12:00:00'; };
    { const A = await launch({ lang: 'ru', now: day(cl.from, -1) });
      check('М3b. За день до закрытия туалет на карте', !!A.app.markers['wc-1']); A.close(); }
    { const A = await launch({ lang: 'ru', now: day(cl.from, 0) });
      check('М3c. В первый день закрытия туалета нет', !A.app.markers['wc-1']); A.close(); }
    { const A = await launch({ lang: 'ru', now: day(cl.to, 0) });
      check('М3d. В последний день закрытия туалета нет', !A.app.markers['wc-1']); A.close(); }
    { const A = await launch({ lang: 'ru', now: day(cl.to, 1) });
      check('М3e. На следующий день туалет вернулся сам', !!A.app.markers['wc-1']); A.close(); }
    // М4. «Найти рядом» пропускает закрытое, даже если стоишь рядом
    { const w = P('wc-1'), A = await launch({ lang: 'ru', now: day(cl.from, 0), gps: { lat: w.lat, lng: w.lng, acc: 5 } });
      A.click('#btnNear'); A.click('[data-near="0"]'); await A.wait(60);
      const txt = A.$('#sheetBody').textContent, other = D.places.filter(p => p.cat === 'wc' && p.id !== 'wc-1');
      check('М4a. Туалет на ремонте не предлагается как ближайший', other.length > 0 && txt.includes('Ближайший: ' + other[0].title.ru) && A.app.layers.route.getLayers().length === 1, txt);
      A.close(); }
  }
  { const k = P('kiosk-1'), A = await launch({ lang: 'ru', now: WINTER, gps: { lat: k.lat, lng: k.lng, acc: 5 } });
    A.click('#btnNear'); A.click('[data-near="1"]'); await A.wait(60);
    const f = A.app.fn, open = D.places.filter(p => p.cat === 'food' && p.id !== 'kiosk-1');
    const best = open.reduce((a, p) => f.dist(k, p) < f.dist(k, a) ? p : a);
    check('М4b. Зимой «Кафе рядом» не ведёт к летнему ларьку', A.$('#sheetBody').textContent.includes('Ближайший: ' + best.title.ru), A.$('#sheetBody').textContent);
    A.close(); }

  // М5. Закрытие павильона: пиктограмма остаётся, в попапе и коллекции — «Временно закрыт» с причиной
  { const patch = X => { X.places.find(p => p.id === 'aquarium').closures = [{ from: '2026-12-01', to: '2026-12-20', reason: { kz: 'Карантин', ru: 'Карантин', en: 'Quarantine' } }]; };
    const A = await launch({ lang: 'ru', now: WINTER, patch });
    check('М5a. Закрытый павильон остаётся на карте', !!A.app.markers.aquarium);
    const txt = A.app.markers.aquarium ? popupText(A, 'aquarium') : '';
    check('М5b. В попапе: «Временно закрыт», причина и дата', txt.includes('Временно закрыт') && txt.includes('Карантин') && txt.includes('20.12'), txt);
    A.click('[data-tab="coll"]');
    const item = A.$('#coll-aquarium');
    check('М5c. В коллекции — пометка о закрытии', !!item && item.textContent.includes('Временно закрыт'), item && item.textContent);
    A.close(); }

  // М6. Зимники: свои даты перевода у каждой зоны; переезд в экспонируемый зимник / не экспонируется
  const winterPatch = X => {
    const g = X.places.find(p => p.id === 'giraffes');
    X.zones.find(z => z.id === 'giraffes').winter = { from: '11-15', to: '03-15', mode: 'moves', place: 'winter-giraffes' };
    X.zones.find(z => z.id === 'zebras').winter = { from: '11-01', to: '03-31', mode: 'off' };
    X.places.push({ id: 'winter-giraffes', kind: 'animal', cat: 'winter', winterOf: 'giraffes', icon: g.icon, lat: g.lat + 0.0003, lng: g.lng - 0.0004, approx: true, major: false,
      title: { kz: 'Керіктер', ru: 'Жирафы', en: 'Giraffes' } });
  };
  { const A = await launch({ lang: 'ru', now: SUMMER, patch: winterPatch });
    check('М6a. Летом жирафы в летнем вольере, зимника на карте нет', !!A.app.markers.giraffes && !A.app.markers['winter-giraffes']);
    check('М6b. Летом зебры на карте', !!A.app.markers.zebras);
    A.close(); }
  { const A = await launch({ lang: 'ru', now: '2026-11-10T12:00:00', patch: winterPatch });
    check('М6c. Свои даты зоны: 10 ноября у зоопарка зима, а жирафы ещё в летнем вольере', A.app.fn.season(A.app.fn.now()) === 'winter' && !!A.app.markers.giraffes && !A.app.markers['winter-giraffes']);
    check('М6d. 10 ноября зебры уже не на карте (их перевод с 1 ноября)', !A.app.markers.zebras);
    A.close(); }
  { const A = await launch({ lang: 'ru', now: '2027-01-15T12:00:00', patch: winterPatch });
    check('М6e. Зимой (через Новый год) маркер у зимника, у летнего вольера — нет', !A.app.markers.giraffes && !!A.app.markers['winter-giraffes']);
    const txt = A.app.markers['winter-giraffes'] ? popupText(A, 'winter-giraffes') : '';
    check('М6f. В попапе зимника — «Зимний вольер»', txt.includes('Зимний вольер'), txt);
    A.click('[data-tab="coll"]');
    const g = A.$('#coll-giraffes'), z = A.$('#coll-zebras');
    check('М6g. Коллекция: жирафы — «Зимний вольер», «На карте» ведёт к зимнику', !!g && g.textContent.includes('Зимний вольер') && !!g.querySelector('[data-act="focus"][data-id="winter-giraffes"]'), g && g.innerHTML.slice(0, 300));
    check('М6h. Коллекция: зебры — «Зимой не экспонируется, вернётся весной», без кнопки «На карте»', !!z && z.textContent.includes('Зимой не экспонируется, вернётся весной') && !z.querySelector('[data-act="focus"]'), z && z.textContent);
    const res = A.app.fn.doSearch('жираф'), zeb = A.app.fn.doSearch('зебр');
    check('М6i. Поиск зимой ведёт к зимнику, к зебрам — не ведёт на карту', res.some(r => r.placeId === 'winter-giraffes') && !res.some(r => r.placeId === 'giraffes') && !zeb.some(r => r.placeId === 'zebras'), { res: res.map(r => r.placeId), zeb: zeb.map(r => r.placeId) });
    A.close(); }
  { const A = await launch({ lang: 'ru', now: '2027-03-16T12:00:00', patch: winterPatch });
    check('М6j. Весной жирафы вернулись в летний вольер сами', !!A.app.markers.giraffes && !A.app.markers['winter-giraffes']);
    A.close(); }

  // М7. Подмена даты из сервисной панели действует на сезонные объекты и зимники
  { const A = await launch({ lang: 'ru', now: SUMMER, storage: { zoo_dev_now: '2026-12-09T12:00' }, patch: winterPatch });
    check('М7. Подменённая зимняя дата: ларька нет, жирафы у зимника', !A.app.markers['kiosk-1'] && !!A.app.markers['winter-giraffes']);
    A.close(); }

  // М8. Переключатель «Схема / Спутник»: обычный и полевой режим, выбор помнится отдельно
  { const A = await launch({ lang: 'ru', now: SUMMER });
    check('М8a. По умолчанию у посетителя — схема', tiles(A) === 'osm', tiles(A));
    const sw = A.$('[data-base="sat"]');
    check('М8b. Переключатель виден посетителю', !!sw && visible(A, sw));
    if (sw) A.click(sw);
    check('М8c. «Спутник» — на карте снимки, схемы нет', tiles(A) === 'sat', tiles(A));
    const saved = Object.assign({}, A.w.localStorage); A.close();
    const B = await launch({ lang: 'ru', now: SUMMER, storage: saved });
    check('М8d. После перезапуска выбор посетителя сохранён', tiles(B) === 'sat', tiles(B));
    B.close(); }
  { const A = await launch({ lang: 'ru', now: SUMMER });
    await enterField(A);
    check('М8e. В полевом режиме по умолчанию — спутник', tiles(A) === 'sat', tiles(A));
    const sw = A.$('[data-base="osm"]');
    check('М8f. Переключатель виден и в полевом режиме', !!sw && visible(A, sw));
    if (sw) A.click(sw);
    check('М8g. В полевом режиме можно включить схему', tiles(A) === 'osm', tiles(A));
    A.click('[data-base="sat"]');  A.click('[data-base="osm"]');
    A.click('[data-f="exit"]');
    check('М8h. После выхода — выбор посетителя (схема)', tiles(A) === 'osm', tiles(A));
    A.click('[data-base="sat"]');
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5); A.click('[data-p="field"]');
    check('М8i. Снова в полевом режиме — его собственный выбор (схема), посетительский не мешает', tiles(A) === 'osm', tiles(A));
    A.click('[data-f="exit"]');
    check('М8j. И обратно — посетительский выбор (спутник)', tiles(A) === 'sat', tiles(A));
    A.close(); }

  // М9. Полевой режим показывает скрытые объекты (чтобы их можно было поставить на место)
  { const A = await launch({ lang: 'ru', now: WINTER });
    await enterField(A);
    check('М9a. В полевом режиме зимой летний ларёк виден', !!A.app.markers['kiosk-1']);
    A.click('[data-f="exit"]');
    check('М9b. После выхода — снова скрыт', !A.app.markers['kiosk-1']);
    A.close(); }

  // М10. Служебные входы, въезд и парковка — можно отметить в полевом режиме; посетителям не показываются
  { const ids = (D.service || []).map(s => s.id);
    check('М10a. В данных есть служебный вход, служебный въезд, служебная парковка', ['service-entrance', 'service-gate', 'service-parking'].every(i => ids.includes(i)), ids);
    const A = await launch({ lang: 'ru', now: SUMMER });
    check('М10b. Посетителю служебные объекты не показываются', ids.every(i => !A.app.markers[i]) && ids.length > 0);
    await enterField(A);
    A.click('[data-f="tapPoint"]'); A.app.map.fire('click', { latlng: { lat: 43.264, lng: 76.976 } });
    const opts = Array.from(A.w.document.querySelectorAll('#fPlace option')).map(o => o.value);
    check('М10c. При записи точки их можно выбрать в списке мест', ids.length > 0 && ids.every(i => opts.includes(i)), opts.slice(-5));
    A.$('#fPlace').value = 'service-gate'; A.$('#fName').value = ''; A.click('[data-f="formSave"]');
    const it = JSON.parse(A.w.localStorage.getItem('zoo_field') || '[]').pop() || {};
    check('М10d. Точка сохраняется с привязкой к служебному въезду', it.place === 'service-gate' && /Служебный въезд/.test(it.name), it);
    A.close(); }
  return done();
};
