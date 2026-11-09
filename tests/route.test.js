/* Набор route (0.1.4): путь через Парк культуры (по кнопке), раздел «Животные» вместо «Коллекции»,
   служебные дорожки (у посетителя — «Проход запрещён»; отметка в полевом режиме). */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('route');
  const D = JSON.parse(read('data.json'));
  const NOW = '2026-07-08T12:00:00';
  const PARK = { lat: 43.26127, lng: 76.965365 };
  const m = (a, b) => Math.hypot((a.lat - b.lat) * 110540, (a.lng - b.lng) * 111320 * Math.cos(43.26 * Math.PI / 180));
  const ll = c => ({ lat: c[0], lng: c[1] });
  const enterField = async A => {
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
    A.$('#authInput').value = '12345'; A.click('#authOk'); await A.wait(900); A.click('[data-p="field"]');
  };
  const items = A => JSON.parse(A.w.localStorage.getItem('zoo_field') || '[]');
  const R = D.parkRoute || {};
  const C = R.coords || [];

  // Р1. Данные пути через парк
  check('Р1a. Путь через парк: начало у центрального входа в ПКиО (не дальше 10 м)', C.length > 2 && m(ll(C[0]), PARK) < 10, C[0]);
  check('Р1b. Конец — у центрального входа в зоопарк (не дальше 5 м)', C.length > 2 && m(ll(C[C.length - 1]), D.meta.entrance) < 5, C[C.length - 1]);
  let len = 0; for (let i = 1; i < C.length; i++) len += m(ll(C[i - 1]), ll(C[i]));
  check('Р1c. Длина пути 700–900 м и совпадает с указанной в данных (±2 %)', len > 700 && len < 900 && Math.abs(len - R.m) / len < 0.02, { len: Math.round(len), m: R.m });
  const [[s, w], [n, e]] = D.meta.bounds;
  check('Р1d. Рамка карты расширена: весь путь и вход в парк помещаются', C.length > 0 && C.every(([a, b]) => a > s && a < n && b > w && b < e));
  check('Р1e. Название входа в парк на трёх языках', !!(R.title && R.title.kz && R.title.ru && R.title.en));

  // Р2. При открытии карта на зоопарке, пути через парк нет
  { const A = await launch({ lang: 'ru', now: NOW });
    const c = A.app.map.getCenter();
    check('Р2a. При открытии центр карты — в зоопарке, не в парке', A.app.fn.insideZoo({ lat: c.lat, lng: c.lng }), c);
    check('Р2b. Без нажатия кнопки путь через парк не нарисован', A.app.layers.route.getLayers().length === 0);
    A.close(); }

  // Р3. Кнопка в «Ещё → Как добраться»
  for (const lang of ['kz', 'ru', 'en']) {
    const A = await launch({ lang, now: NOW });
    A.click('[data-tab="more"]');
    const b = A.$('#moreBody [data-act="parkRoute"]');
    check(`Р3a. «Путь через парк» в «Как добраться» (${lang})`, !!b && b.textContent.includes(D.ui.parkRoute[lang]), b && b.textContent);
    if (b) {
      A.click(b); await A.wait(10);
      const lines = A.app.layers.route.getLayers();
      const line = lines.find(l => l.getLatLngs && Array.isArray(l.getLatLngs()) && l.getLatLngs().length === C.length);
      check(`Р3b. Нажатие: открыта карта, нарисован путь (${lang})`, A.app.state.tab === 'map' && !!line, lines.length);
      check(`Р3c. Отмечен вход в парк (${lang})`, lines.some(l => l.getLatLng && m(l.getLatLng(), PARK) < 10));
      const txt = A.$('#sheetBody').textContent, dm = Math.max(10, Math.round(R.m / 10) * 10);
      check(`Р3d. Карточка: название, расстояние, время (${lang})`, !A.$('#sheet').hidden && txt.includes(D.ui.parkRoute[lang]) && txt.includes(String(dm)), txt);
      check(`Р3f. На время показа пути карта отдаляется до масштаба 15 (путь шире экрана на 16) (${lang})`, A.app.map.getMinZoom() === 15);
      A.app.map.fire('moveend');
      check(`Р3g. Пока открыта карточка, «К зоопарку» спрятана (не наезжает на фильтры) (${lang})`, A.$('#btnToZoo').hidden);
      A.click('#sheetClose');
      check(`Р3e. Закрытие карточки убирает путь (${lang})`, A.app.layers.route.getLayers().length === 0);
      check(`Р3h. После закрытия — обычный предел масштаба 16 (${lang})`, A.app.map.getMinZoom() === 16);
    }
    A.close();
  }

  // Р4. «Коллекция» → «Жануарлар / Животные / Animals»
  const NAMES = { kz: 'Жануарлар', ru: 'Животные', en: 'Animals' };
  for (const lang of ['kz', 'ru', 'en']) {
    const A = await launch({ lang, now: NOW });
    check(`Р4a. Вкладка называется «${NAMES[lang]}»`, A.$('[data-tab="coll"]').textContent.trim() === NAMES[lang], A.$('[data-tab="coll"]').textContent.trim());
    A.click('[data-tab="coll"]');
    check(`Р4b. Заголовок раздела «${NAMES[lang]}»`, A.$('#screen-coll h1').textContent.trim() === NAMES[lang], A.$('#screen-coll h1').textContent);
    check(`Р4c. Поиск: «${D.ui.collSearchPh[lang]}»`, A.$('#collSearch').placeholder === { kz: 'Жануарларды іздеу', ru: 'Поиск животных', en: 'Search animals' }[lang], A.$('#collSearch').placeholder);
    A.click('[data-tab="map"]'); A.app.markers.elephant.openPopup();
    const btn = A.w.document.querySelector('.leaflet-popup [data-act="toColl"]');
    check(`Р4d. Кнопка в попапе: «${{ kz: 'Тұрғындары', ru: 'Об обитателях', en: 'Residents' }[lang]}»`, !!btn && btn.textContent.trim() === { kz: 'Тұрғындары', ru: 'Об обитателях', en: 'Residents' }[lang], btn && btn.textContent);
    check(`Р4e. Слово «Коллекция / Collection» в интерфейсе не осталось (${lang})`, !/Коллекци|Collection/.test(A.$('#tabbar').textContent + A.$('#screen-coll').textContent + A.w.document.querySelector('.leaflet-popup').textContent));
    A.close();
  }

  // Р5. Служебные дорожки у посетителя
  const pid = (D.paths[3] || {}).id;
  { const A = await launch({ lang: 'ru', now: NOW, patch: X => { X.paths[3].service = true; } });
    const lays = A.app.layers.paths.getLayers();
    const svc = lays.filter(l => l.options.dashArray), plain = lays.filter(l => !l.options.dashArray);
    check('Р5a. Служебная дорожка — пунктиром и другим цветом, остальные — как были', svc.length === 1 && plain.length === lays.length - 1 && svc[0].options.color !== plain[0].options.color, { svc: svc.length, all: lays.length });
    if (svc[0]) { svc[0].fire('click', { latlng: svc[0].getLatLngs()[0] }); svc[0].openPopup(svc[0].getLatLngs()[0]); }
    const pop = A.w.document.querySelector('.leaflet-popup');
    check('Р5b. Нажатие на служебную дорожку — «Служебная дорожка · Проход запрещён»', !!pop && pop.textContent.includes('Служебная дорожка') && pop.textContent.includes('Проход запрещён'), pop && pop.textContent);
    check('Р5c. Обычные дорожки нажатия не перехватывают', plain.every(l => l.options.interactive === false));
    A.close(); }

  // Р6. Отметка служебных дорожек в полевом режиме
  { const A = await launch({ lang: 'ru', now: NOW });
    await enterField(A);
    const btn = A.$('[data-f="paths"]');
    check('Р6a. В полевом режиме есть кнопка «Дорожки»', !!btn);
    if (btn) {
      A.click(btn);
      const p = D.paths.find(x => x.id === pid), a = p.coords[0], b = p.coords[1];
      const mid = { lat: (a[0] + b[0]) / 2, lng: (a[1] + b[1]) / 2 };
      A.app.map.fire('click', { latlng: mid });
      let rec = items(A).filter(i => i.type === 'pathflag');
      check('Р6b. Нажатие рядом с дорожкой отмечает её служебной', rec.length === 1 && rec[0].path === pid && rec[0].service === true, rec);
      const lay = A.app.layers.paths.getLayers().filter(l => l.options.dashArray);
      check('Р6c. На карте дорожка сразу стала пунктирной', lay.length === 1);
      A.app.map.fire('click', { latlng: mid });
      rec = items(A).filter(i => i.type === 'pathflag');
      check('Р6d. Повторное нажатие снимает отметку (одна запись на дорожку)', rec.length === 1 && rec[0].service === false, rec);
      A.app.map.fire('click', { latlng: mid });
      A.app.map.fire('click', { latlng: { lat: 43.2700, lng: 76.9600 } });
      check('Р6e. Нажатие вдали от дорожек ничего не отмечает', items(A).filter(i => i.type === 'pathflag').length === 1);
      A.click('[data-f="back"]');
      A.click('[data-f="exit"]');
      check('Р6f. Вне полевого режима — дорожки по data.json (отметка только в записях)', A.app.layers.paths.getLayers().every(l => !l.options.dashArray));
      // Экспорт: отметка попадает в GeoJSON с геометрией дорожки
      A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
      let blobText = null; const RealBlob = A.w.Blob;
      A.w.Blob = function (parts, o) { blobText = parts.join(''); return new RealBlob(parts, o); };
      A.w.URL.createObjectURL = () => 'blob:x'; A.w.URL.revokeObjectURL = () => {}; A.w.HTMLAnchorElement.prototype.click = function () {};   // скачивание файла в jsdom не нужно
      A.click('[data-p="export"]'); await A.wait(20);
      const gj = blobText ? JSON.parse(blobText) : { features: [] };
      const f = gj.features.find(x => x.properties.kind === 'pathflag');
      check('Р6g. Экспорт: отметка дорожки — LineString с id дорожки и признаком service', !!f && f.properties.path === pid && f.properties.service === true && f.geometry.type === 'LineString' && f.geometry.coordinates.length === p.coords.length, f);
    }
    A.close(); }

  // Р7. Трек можно привязать к «Пути через парк»
  { const g = { lat: 43.2636, lng: 76.9742, acc: 5 };       // подставной GPS «идёт»: точка сдвигается во время записи
    const A = await launch({ lang: 'ru', now: NOW, gps: g });
    await enterField(A);
    A.click('[data-f="track"]'); await A.wait(80); g.lat += 0.0002; await A.wait(80); g.lat += 0.0002; await A.wait(80);
    A.click('[data-f="trackStop"]'); await A.wait(10);
    const opts = Array.from(A.w.document.querySelectorAll('#fPlace option')).map(o => o.value);
    check('Р7. При сохранении трека можно выбрать «Путь через парк»', opts.includes('park-route'), opts);
    A.close(); }
  return done();
};
