/* Набор panel: 7 тапов, ключ, подмены даты и GPS, список заглушек, полевой режим. */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('panel');
  const D = JSON.parse(read('data.json'));
  const NOW = '2026-07-08T12:00:00';
  const tapVersion = async (A, n) => { A.click('[data-tab="more"]'); for (let i = 0; i < n; i++) A.click('#versionTag'); await A.wait(5); };
  const enter = async (A, key) => { A.$('#authInput').value = key; A.click('#authOk'); await A.wait(900); };

  // П1. Тапы по версии
  { const A = await launch({ lang: 'ru', now: NOW });
    await tapVersion(A, 6);
    check('П1a. 6 тапов — окно ключа не открывается', A.$('#authOverlay').hidden);
    await tapVersion(A, 1);
    check('П1b. 7-й тап в пределах 3 с — окно ключа', !A.$('#authOverlay').hidden);
    A.click('#authOverlay');
    check('П1c. Тап по фону окно не закрывает', !A.$('#authOverlay').hidden);
    A.click('#authCancel');
    check('П1d. «Отмена» закрывает окно', A.$('#authOverlay').hidden);
    A.close(); }
  { const A = await launch({ lang: 'ru', now: NOW });
    A.click('[data-tab="more"]');
    for (let i = 0; i < 4; i++) A.click('#versionTag');
    await A.wait(3200);
    for (let i = 0; i < 3; i++) A.click('#versionTag');
    check('П1e. 7 тапов, растянутых дольше 3 с, — окно не открывается', A.$('#authOverlay').hidden);
    A.close(); }

  // П2. Ключ
  { const A = await launch({ lang: 'ru', now: NOW });
    await tapVersion(A, 7); await enter(A, '00000');
    check('П2a. Неверный ключ — сообщение, поле очищено, панель закрыта', !A.$('#authErr').hidden && A.$('#authInput').value === '' && A.$('#panelOverlay').hidden);
    await enter(A, '12345');
    check('П2b. Верный ключ — панель открыта, окно ключа закрыто', !A.$('#panelOverlay').hidden && A.$('#authOverlay').hidden);
    check('П2c. В коде нет открытого ключа', !/['"]12345['"]/.test(read('app.js')));
    const body = A.$('#panelBody').textContent;
    check('П2d. Панель показывает версии приложения и данных', body.includes(A.app.version) && body.includes(D.meta.dataVersion));
    const ph = Object.values(D.icons).filter(i => i.placeholder).length;
    check(`П2e. Список заглушек: ${ph} (животные + правила)`, body.includes('Заглушки пиктограмм: ' + ph), ph);
    check('П2f. Счётчик мест с approx', body.includes(`approx: ${D.places.filter(p => p.approx).length} из ${D.places.length}`));
    A.close(); }

  // П3. Подмены даты и местоположения
  { const A = await launch({ lang: 'ru', now: NOW, gps: { lat: 43.2636, lng: 76.9742 } });
    await tapVersion(A, 7); await enter(A, '12345');
    A.$('#pNow').value = '2026-07-07T12:00'; A.click('[data-p="setNow"]'); await A.wait(10);
    check('П3a. Подмена даты на вторник — плашка про Экзотариум', !A.$('#banner').hidden && A.$('#banner').textContent.includes('Экзотариум'));
    A.click('[data-p="resetNow"]'); await A.wait(10);
    check('П3b. Сброс даты — плашки нет', A.$('#banner').hidden);
    A.click('[data-p="gpsSet"][data-v="outside"]'); A.click('#panelClose');
    A.click('[data-tab="map"]'); A.click('#btnLocate'); await A.wait(40);
    check('П3c. Подмена «вне территории» — сообщение «вне территории»', A.$('#sheetBody').textContent.includes(D.ui.outside.ru), A.$('#sheetBody').textContent);
    A.close(); }

  // П4. Сброс языка
  { const A = await launch({ lang: 'en', now: NOW });
    await tapVersion(A, 7); await enter(A, '12345');
    A.click('[data-p="resetLang"]');
    check('П4. Сброс языка — снова экран выбора, ключ удалён', !A.$('#langScreen').hidden && A.w.localStorage.getItem('zoo_lang') === null);
    A.close(); }

  // П5. Полевой режим: точка тапом, контур, список, удаление, имя файла
  { const A = await launch({ lang: 'ru', now: NOW });
    await tapVersion(A, 7); await enter(A, '12345');
    A.click('[data-p="field"]');
    check('П5a. Полевой режим: панель инструментов на карте', !A.$('#fieldbar').hidden && !A.$('#screen-map').hidden);
    const tileUrls = () => { const u = []; A.app.map.eachLayer(l => { if (l._url) u.push(l._url); }); return u.join(' '); };
    check('П5b. В полевом режиме — спутниковый слой вместо OSM', /arcgisonline/.test(tileUrls()) && !/openstreetmap/.test(tileUrls()), tileUrls());
    A.click('[data-f="tapPoint"]');
    A.app.map.fire('click', { latlng: { lat: 43.26401234, lng: 76.97512345 } });
    check('П5c. Тап по карте — форма названия', !A.$('#fieldForm').hidden);
    A.$('#fName').value = 'Жирафы — центр вольера'; A.click('[data-f="formSave"]');
    let items = JSON.parse(A.w.localStorage.getItem('zoo_field') || '[]');
    check('П5d. Точка сохранена в localStorage с координатами', items.length === 1 && items[0].type === 'point' && items[0].name === 'Жирафы — центр вольера' && items[0].coords[0][0] === 43.2640123, items);
    A.click('[data-f="polygon"]');
    [[43.2650, 76.9740], [43.2650, 76.9750], [43.2645, 76.9750]].forEach(([lat, lng]) => A.app.map.fire('click', { latlng: { lat, lng } }));
    A.click('[data-f="polyDone"]'); A.$('#fName').value = 'Контур пруда'; A.click('[data-f="formSave"]');
    items = JSON.parse(A.w.localStorage.getItem('zoo_field'));
    check('П5e. Контур из трёх точек сохранён', items.length === 2 && items[1].type === 'polygon' && items[1].coords.length === 3);
    A.click('[data-f="list"]');
    check('П5f. Список записей показывает обе', A.$$('#fieldbar .flist > div').length === 2);
    A.click(A.$$('#fieldbar [data-f="del"]')[0]);
    check('П5g. Удаление записи', JSON.parse(A.w.localStorage.getItem('zoo_field')).length === 1);
    check('П5h. Имя файла экспорта с датой и временем', A.app.fn.fileName(new A.w.Date(2026, 10, 6, 14, 30)) === 'zoo-points_2026-11-06_14-30.geojson');
    A.click('[data-f="back"]'); A.click('[data-f="exit"]');
    check('П5i. Выход из полевого режима: панель скрыта, снова OSM', A.$('#fieldbar').hidden && /openstreetmap/.test(tileUrls()) && !/arcgisonline/.test(tileUrls()), tileUrls());
    A.close(); }

  // П6. Без авторизации полевой режим и экспорт недоступны
  { const A = await launch({ lang: 'ru', now: NOW, storage: { zoo_field: JSON.stringify([{ id: 'f1', type: 'point', name: 'x', coords: [[43.26, 76.97]] }]) } });
    check('П6a. Панели и полевой панели нет без ключа', A.$('#panelOverlay').hidden && A.$('#fieldbar').hidden);
    check('П6b. Кнопки экспорта нет в открытом интерфейсе', !A.w.document.querySelector('[data-p="export"]'));
    A.close(); }
  return done();
};
