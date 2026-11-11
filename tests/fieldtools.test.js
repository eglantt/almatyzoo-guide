/* Набор fieldtools (0.1.7): новые инструменты полевого режима и перенос второй выгрузки заказчика.
   Иконки новых мест (полупрозрачные, розовая пунктирная кайма), «ещё одно такое же», защита от переноса единственной иконки,
   служебная дорожка при сохранении, зимний вольер с зонами и датами, новая зона с силуэтом, меню по нажатию на иконку
   (удалить / убрать с карты / переименовать, «Вернуть»), «Назад» внизу списка. */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('fieldtools');
  const D = JSON.parse(read('data.json'));
  const P = id => D.places.find(p => p.id === id) || {};
  const NOW = '2026-07-08T12:00:00';
  const items = A => JSON.parse(A.w.localStorage.getItem('zoo_field') || '[]');
  const enterField = async (A) => {
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
    A.$('#authInput').value = '12345'; A.click('#authOk'); await A.wait(900); A.click('[data-p="field"]');
  };
  const tapPoint = (A, lat, lng) => { A.click('[data-f="tapPoint"]'); A.app.map.fire('click', { latlng: { lat, lng } }); };
  const fieldMarkers = A => A.app.layers.field.getLayers().filter(l => l.getElement && l.getElement() && l.getElement().classList.contains('zmk'));
  const pendingWith = (A, icon) => fieldMarkers(A).filter(l => l.getElement().querySelector(`use[href="#${icon}"]`));

  // Ф1. Вторая выгрузка (zoo-points_2026-11-10_21-57) — по решениям заказчика
  const EXP = JSON.parse(read('docs/field/zoo-points_2026-11-10_21-57.geojson'));
  const drags = EXP.features.filter(f => f.properties.kind === 'point' && /перетащено/.test(f.properties.name) && D.places.some(p => p.id === f.properties.place));
  const badDrag = drags.filter(f => f.properties.place !== 'pond-3').filter(f => { const [lng, lat] = f.geometry.coordinates, p = P(f.properties.place); return p.lat !== lat || p.lng !== lng || p.approx !== false; }).map(f => f.properties.place);
  check('Ф1a. Все перетаскивания второй выгрузки перенесены (кроме случайного «Пруд 3»)', drags.length > 30 && badDrag.length === 0, badDrag);
  check('Ф1b. «Пруд 3» — на прежнем месте из первой выгрузки', P('pond-3').lat === 43.2634719 && P('pond-3').lng === 76.9755685, [P('pond-3').lat, P('pond-3').lng]);
  check('Ф1c. Кафе за оградой удалено, кафе на территории осталось', !D.places.some(p => p.id === 'cafe-1') && !!P('cafe-2').id);
  const count = z => D.places.filter(p => p.zone === z).length;
  check('Ф1d. Ещё места зон: тигры 3, зебры 3, хищные птицы 5, водоплавающие 4, фазаний ряд 2, приматы 2, пруды 4',
    count('tigers') === 3 && count('zebras') === 3 && count('raptors') === 5 && count('waterfowl') === 4 && count('pheasants') === 2 && count('primates') === 2 && count('pond') === 4,
    { tigers: count('tigers'), zebras: count('zebras'), raptors: count('raptors'), waterfowl: count('waterfowl'), pheasants: count('pheasants'), primates: count('primates'), pond: count('pond') });
  const NZ = { flamingo: 's-4-02', saiga: 's-2-10', koi: 's-6-06' };
  check('Ф1e. Новые зоны: фламинго 4-02, сайга 2-10, карпы кои 6-06 — на карте и в разделе «Животные»',
    Object.entries(NZ).every(([z, ic]) => D.zones.some(x => x.id === z && x.title.kz && x.title.ru && x.title.en) && P(z).icon === ic && P(z).zone === z));
  const cat = c => D.places.filter(p => p.cat === c).length;
  check('Ф1f. Охрана — 3 поста, остановки — 2, туалеты — 3, беседки — 4', cat('guard') === 3 && cat('bus') === 2 && cat('wc') === 3 && cat('gazebo') === 4,
    { guard: cat('guard'), bus: cat('bus'), wc: cat('wc'), gazebo: cat('gazebo') });
  check('Ф1g. Администрация — на карте для посетителей (новая иконка — заглушка до утверждения)', P('admin').kind === 'infra' && P('admin').icon === 'i-admin' && D.icons['i-admin'] && D.icons['i-admin'].placeholder === true);
  const S = id => D.places.find(x => x.id === id && x.kind === 'service') || {};   // 0.1.8: служебные — места kind service
  check('Ф1h. Служебный слой: вход, парковка, два въезда, ветчасть, тихая зона хищных птиц — с координатами',
    ['service-entrance', 'service-parking', 'service-gate', 'service-gate-2', 'vet', 'raptors-quiet'].every(id => typeof S(id).lat === 'number'));
  check('Ф1i. Неэкспозиционные зимние вольеры (носороги, зебры) — места с exhibit: false (0.1.8)', ['rhinos', 'zebras'].every(z => P('winter-' + z).exhibit === false && (P('winter-' + z).winterFor || []).includes(z)));
  const wv = ['flamingo', 'giraffes', 'primates', 'hippos', 'elephant'];
  check('Ф1j. Экспонируемые зимние вольеры (5) на месте; переезды включены по общим датам 15.10–14.04 (0.1.8)', wv.every(z => (P('winter-' + z).winterFor || []).includes(z) && P(z).winter && P(z).winter.place === 'winter-' + z) &&
    D.settings.winterMove.from === '10-15' && D.settings.winterMove.to === '04-14');
  const fp = (D.paths || []).filter(p => p.src === 'field-2026-11-10b');
  check('Ф1k. Дорожки из полевого режима: одна обычная, одна служебная (к тихой зоне)', fp.length === 2 && fp.filter(p => p.service).length === 1, fp.map(p => [p.id, p.service]));
  { const A = await launch({ lang: 'ru', now: NOW });
    check('Ф1l. Посетитель: администрация на карте, тихая зона и ветчасть — нет', !!A.app.markers.admin && !A.app.markers['raptors-quiet'] && !A.app.markers.vet);
    const gh = id => { const m = A.app.markers[id], el = m && m.getElement(); return !!el && el.classList.contains('ghost'); };
    check('Ф1m. Посетитель летом: экспонируемые зимние вольеры серые полупрозрачные, неэкспонируемых нет (0.1.8)', wv.every(z => gh('winter-' + z)) && !A.app.markers['winter-rhinos'] && !A.app.markers['winter-zebras']);
    check('Ф1n. Запуск без ошибок', A.errors.length === 0, A.errors);
    A.close(); }

  // Ф2. Новые точки — сразу иконкой зоны: полупрозрачная, розовая пунктирная кайма, перетаскивается
  { const A = await launch({ lang: 'ru', now: NOW });
    await enterField(A);
    tapPoint(A, 43.2641, 76.9762);
    A.$('#fPlace').value = 'new-zone:tigers'; A.$('#fPlace').dispatchEvent(new A.w.Event('change', { bubbles: true }));
    A.click('[data-f="formSave"]');
    const pm = pendingWith(A, 's-1-05');
    const el = pm[0] && pm[0].getElement();
    check('Ф2a. «Ещё одно место для зоны: Тигры» — сразу силуэт тигра на карте', pm.length === 1);
    check('Ф2b. Иконка полупрозрачная и с розовой пунктирной каймой', !!el && el.classList.contains('pending') && !!el.querySelector('circle.pend-ring[stroke-dasharray]'));
    if (pm[0]) {
      pm[0].setLatLng([43.26415, 76.97625]); pm[0].fire('dragend');
      const it = items(A).pop() || {};
      check('Ф2c. Перетаскивание новой иконки меняет координаты записи', it.coords && it.coords[0][0] === 43.26415 && it.coords[0][1] === 76.97625, it.coords);
    }
    A.close(); }

  // Ф3. «Ещё одно такое же место» для инфраструктуры; защита от переноса единственной иконки
  { const A = await launch({ lang: 'ru', now: NOW });
    await enterField(A);
    tapPoint(A, 43.2645, 76.9770);
    const vals = Array.from(A.w.document.querySelectorAll('#fPlace option')).map(o => o.value);
    check('Ф3a. В списке есть «Ещё один такой же» для туалета, беседки, охраны, остановки, служебного въезда',
      ['wc-1', 'gazebo-1', 'guard', 'bus', 'service-gate'].every(id => vals.includes('new-same:' + id)), vals.filter(v => v.startsWith('new-same')));
    A.$('#fPlace').value = 'new-same:wc-1'; A.click('[data-f="formSave"]');
    const it = items(A).pop() || {};
    check('Ф3b. Запись «ещё один туалет» — признак newSame, иконка туалета на карте', it.newSame === 'wc-1' && pendingWith(A, 'i-wc').length === 1, it);
    // выбрали место, у которого уже есть точка → вопрос «переместить или ещё одно такое же»
    const g0 = A.app.markers.guard.getLatLng();
    tapPoint(A, 43.2650, 76.9775); A.$('#fPlace').value = 'guard'; A.click('[data-f="formSave"]');
    tapPoint(A, 43.2655, 76.9780); A.$('#fPlace').value = 'guard'; A.click('[data-f="formSave"]');
    const ask = A.$('#fieldFormBody');
    check('Ф3c. Вторая точка к той же «Охране» — вопрос: переместить или добавить ещё одну', !A.$('#fieldForm').hidden && !!ask.querySelector('[data-f="formMove"]') && !!ask.querySelector('[data-f="formSame"]'), ask.textContent);
    A.click('[data-f="formSame"]');
    const recs = items(A).filter(x => x.place === 'guard' || x.newSame === 'guard');
    check('Ф3d. «Ещё одна»: первая точка осталась у охраны, вторая — новый пост', recs.length === 2 && recs.some(x => x.place === 'guard') && recs.some(x => x.newSame === 'guard'), recs);
    tapPoint(A, 43.2660, 76.9785); A.$('#fPlace').value = 'guard'; A.click('[data-f="formSave"]'); A.click('[data-f="formMove"]');
    const g = items(A).filter(x => x.place === 'guard');
    check('Ф3e. «Переместить»: у охраны снова одна запись — новая точка', g.length === 1 && g[0].coords[0][0] === 43.2660 && g0.lat !== 43.2660, g);
    A.close(); }

  // Ф4. Дорожка точками: «Обычная / Служебная» при сохранении
  { const A = await launch({ lang: 'ru', now: NOW });
    await enterField(A);
    A.click('[data-f="line"]');
    [[43.2640, 76.9760], [43.2642, 76.9763]].forEach(p => A.app.map.fire('click', { latlng: { lat: p[0], lng: p[1] } }));
    A.click('[data-f="lineDone"]');
    check('Ф4a. В форме дорожки — переключатель «Обычная / Служебная», по умолчанию обычная', !!A.$('#fSvcNo') && !!A.$('#fSvcYes') && A.$('#fSvcNo').checked);
    A.$('#fSvcYes').checked = true; A.click('[data-f="formSave"]');
    const it = items(A).pop() || {};
    check('Ф4b. Сохранено как служебная дорожка', it.type === 'line' && it.service === true, it);
    check('Ф4c. На карте — серый пунктир служебной дорожки', A.app.layers.field.getLayers().some(l => l.getLatLngs && l.options.color === '#8A8A8A' && l.options.dashArray));
    A.close(); }

  // Ф5. Новый зимний вольер: зоны, экспонируется ли, даты
  { const A = await launch({ lang: 'ru', now: NOW });
    await enterField(A);
    tapPoint(A, 43.2652, 76.9772);
    A.$('#fPlace').value = 'new-winter'; A.$('#fPlace').dispatchEvent(new A.w.Event('change', { bubbles: true }));
    const box = A.$('#fWinter');
    check('Ф5a. Для зимнего вольера появляются: зоны, «Экспонируется», даты', !!box && !box.hidden && A.$$('#fWinter input[name="fwz"]').length === D.zones.length && !!A.$('#fwExpYes') && !!A.$('#fwFrom') && !!A.$('#fwTo'));
    if (box) {
      A.$('#fWinter input[value="giraffes"]').checked = true; A.$('#fWinter input[value="zebras"]').checked = true;
      A.$('#fwExpNo').checked = true; A.$('#fwFrom').value = '01.11'; A.$('#fwTo').value = '31.03';
      A.click('[data-f="formSave"]');
      const it = items(A).pop() || {};
      check('Ф5b. Запись: зоны, «не экспонируется», даты ММ-ДД', it.newWinter === true && it.winterZones.join() === 'giraffes,zebras' && it.winterExhibit === false && it.winterFrom === '11-01' && it.winterTo === '03-31', it);
      check('Ф5c. На карте — иконка первой зоны (жираф), полупрозрачная', pendingWith(A, 's-2-02').some(l => l.getElement().classList.contains('pending')));
    }
    A.close(); }

  // Ф6. Новая зона: название + силуэт из 40
  { const A = await launch({ lang: 'ru', now: NOW });
    await enterField(A);
    tapPoint(A, 43.2648, 76.9768);
    A.$('#fPlace').value = 'new-zonedef'; A.$('#fPlace').dispatchEvent(new A.w.Event('change', { bubbles: true }));
    const sil = A.$$('#fZone [data-f="pickSil"]');
    check('Ф6a. «Новая зона» — сетка из 40 силуэтов', sil.length === 40);
    if (sil.length) {
      A.click('#fZone [data-f="pickSil"][data-icon="s-2-06"]');
      check('Ф6b. Выбранный силуэт отмечен', A.$('#fZone [data-icon="s-2-06"]').getAttribute('aria-pressed') === 'true');
      A.$('#fName').value = 'Верблюды'; A.click('[data-f="formSave"]');
      const it = items(A).pop() || {};
      check('Ф6c. Запись новой зоны: название и силуэт', it.newZoneDef && it.newZoneDef.icon === 's-2-06' && /Верблюды/.test(it.name), it);
      check('Ф6d. На карте — силуэт верблюда, полупрозрачный', pendingWith(A, 's-2-06').length === 1);
    }
    A.close(); }

  // Ф7. Меню по нажатию на иконку: удалить / убрать с карты / переименовать; «Вернуть»
  { const A = await launch({ lang: 'ru', now: NOW });
    await enterField(A);
    A.app.markers.lions.fire('click');
    const body = A.$('#fieldFormBody');
    check('Ф7a. Нажатие на место из приложения — меню: «Убрать с карты», «Изменить название», «Отмена»; карточки посетителя нет',
      !A.$('#fieldForm').hidden && !!body.querySelector('[data-f="mDel"]') && /Убрать с карты/.test(body.textContent) && !!body.querySelector('[data-f="mRename"]') && !A.w.document.querySelector('.leaflet-popup'), body.textContent);
    A.click('[data-f="mDel"]');
    let r = items(A).find(x => x.type === 'remove' && x.place === 'lions');
    const el = A.app.markers.lions.getElement();
    check('Ф7b. «Убрать с карты»: отметка в записях, иконка серая перечёркнутая', !!r && el.classList.contains('removed'));
    check('Ф7c. Внизу — «Удалено · Вернуть»', !A.$('#toast').hidden && !!A.$('#toast [data-f="undoDel"]'));
    A.click('#toast [data-f="undoDel"]');
    check('Ф7d. «Вернуть» снимает отметку', !items(A).some(x => x.type === 'remove' && x.place === 'lions') && !A.app.markers.lions.getElement().classList.contains('removed'));
    // новая запись: удалить с карты
    tapPoint(A, 43.2641, 76.9762); A.$('#fPlace').value = 'new-zone:tigers'; A.click('[data-f="formSave"]');
    const pm = pendingWith(A, 's-1-05')[0];
    if (pm) pm.fire('click');
    check('Ф7e. Нажатие на новую иконку — меню «Удалить»', !!pm && /Удалить/.test(A.$('#fieldFormBody').textContent));
    A.click('[data-f="mDel"]');
    check('Ф7f. Новая запись удалена, иконки нет', !items(A).some(x => x.newZone === 'tigers') && pendingWith(A, 's-1-05').length === 0);
    A.click('#toast [data-f="undoDel"]');
    check('Ф7g. «Вернуть» возвращает запись и иконку', items(A).some(x => x.newZone === 'tigers') && pendingWith(A, 's-1-05').length === 1);
    // переименование места из приложения
    A.app.markers.lions.fire('click'); A.click('[data-f="mRename"]');
    A.$('#fRename').value = 'Львы (новый вольер)'; A.click('[data-f="mRenameSave"]');
    const rn = items(A).find(x => x.type === 'rename' && x.place === 'lions');
    check('Ф7h. «Изменить название» места — запись rename для переноса', !!rn && rn.name === 'Львы (новый вольер)', rn);
    // экспорт
    A.click('[data-f="exit"]');
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
    let blob = null; const RB = A.w.Blob; A.w.Blob = function (p, o) { blob = p.join(''); return new RB(p, o); };
    A.w.URL.createObjectURL = () => 'blob:x'; A.w.URL.revokeObjectURL = () => {}; A.w.HTMLAnchorElement.prototype.click = function () {};
    A.click('[data-p="export"]'); await A.wait(20);
    const fs = blob ? JSON.parse(blob).features : [];
    check('Ф7i. Экспорт: переименование и новые признаки попадают в файл', fs.some(f => f.properties.kind === 'rename' && f.properties.place === 'lions') && fs.some(f => f.properties.newZone === 'tigers'));
    A.close(); }

  // Ф8. В «Списке» — «Назад» и вверху, и внизу
  { const A = await launch({ lang: 'ru', now: NOW });
    await enterField(A);
    tapPoint(A, 43.2641, 76.9762); A.click('[data-f="formSave"]');
    A.click('[data-f="list"]');
    const backs = A.$$('#fieldbar [data-f="back"]');
    const last = A.$('#fieldbar .flist').nextElementSibling;
    check('Ф8. Список: «Назад» вверху и внизу', backs.length === 2 && !!last && last.getAttribute('data-f') === 'back');
    A.close(); }
  // Ф9. Подсказка «Вернуть» не закрывает кнопки новой формы
  { const A = await launch({ lang: 'ru', now: NOW });
    await enterField(A);
    A.app.markers.lions.fire('click'); A.click('[data-f="mDel"]');
    tapPoint(A, 43.2641, 76.9762);
    check('Ф9. Открылась форма — подсказка «Вернуть» убрана', !A.$('#fieldForm').hidden && A.$('#toast').hidden);
    A.close(); }
  return done();
};
