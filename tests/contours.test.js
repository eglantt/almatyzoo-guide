/* Набор contours (0.1.8): полевой режим — «Контуры» (граница зоопарка, вольер, здание, водоём), правка точек кружками,
   перетаскивание любых точек с «Вернуть», записи об удалённых местах; контуры из данных на карте посетителя. */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('contours');
  const D = JSON.parse(read('data.json'));
  const SUMMER = '2026-07-08T12:00:00';
  const enterField = async (A, storage) => {
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
    A.$('#authInput').value = '12345'; A.click('#authOk'); await A.wait(900); A.click('[data-p="field"]');
  };
  const items = A => JSON.parse(A.w.localStorage.getItem('zoo_field') || '[]');
  const tap = (A, lat, lng) => A.app.map.fire('click', { latlng: { lat, lng } });
  const dbg = A => A.app.debugField();
  const bar = A => A.$('#fieldbar').textContent;
  const exportJson = async A => {
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
    let blobText = null; const RealBlob = A.w.Blob;
    A.w.Blob = function (parts, o) { blobText = parts.join(''); return new RealBlob(parts, o); };
    A.w.URL.createObjectURL = () => 'blob:x'; A.w.URL.revokeObjectURL = () => {}; A.w.HTMLAnchorElement.prototype.click = function () {};
    A.click('[data-p="export"]'); await A.wait(20);
    A.click('#panelClose');
    return blobText ? JSON.parse(blobText) : { features: [] };
  };

  // К1. «Контуры»: четыре вида; вольер по точкам, кружки посередине — новая точка, нажатие на точку — удалить, «Шаг назад»
  { const A = await launch({ lang: 'ru', now: SUMMER });
    await enterField(A);
    check('К1a. В полевом режиме кнопка «Контуры»', !!A.$('#fieldbar [data-f="contours"]'));
    A.click('[data-f="contours"]');
    const kinds = A.$$('#fieldbar [data-f="cKind"]').map(b => b.dataset.k);
    check('К1b. Виды: граница зоопарка, вольер, здание, водоём', !!A.$('#fieldbar [data-f="cBoundary"]') && kinds.join() === 'enclosure,building,water', kinds);
    A.click('[data-f="cKind"][data-k="enclosure"]');
    check('К1c. Заголовок «Вольер»', /Вольер/.test(A.$('#fieldbar b').textContent));
    [[43.2650, 76.9740], [43.2650, 76.9750], [43.2645, 76.9750]].forEach(([a, b]) => tap(A, a, b));
    check('К1d. Три точки — три кружка и три кружка посередине отрезков', dbg(A).handles.length === 3 && dbg(A).mids.length === 3, [dbg(A).handles.length, dbg(A).mids.length]);
    dbg(A).mids[0].fire('click');
    check('К1e. Нажатие на кружок посередине — новая точка между первой и второй', dbg(A).handles.length === 4 && /Точек: 4/.test(bar(A)) &&
      Math.abs(dbg(A).handles[1].getLatLng().lng - 76.9745) < 1e-6, dbg(A).handles.map(h => h.getLatLng()));
    const mid = dbg(A).mids[2]; mid.setLatLng([43.2642, 76.9744]); mid.fire('dragend');
    check('К1f. Кружок посередине можно потянуть — новая точка там, где отпустили', dbg(A).handles.length === 5 && dbg(A).handles.some(h => Math.abs(h.getLatLng().lat - 43.2642) < 1e-6));
    dbg(A).handles[0].fire('click');
    check('К1g. Нажатие на точку удаляет её', dbg(A).handles.length === 4);
    A.click('[data-f="undo"]');
    check('К1h. «Шаг назад» возвращает удалённую точку', dbg(A).handles.length === 5 && Math.abs(dbg(A).handles[0].getLatLng().lat - 43.2650) < 1e-6);
    A.click('[data-f="undo"]'); A.click('[data-f="undo"]');
    check('К1i. «Шаг назад» отменяет и вставки (было 5 → 3)', dbg(A).handles.length === 3);
    dbg(A).handles[0].fire('click');
    check('К1j. Меньше трёх точек у контура не остаётся', dbg(A).handles.length === 3);
    A.click('[data-f="polyDone"]');
    check('К1k. Форма: привязка необязательна, по умолчанию «без привязки»', A.$('#fPlace').value === '' && !A.$('#fPlace option[value="boundary"]'));
    A.$('#fName').value = 'летний'; A.click('[data-f="formSave"]');
    let it = items(A).pop() || {};
    check('К1l. Сохранён контур вольера без привязки', it.type === 'polygon' && it.contour === 'enclosure' && it.place === null && it.name === 'Вольер — летний' && it.coords.length === 3, it);
    // здание и водоём с привязкой
    A.click('[data-f="contours"]'); A.click('[data-f="cKind"][data-k="building"]');
    [[43.2630, 76.9770], [43.2630, 76.9774], [43.2627, 76.9774], [43.2627, 76.9770]].forEach(([a, b]) => tap(A, a, b));
    A.click('[data-f="polyDone"]'); A.$('#fPlace').value = 'exotarium'; A.click('[data-f="formSave"]');
    A.click('[data-f="contours"]'); A.click('[data-f="cKind"][data-k="water"]');
    [[43.2640, 76.9766], [43.2640, 76.9770], [43.2637, 76.9768]].forEach(([a, b]) => tap(A, a, b));
    A.click('[data-f="polyDone"]'); A.$('#fPlace').value = 'pond'; A.click('[data-f="formSave"]');
    const all = items(A).filter(x => x.type === 'polygon');
    check('К1m. Здание (Экзотариум) и водоём (пруд) сохранены своими видами', all.some(x => x.contour === 'building' && x.place === 'exotarium' && x.name === 'Здание: Экзотариум') &&
      all.some(x => x.contour === 'water' && x.place === 'pond' && x.name === 'Водоём: Пруд'), all.map(x => [x.contour, x.place, x.name]));
    const shapes = A.app.layers.field.getLayers().filter(l => l.getLatLngs && !l.getLatLng);
    check('К1n. Контуры видны на карте полевого режима, с заливкой своего вида', shapes.length === 3 && shapes.some(l => l.options.fillColor === '#9FD0F0') && shapes.some(l => l.options.fillColor === '#D6D6D2'), shapes.map(l => l.options.fillColor));
    // меню по нажатию на контур — «Изменить точки»
    const water = shapes.find(l => l.options.fillColor === '#9FD0F0'); water.fire('click');
    const ed = A.$('#fieldFormBody [data-f="edit"]');
    check('К1o. Нажатие на контур открывает меню с «Изменить точки»', !A.$('#fieldForm').hidden && !!ed);
    if (ed) { A.click(ed); check('К1p. «Изменить точки» — правка водоёма: 3 точки, форма закрыта', A.$('#fieldForm').hidden && dbg(A).handles.length === 3 && /Правка: Водоём/.test(bar(A)), bar(A)); }
    A.click('[data-f="cancel"]');
    const gj = await exportJson(A);
    const pf = gj.features.filter(f => f.geometry.type === 'Polygon');
    check('К1q. Экспорт: у контуров признак contour и привязка', pf.length === 3 && pf.every(f => ['enclosure', 'building', 'water'].includes(f.properties.contour)) && pf.some(f => f.properties.place === 'exotarium'), pf.map(f => f.properties));
    check('К1r. Без ошибок', A.errors.length === 0, A.errors);
    A.close(); }

  // К2. Граница зоопарка: правка нынешней, а не рисование заново
  { const A = await launch({ lang: 'ru', now: SUMMER });
    await enterField(A);
    const B = D.meta.boundary, ring = B.length > 3 && B[0][0] === B[B.length - 1][0] && B[0][1] === B[B.length - 1][1] ? B.length - 1 : B.length;
    A.click('[data-f="contours"]'); A.click('[data-f="cBoundary"]');
    check('К2a. Граница открыта сразу с точками из данных', dbg(A).handles.length === ring && /Правка: Граница зоопарка/.test(bar(A)), [dbg(A).handles.length, ring]);
    tap(A, 43.2640, 76.9760);
    check('К2b. Тап по карте точку к границе не добавляет', dbg(A).handles.length === ring);
    const h = dbg(A).handles[0]; h.fire('dragstart'); h.setLatLng([43.26500, 76.97300]); h.fire('drag'); h.fire('dragend');
    dbg(A).mids[5].fire('click');
    dbg(A).handles[10].fire('click');
    A.click('[data-f="polyDone"]');
    check('К2c. «Готово» сохраняет без вопросов (форма не открывается)', A.$('#fieldForm').hidden);
    let bs = items(A).filter(x => x.type === 'polygon' && x.place === 'boundary');
    check('К2d. Граница — одна запись: точка сдвинута, одна добавлена, одна удалена', bs.length === 1 && bs[0].contour === 'boundary' && bs[0].name === 'Граница зоопарка' &&
      bs[0].coords.length === ring && bs[0].coords[0][0] === 43.265 && bs[0].coords[0][1] === 76.973, bs[0] && [bs[0].coords.length, bs[0].coords[0]]);
    A.click('[data-f="contours"]'); A.click('[data-f="cBoundary"]');
    check('К2e. Повторная правка начинается с сохранённой границы', dbg(A).handles.length === ring && Math.abs(dbg(A).handles[0].getLatLng().lat - 43.265) < 1e-9);
    dbg(A).mids[0].fire('click'); A.click('[data-f="polyDone"]');
    bs = items(A).filter(x => x.type === 'polygon' && x.place === 'boundary');
    check('К2f. Новая правка заменяет прежнюю запись (одна граница)', bs.length === 1 && bs[0].coords.length === ring + 1);
    const gj = await exportJson(A);
    const bf = gj.features.find(f => f.properties.place === 'boundary');
    check('К2g. Экспорт: граница — Polygon с contour: boundary, кольцо замкнуто', !!bf && bf.properties.contour === 'boundary' && bf.geometry.type === 'Polygon' && bf.geometry.coordinates[0].length === ring + 2, bf && bf.properties);
    A.close(); }

  // К3. Перетаскивание любых точек: места, служебные (и скрытые от посетителя), зимние вольеры, свои точки — с «Вернуть»
  { const A = await launch({ lang: 'ru', now: SUMMER, storage: { zoo_field: JSON.stringify([
      { id: 'fA', type: 'point', name: 'Сайга', place: null, cat: 'other', coords: [[43.2657, 76.9757]], acc: null, ts: '2026-11-10T00:00:00Z' }]) } });
    await enterField(A);
    const dr = id => { const m = A.app.markers[id]; return !!(m && m.dragging && m.dragging.enabled()); };
    check('К3a. Перетаскиваются: служебный вход, ветчасть, тихая зона, неэкспонируемый и экспонируемый зимние вольеры, парковка',
      ['service-entrance', 'vet', 'raptors-quiet', 'winter-rhinos', 'winter-giraffes', 'parking'].every(dr), ['service-entrance', 'vet', 'raptors-quiet', 'winter-rhinos', 'winter-giraffes', 'parking'].filter(id => !dr(id)));
    const own = A.app.layers.field.getLayers().find(l => l.getLatLng && Math.abs(l.getLatLng().lat - 43.2657) < 1e-9);
    check('К3b. Своя точка без иконки — перетаскиваемая', !!own && !!(own.dragging && own.dragging.enabled()));
    own.setLatLng([43.2658, 76.9759]); own.fire('dragend');
    let r = items(A).find(x => x.id === 'fA');
    check('К3c. Своя точка перенесена, есть «Вернуть»', r.coords[0][0] === 43.2658 && r.coords[0][1] === 76.9759 && !!A.$('#toast [data-f="undoDel"]') && /Перенесено: Сайга/.test(A.$('#toast').textContent));
    A.click('#toast [data-f="undoDel"]');
    r = items(A).find(x => x.id === 'fA');
    check('К3d. «Вернуть» — точка на прежнем месте', r.coords[0][0] === 43.2657 && r.coords[0][1] === 76.9757);
    const v = A.app.markers.vet, p0 = D.places.find(p => p.id === 'vet');
    v.setLatLng([43.2652, 76.9786]); v.fire('dragend');
    let rec = items(A).filter(x => x.place === 'vet');
    check('К3e. Ветчасть перетащена: одна запись «перетащено», категория «Служебное», «Вернуть» в подсказке', rec.length === 1 && rec[0].cat === 'service' && /перетащено/.test(rec[0].name) && !!A.$('#toast [data-f="undoDel"]'), rec);
    A.click('#toast [data-f="undoDel"]');
    const v2 = A.app.markers.vet.getLatLng();
    check('К3f. «Вернуть»: записи нет, иконка на прежнем месте', items(A).filter(x => x.place === 'vet').length === 0 && v2.lat === p0.lat && v2.lng === p0.lng, v2);
    check('К3g. Без ошибок', A.errors.length === 0, A.errors);
    A.close(); }

  // К4. Записи о местах, которых больше нет в данных (кафе за оградой): не рисуются, не выгружаются, в списке — «места больше нет»
  { const A = await launch({ lang: 'ru', now: SUMMER, storage: { zoo_field: JSON.stringify([
      { id: 'fC', type: 'point', name: 'Кафе — перетащено', place: 'cafe-1', cat: 'infra', coords: [[43.2633801, 76.9722319]], acc: null, ts: '2026-11-10T00:00:00Z' },
      { id: 'fP', type: 'point', name: 'Парковка для посетителей — перетащено', place: 'parking', cat: 'infra', coords: [[43.2638157, 76.9734442]], acc: null, ts: '2026-11-10T00:00:00Z' }]) } });
    await enterField(A);
    const drawn = A.app.layers.field.getLayers().some(l => l.getLatLng && Math.abs(l.getLatLng().lng - 76.9722319) < 1e-9);
    check('К4a. Кафе за оградой на карте полевого режима не рисуется', !drawn);
    A.click('[data-f="list"]');
    const st = A.$$('#fieldbar .flist .stale');
    check('К4b. В списке — серым, «места больше нет», только «Удалить запись»', st.length === 1 && /места больше нет/.test(st[0].textContent) && !st[0].querySelector('[data-f="show"]') && /Удалить запись/.test(st[0].textContent), st.map(x => x.textContent));
    const gj = await exportJson(A);
    check('К4c. В выгрузку не попадает, остальные записи — попадают', !gj.features.some(f => f.properties.place === 'cafe-1') && gj.features.some(f => f.properties.place === 'parking'), gj.features.map(f => f.properties.place));
    A.click(A.$('#fieldbar .flist .stale [data-f="del"]'));
    check('К4d. «Удалить запись» убирает её', !items(A).some(x => x.place === 'cafe-1') && items(A).length === 1);
    A.close(); }

  // К5. Контуры из данных — на карте посетителя: вольеры под зданиями, здания под водоёмами, всё под дорожками
  { const sq = (la, ln) => [[la, ln], [la, ln + 0.0003], [la - 0.0002, ln + 0.0003], [la - 0.0002, ln]];
    const A = await launch({ lang: 'ru', now: SUMMER, patch: X => { X.contours = [
      { id: 'c3', kind: 'water', coords: sq(43.2640, 76.9766) }, { id: 'c1', kind: 'enclosure', coords: sq(43.2650, 76.9760) }, { id: 'c2', kind: 'building', coords: sq(43.2628, 76.9770) }]; } });
    const ls = A.app.layers.contours ? A.app.layers.contours.getLayers() : [];
    check('К5a. Три контура на карте посетителя, в порядке: вольер, здание, водоём', ls.length === 3 && ls.map(l => l.options.fillColor).join() === '#B9DC8C,#D6D6D2,#9FD0F0', ls.map(l => l.options.fillColor));
    const order = [];
    A.app.map.eachLayer(l => { if (l === A.app.layers.contours) order.push('contours'); if (l === A.app.layers.paths) order.push('paths'); });
    check('К5b. Слой контуров добавлен раньше дорожек (лежит под ними)', order.join() === 'contours,paths', order);
    check('К5c. Контуры не перехватывают нажатия', ls.every(l => l.options.interactive === false));
    A.close(); }
  return done();
};
