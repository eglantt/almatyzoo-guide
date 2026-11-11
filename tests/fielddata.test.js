/* Набор fielddata (0.1.6): силуэты заказчика (лист-образец №3) на зонах, расстановка из полевого режима
   (zoo-points_2026-11-10_04-24), дополнительные места (пруды, водоплавающие), дорожки точками, вид в нескольких местах. */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('fielddata');
  const D = JSON.parse(read('data.json'));
  const SPRITE = read('icons/sprite.svg');
  const P = id => D.places.find(p => p.id === id) || {};
  const NOW = '2026-07-08T12:00:00';
  const enterField = async A => {
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
    A.$('#authInput').value = '12345'; A.click('#authOk'); await A.wait(900); A.click('[data-p="field"]');
  };
  const items = A => JSON.parse(A.w.localStorage.getItem('zoo_field') || '[]');

  // Ф1. Силуэты заказчика — все 40 в спрайте, в реестре без пометки «заглушка»
  const ids = []; for (let r = 1, n = [10, 10, 3, 8, 3, 6]; r <= 6; r++) for (let i = 1; i <= n[r - 1]; i++) ids.push(`s-${r}-${String(i).padStart(2, '0')}`);
  const missing = ids.filter(id => !new RegExp(`<symbol id="${id}" viewBox="0 0 \\d+(\\.\\d+)? \\d+(\\.\\d+)?">`).test(SPRITE));
  check('Ф1a. В спрайте все 40 силуэтов листа-образца №3 (s-1-01 … s-6-06), у каждого свой viewBox', missing.length === 0, missing.slice(0, 5));
  const regBad = ids.filter(id => !D.icons[id] || D.icons[id].placeholder !== false);
  check('Ф1b. В реестре пиктограмм все 40 — без пометки «заглушка»', regBad.length === 0, regBad.slice(0, 5));

  // Ф2. Привязка зон (решение заказчика 10.11.2026)
  const MAP = { elephant: 's-2-01', giraffes: 's-2-02', hippos: 's-2-03', rhinos: 's-2-04', zebras: 's-2-09', ungulates: 's-2-08',
    bears: 's-1-01', polarbear: 's-1-01', lions: 's-1-02', tigers: 's-1-05', wolves: 's-1-09', kangaroo: 's-1-07', predators: 's-1-04',
    primates: 's-3-01', raptors: 's-4-01', waterfowl: 's-4-08', pheasants: 's-4-05', birdhouse: 's-4-03', crocodiles: 's-5-01',
    exotarium: 's-5-02', aquarium: 's-6-02', pond: 'a-pond' };
  const wrong = D.places.filter(p => p.zone && MAP[p.zone] && p.icon !== MAP[p.zone]).map(p => `${p.id}:${p.icon}`);
  check('Ф2a. Все места зон — с силуэтами по привязке (пруд — прежняя пиктограмма)', wrong.length === 0 && Object.keys(MAP).every(z => D.places.some(p => p.zone === z)), wrong);
  const leftA = D.places.filter(p => p.kind === 'animal' && /^a-/.test(p.icon) && p.icon !== 'a-pond').map(p => p.id);
  check('Ф2b. Временных пиктограмм животных на местах не осталось (кроме пруда)', leftA.length === 0, leftA);
  { const A = await launch({ lang: 'ru', now: NOW });
    const el = A.app.markers.elephant && A.app.markers.elephant.getElement();
    check('Ф2c. Маркер слона — силуэт s-2-01, без розового кольца', !!el && !!el.querySelector('use[href="#s-2-01"]') && !el.querySelector('.ph-ring'));
    const pond = A.app.markers.pond && A.app.markers.pond.getElement();
    check('Ф2d. Пруд — прежняя пиктограмма a-pond', !!pond && !!pond.querySelector('use[href="#a-pond"]'));
    A.click('[data-tab="coll"]');
    const row = A.$('#coll-lions');
    check('Ф2e. В разделе «Животные» у львов — силуэт s-1-02', !!row && !!row.querySelector('use[href="#s-1-02"]'));
    check('Ф2f. Запуск без ошибок', A.errors.length === 0, A.errors);
    A.close(); }

  // Ф3. Расстановка из полевого режима (выгрузка 10.11.2026 04:24) — точные координаты, без approx
  const FIELD = { 'wc-1': [43.263132, 76.9742382], kangaroo: [43.2645344, 76.977092], zebras: [43.2627258, 76.9749624], primates: [43.2655891, 76.9780201],
    pond: [43.2639328, 76.9768667], 'wc-2': [43.262882, 76.9774568], rhinos: [43.2653274, 76.9778109], bears: [43.2639641, 76.9785994],
    elephant: [43.2647883, 76.9784868], wolves: [43.2649055, 76.9757295], lions: [43.264011, 76.9754076], raptors: [43.2630773, 76.9757617],
    'gazebo-2': [43.2622609, 76.9759279], 'kiosk-1': [43.2630031, 76.9777143], 'kiosk-2': [43.2653626, 76.9771081], 'cafe-2': [43.2637532, 76.9744849],
    guard: [43.262089, 76.9772476], polarbear: [43.2653391, 76.9755846], tigers: [43.2641125, 76.9745654], ungulates: [43.2617179, 76.9751394],
    predators: [43.2638664, 76.975531], exotarium: [43.2626281, 76.9771993], waterfowl: [43.2638313, 76.9770411], crocodiles: [43.2626867, 76.9769579],
    aquarium: [43.261753, 76.9763598], birdhouse: [43.2616984, 76.9762686], pheasants: [43.2616573, 76.9757885], playground: [43.2636203, 76.9751018],
    info: [43.2633899, 76.974898], med: [43.263425, 76.9740987] };
  // 0.1.7: часть мест переставлена второй выгрузкой — сверка с самими файлами (docs/field/): итог — последняя выгрузка
  const E1 = JSON.parse(read('docs/field/zoo-points_2026-11-10_04-24.geojson')), E2 = JSON.parse(read('docs/field/zoo-points_2026-11-10_21-57.geojson'));
  const dragged2 = new Set(E2.features.filter(f => /перетащено/.test(f.properties.name)).map(f => f.properties.place));
  const keep1 = Object.keys(FIELD).filter(id => !dragged2.has(id) && P(id).id);
  const off = keep1.filter(id => Math.abs(P(id).lat - FIELD[id][0]) > 1e-7 || Math.abs(P(id).lng - FIELD[id][1]) > 1e-7 || P(id).approx !== false);
  check('Ф3a. Места первой выгрузки, которые не переставлялись во второй, — на её координатах, без approx', E1.features.length > 30 && off.length === 0, off);
  check('Ф3b. Ориентировочных мест не осталось (0.1.8: парковку заказчик поставил сам)', D.places.filter(p => p.approx).length === 0, D.places.filter(p => p.approx).map(p => p.id));
  check('Ф3c. У каждого места из полевого режима указан источник — одна из трёх выгрузок', D.places.every(p => ['field-2026-11-10', 'field-2026-11-10b', 'field-2026-11-11'].includes(p.src)), D.places.filter(p => !['field-2026-11-10', 'field-2026-11-10b', 'field-2026-11-11'].includes(p.src)).map(p => p.id));

  // Ф4. Дополнительные места: два пруда и ещё одно место водоплавающих птиц
  const last = id => { const f = E2.features.filter(x => x.properties.place === id && /перетащено/.test(x.properties.name)).pop(); return f ? [f.geometry.coordinates[1], f.geometry.coordinates[0]] : null; };
  const extra = { 'pond-2': ['pond', ...last('pond-2')], 'pond-3': ['pond', 43.2634719, 76.9755685], 'waterfowl-2': ['waterfowl', ...last('waterfowl-2')] };
  const badX = Object.entries(extra).filter(([id, [z, la, ln]]) => P(id).zone !== z || P(id).lat !== la || P(id).lng !== ln || P(id).approx !== false || P(id).icon !== MAP[z]).map(([id]) => id);
  check('Ф4a. Пруд 2, водоплавающие 2 — на точках второй выгрузки; пруд 3 — на прежнем (случайный перенос не учтён)', badX.length === 0, badX);
  { const A = await launch({ lang: 'ru', now: NOW });
    check('Ф4b. На карте три пруда и два места водоплавающих', ['pond', 'pond-2', 'pond-3', 'waterfowl', 'waterfowl-2'].every(id => !!A.app.markers[id]));
    A.click('[data-tab="coll"]');
    const btn = A.$('#coll-pond [data-act="focusMany"]');
    check('Ф4c. В разделе «Животные» пруд — одной строкой, «На карте» ведёт ко всем четырём', !!btn && btn.dataset.ids.split(',').sort().join() === 'pond,pond-2,pond-3,pond-4', btn && btn.dataset.ids);
    A.close(); }

  // Ф5. Новые дорожки точками (полевой режим)
  { const A = await launch({ lang: 'ru', now: NOW });
    await enterField(A);
    const b = A.$('[data-f="line"]');
    check('Ф5a. В полевом режиме есть кнопка «Дорожка точками»', !!b && /Дорожка точками/.test(b.textContent));
    if (b) {
      A.click(b);
      const pts = [[43.2640, 76.9760], [43.2642, 76.9763], [43.2645, 76.9765]];
      pts.forEach(p => A.app.map.fire('click', { latlng: { lat: p[0], lng: p[1] } }));
      check('Ф5b. Три тапа — три точки, линия не замкнута (не контур)', A.app.debugField().handles.length === 3 && /Точек: 3/.test(A.$('#fieldbar').textContent) && !/Правка контура|^Контур/.test(A.$('#fieldbar b').textContent));
      A.click('[data-f="undo"]');
      check('Ф5c. «Шаг назад» убирает последнюю точку', A.app.debugField().handles.length === 2);
      A.app.map.fire('click', { latlng: { lat: 43.2645, lng: 76.9765 } });
      A.click('[data-f="lineDone"]');
      const opts = Array.from(A.w.document.querySelectorAll('#fPlace option')).map(o => o.value);
      check('Ф5d. При сохранении — «Новая дорожка» по умолчанию, тип — «Дорожка»', A.$('#fPlace').value === '' && A.$('#fCat').value === 'path' && /дорожка/i.test(A.$('#fieldFormBody .dialog__head').textContent), { place: A.$('#fPlace').value, cat: A.$('#fCat').value, opts });
      A.$('#fName').value = 'от пруда к слону'; A.click('[data-f="formSave"]');
      const it = items(A).pop() || {};
      check('Ф5e. Запись: тип line, 3 точки, название с примечанием', it.type === 'line' && it.coords.length === 3 && /от пруда к слону/.test(it.name), it);
      check('Ф5f. Сохранённая дорожка нарисована на карте полевого режима', A.app.layers.field.getLayers().some(l => l.getLatLngs && l.getLatLngs().length === 3));
      A.click('[data-f="list"]');
      const ed = A.$(`[data-f="edit"][data-id="${it.id}"]`);
      check('Ф5g. В списке у дорожки есть «Изменить»', !!ed);
      if (ed) { A.click(ed); check('Ф5h. «Изменить» открывает дорожку на правку — три перетаскиваемые точки', A.app.debugField().handles.length === 3 && /Правка дорожки/.test(A.$('#fieldbar').textContent)); A.click('[data-f="cancel"]'); }
      A.click('[data-f="exit"]');
      A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
      let blob = null; const RB = A.w.Blob; A.w.Blob = function (p, o) { blob = p.join(''); return new RB(p, o); };
      A.w.URL.createObjectURL = () => 'blob:x'; A.w.URL.revokeObjectURL = () => {}; A.w.HTMLAnchorElement.prototype.click = function () {};
      A.click('[data-p="export"]'); await A.wait(20);
      const f = blob ? JSON.parse(blob).features.find(x => x.properties.kind === 'line') : null;
      check('Ф5i. Экспорт: дорожка — LineString из 3 точек, тип «Дорожка»', !!f && f.geometry.type === 'LineString' && f.geometry.coordinates.length === 3 && f.properties.cat === 'path', f && f.properties);
    }
    A.close(); }

  // Ф6. Один вид — в нескольких местах (заготовка под список коллекции)
  { const patch = X => { X.animals.push({ id: 'swan', places: ['pond', 'pond-3'], title: { kz: 'Аққу', ru: 'Лебедь-шипун', en: 'Mute swan' } }); };
    const A = await launch({ lang: 'ru', now: NOW, patch });
    const res = A.app.fn.doSearch('лебедь').map(r => r.placeId);
    check('Ф6a. Поиск вида, живущего на двух прудах, находит оба места', res.includes('pond') && res.includes('pond-3'), res);
    A.click('[data-tab="coll"]');
    check('Ф6b. В разделе «Животные» вид показан в строке пруда', (A.$('#coll-pond') || { textContent: '' }).textContent.includes('Лебедь-шипун'));
    A.close(); }
  return done();
};
