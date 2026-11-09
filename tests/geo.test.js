/* Набор geo: «Где я?», вне территории, «Найти рядом», «К выходу», расстояния — с подставной геолокацией. */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('geo');
  const D = JSON.parse(read('data.json'));
  const NOW = '2026-07-08T12:00:00';
  const INSIDE = { lat: 43.2636, lng: 76.9742, acc: 8 };
  const OUTSIDE = { lat: D.meta.outsidePoint[0], lng: D.meta.outsidePoint[1], acc: 12 };

  // Г1. Расстояния и направление
  { const A = await launch({ lang: 'ru', now: NOW }); const f = A.app.fn;
    const d = f.dist({ lat: 43.2600, lng: 76.9700 }, { lat: 43.2700, lng: 76.9700 });
    check('Г1a. 0,01° широты ≈ 1112 м', Math.abs(d - 1112) < 5, Math.round(d));
    check('Г1b. Направление на север — 0°', Math.round(f.bearing({ lat: 43.26, lng: 76.97 }, { lat: 43.27, lng: 76.97 })) === 0);
    check('Г1c. Направление на восток — 90°', Math.round(f.bearing({ lat: 43.26, lng: 76.97 }, { lat: 43.26, lng: 76.98 })) === 90);
    check('Г1d. Точка внутри контура', f.insideZoo(INSIDE) === true);
    check('Г1e. Точка снаружи контура', f.insideZoo(OUTSIDE) === false);
    A.close(); }

  // Г2. «Где я?» внутри
  { const A = await launch({ lang: 'ru', now: NOW, gps: INSIDE });
    A.click('#btnLocate'); await A.wait(60);
    const txt = A.$('#sheetBody').textContent;
    check('Г2. Внутри: «Вы здесь» и точность', !A.$('#sheet').hidden && txt.includes('Вы здесь') && txt.includes('8 м'), txt);
    A.close(); }

  // Г3. «Где я?» снаружи — сообщение и кнопка «К зоопарку»
  { const A = await launch({ lang: 'kz', now: NOW, gps: OUTSIDE });
    A.click('#btnLocate'); await A.wait(60);
    check('Г3a. Снаружи: «вне территории» (kz)', A.$('#sheetBody').textContent.includes(D.ui.outside.kz));
    check('Г3b. Снаружи: кнопка «К зоопарку»', !!A.$('#sheetBody [data-act="toZoo"]'));
    A.close(); }

  // Г4. Нет разрешения / нет геолокации
  { const A = await launch({ lang: 'ru', now: NOW, gps: 'deny' });
    A.click('#btnLocate'); await A.wait(60);
    check('Г4a. Запрет геолокации — понятное сообщение', A.$('#sheetBody').textContent === D.ui.geoDenied.ru, A.$('#sheetBody').textContent);
    A.close(); }
  { const A = await launch({ lang: 'ru', now: NOW });
    A.click('#btnLocate'); await A.wait(60);
    check('Г4b. В браузере нет геолокации — сообщение без падения', A.$('#sheetBody').textContent === D.ui.geoUnavailable.ru && A.errors.length === 0, A.$('#sheetBody').textContent);
    A.close(); }

  // Г5. «Найти рядом»: аккордеон и ближайший объект
  { const A = await launch({ lang: 'ru', now: NOW, gps: INSIDE });
    check('Г5a. Список «Найти рядом» скрыт', A.$('#nearList').hidden);
    A.click('#btnNear');
    check('Г5b. Аккордеон раскрывается: 4 пункта', !A.$('#nearList').hidden && A.$$('#nearList button').length === 4);
    A.click('[data-near="0"]'); await A.wait(60);
    const wcs = D.places.filter(p => p.cat === 'wc'); const f = A.app.fn;
    const best = wcs.reduce((a, p) => f.dist(INSIDE, p) < f.dist(INSIDE, a) ? p : a);
    const m = Math.max(10, Math.round(f.dist(INSIDE, best) / 10) * 10);
    const txt = A.$('#sheetBody').textContent;
    check('Г5c. Ближайший туалет и расстояние до него', txt.includes('Ближайший: ' + best.title.ru) && txt.includes(m + ' м'), txt);
    check('Г5d. Аккордеон закрылся, на карте линия маршрута', A.$('#nearList').hidden && A.app.layers.route.getLayers().length === 1);
    A.close(); }
  { const A = await launch({ lang: 'ru', now: NOW, gps: 'deny' });
    A.click('#btnNear'); A.click('[data-near="2"]'); await A.wait(60);
    check('Г5e. Без GPS — сообщение, линии нет', A.$('#sheetBody').textContent === D.ui.noGpsNear.ru && A.app.layers.route.getLayers().length === 0);
    A.close(); }

  // Г6. «К выходу»
  { const A = await launch({ lang: 'en', now: NOW, gps: INSIDE });
    A.click('#btnNear'); A.click('[data-near="3"]'); await A.wait(60);
    const f = A.app.fn, ent = D.meta.entrance, m = Math.max(10, Math.round(f.dist(INSIDE, ent) / 10) * 10);
    const txt = A.$('#sheetBody').textContent;
    check('Г6a. «К выходу»: расстояние до центрального входа', txt.includes(m + ' m'), txt);
    check('Г6b. «К выходу»: направление словами', /Direction: (north|north-east|east|south-east|south|south-west|west|north-west)/.test(txt), txt);
    const deg = Math.round(f.bearing(INSIDE, ent));
    check('Г6c. Стрелка повёрнута на направление', A.$('#sheetBody .arrow').style.transform === `rotate(${deg}deg)`, A.$('#sheetBody .arrow').style.transform);
    check('Г6d. Линия до выхода на карте', A.app.layers.route.getLayers().length === 1);
    A.click('#sheetClose');
    check('Г6e. Закрытие карточки убирает линию', A.$('#sheet').hidden && A.app.layers.route.getLayers().length === 0);
    A.close(); }

  // Г7. Расстояние и время пешком в попапе после определения места
  { const A = await launch({ lang: 'ru', now: NOW, gps: INSIDE });
    A.click('#btnLocate'); await A.wait(60);
    A.app.markers.elephant.openPopup();
    const txt = A.w.document.querySelector('.leaflet-popup').textContent;
    check('Г7. В попапе — расстояние и «мин пешком»', /\d+ м · \d+ мин пешком/.test(txt), txt);
    A.close(); }
  return done();
};
