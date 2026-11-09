/* Набор field (0.1.2, уточнён в 0.1.3): плашка в полевом режиме и крестик, правка контура, перетаскивание пиктограмм. */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('field');
  const D = JSON.parse(read('data.json'));
  const NIGHT_TUE = '2026-11-10T02:40:00';          // ночь, вторник: «закрыт» + санитарный день
  const tapVersion = async A => { A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5); };
  const enterField = async A => {
    await tapVersion(A); A.$('#authInput').value = '12345'; A.click('#authOk'); await A.wait(900);
    A.click('[data-p="field"]');
  };
  const items = A => JSON.parse(A.w.localStorage.getItem('zoo_field') || '[]');
  const tapMap = (A, lat, lng) => A.app.map.fire('click', { latlng: { lat, lng } });
  // Виден, если ни сам элемент, ни его предки не скрыты (hidden или display: none)
  const visible = (A, sel) => { let el = A.$(sel); if (!el) return false; for (; el && el.nodeType === 1; el = el.parentElement) { if (el.hidden || A.w.getComputedStyle(el).display === 'none') return false; } return true; };

  // Ф1. Плашка в полевом режиме
  { const A = await launch({ lang: 'ru', now: NIGHT_TUE });
    check('Ф1a. Ночью во вторник плашка видна посетителю', visible(A, '#banner'));
    await enterField(A);
    check('Ф1b. В полевом режиме плашки нет', !visible(A, '#banner'));
    check('Ф1c. В полевом режиме спрятаны фильтры, «Найти рядом», «Где я?»', !visible(A, '#mapFilters') && !visible(A, '#near') && !visible(A, '#btnLocate'));
    A.click('[data-f="exit"]');
    check('Ф1d. После выхода из полевого режима плашка и кнопки снова видны', visible(A, '#banner') && visible(A, '#mapFilters') && visible(A, '#near'));
    A.close(); }

  // Ф2. Крестик плашки — до конца дня
  { const A = await launch({ lang: 'ru', now: NIGHT_TUE });
    const x = A.$('#banner [data-act="bannerClose"]');
    check('Ф2a. У плашки есть крестик', !!x);
    if (x) A.click(x);
    check('Ф2b. Крестик скрывает плашку', !visible(A, '#banner'));
    const stored = A.w.localStorage.getItem('zoo_banner_closed');
    A.close();
    const B = await launch({ lang: 'ru', now: '2026-11-10T21:00:00', storage: stored ? { zoo_banner_closed: stored } : {} });
    check('Ф2c. В тот же день после перезапуска плашки нет', !visible(B, '#banner'));
    B.close();
    const C = await launch({ lang: 'ru', now: '2026-11-12T02:00:00', storage: stored ? { zoo_banner_closed: stored } : {} });
    check('Ф2d. На следующий день плашка появляется снова (если повод есть)', visible(C, '#banner'));
    C.close(); }

  // Ф3. Плашка в одну полосу: одна строка с разделителем
  { const A = await launch({ lang: 'ru', now: NIGHT_TUE });
    check('Ф3. Обе причины в одной строке', A.$$('#banner .banner__text').length === 1 && A.$('#banner .banner__text').textContent.includes(' · '));
    A.close(); }

  // Ф4. Контур: шаг назад и перетаскивание точки
  { const A = await launch({ lang: 'ru', now: '2026-07-08T12:00:00' });
    await enterField(A);
    A.click('[data-f="polygon"]');
    [[43.2650, 76.9740], [43.2650, 76.9750], [43.2645, 76.9750], [43.2640, 76.9745]].forEach(([a, b]) => tapMap(A, a, b));
    check('Ф4i. Пока рисуется контур, пиктограммы пропускают тапы (класс drawing)', A.app.map.getContainer().classList.contains('drawing'));
    const undo = A.$('#fieldbar [data-f="undo"]');
    check('Ф4a. При рисовании контура есть «Шаг назад»', !!undo);
    if (undo) { A.click(undo); }
    check('Ф4b. «Шаг назад» убирает одну точку (было 4, стало 3)', /Точек: 3/.test(A.$('#fieldbar').textContent), A.$('#fieldbar').textContent);
    if (undo) { A.click('#fieldbar [data-f="undo"]'); A.click('#fieldbar [data-f="undo"]'); A.click('#fieldbar [data-f="undo"]'); A.click('#fieldbar [data-f="undo"]'); }
    check('Ф4c. «Шаг назад» можно нажимать до нуля, без ошибок', /Точек: 0/.test(A.$('#fieldbar').textContent) && A.errors.length === 0, A.$('#fieldbar').textContent);
    [[43.2650, 76.9740], [43.2650, 76.9750], [43.2645, 76.9750]].forEach(([a, b]) => tapMap(A, a, b));
    const handles = A.w.document.querySelectorAll('.fh');
    check('Ф4d. Точки контура показаны перетаскиваемыми кружками', handles.length === 3, handles.length);
    const hm = A.app.debugField && A.app.debugField().handles[1];
    if (hm) { hm.setLatLng([43.2652, 76.9752]); hm.fire('drag'); hm.fire('dragend'); }
    A.click('[data-f="polyDone"]'); if (A.$('#fPlace')) A.$('#fPlace').value = 'boundary'; A.click('[data-f="formSave"]');
    const poly = items(A).find(i => i.type === 'polygon');
    check('Ф4e. Перетаскивание меняет только эту точку', poly && poly.coords[1][0] === 43.2652 && poly.coords[1][1] === 76.9752 && poly.coords[0][0] === 43.2650 && poly.coords[2][0] === 43.2645, poly && poly.coords);
    // Правка сохранённого контура
    A.click('[data-f="list"]');
    const edit = A.$('#fieldbar [data-f="edit"]');
    check('Ф4f. У контура в списке есть «Изменить»', !!edit);
    if (edit) {
      A.click(edit);
      check('Ф4g. Контур открыт снова: 3 точки', /Точек: 3/.test(A.$('#fieldbar').textContent), A.$('#fieldbar').textContent);
      tapMap(A, 43.2641, 76.9741);
      A.click('[data-f="polyDone"]');
      const after = items(A).filter(i => i.type === 'polygon');
      check('Ф4h. Изменённый контур сохранён на месте прежнего, с тем же местом, без повторного вопроса', after.length === 1 && after[0].coords.length === 4 && after[0].place === 'boundary' && A.$('#fieldForm').hidden, after);
      check('Ф4j. После «Готово» пиктограммы снова нажимаются', !A.app.map.getContainer().classList.contains('drawing'));
    }
    A.close(); }

  // Ф5. Перетаскивание пиктограмм мест
  // Маркеры пересоздаются при входе в полевой режим и выходе (0.1.3: скрытые места появляются/прячутся) — берём заново
  { const A = await launch({ lang: 'ru', now: '2026-07-08T12:00:00' });
    let m = A.app.markers.elephant; const p0 = D.places.find(p => p.id === 'elephant');
    check('Ф5a. Вне полевого режима пиктограммы не перетаскиваются', !(m.dragging && m.dragging.enabled()));
    await enterField(A); m = A.app.markers.elephant;
    check('Ф5b. В полевом режиме пиктограммы перетаскиваются', !!(m.dragging && m.dragging.enabled()));
    m.setLatLng([43.26401, 76.97461]); m.fire('dragend');
    let rec = items(A).filter(i => i.place === 'elephant');
    check('Ф5c. Перетаскивание создаёт запись, привязанную к месту', rec.length === 1 && rec[0].type === 'point' && rec[0].coords[0][0] === 43.26401 && rec[0].coords[0][1] === 76.97461, rec);
    m.setLatLng([43.26402, 76.97462]); m.fire('dragend');
    rec = items(A).filter(i => i.place === 'elephant');
    check('Ф5d. Повторное перетаскивание заменяет запись, а не добавляет вторую', rec.length === 1 && rec[0].coords[0][0] === 43.26402, rec);
    A.click('[data-f="exit"]'); m = A.app.markers.elephant;
    const ll = m.getLatLng();
    check('Ф5e. После выхода из полевого режима пиктограмма на месте из data.json, перетаскивание выключено', ll.lat === p0.lat && ll.lng === p0.lng && !m.dragging.enabled(), ll);
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5); A.click('[data-p="field"]');
    const ll2 = A.app.markers.elephant.getLatLng();
    check('Ф5f. Снова в полевом режиме — пиктограмма там, куда её перетащили', ll2.lat === 43.26402 && ll2.lng === 76.97462, ll2);
    A.close(); }
  return done();
};
