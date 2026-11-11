/* Набор markers (0.1.8): часы работы только у павильонов с признаком showHours и у кассы, цвета маркеров по классу животных,
   служебные объекты серым, зимние вольеры (серые летом / цветные зимой; неэкспонируемые — только зимой), общие даты перевода, рамка карты. */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('markers');
  const D = JSON.parse(read('data.json'));
  const SUMMER = '2026-07-08T12:00:00', WINTER = '2027-01-15T12:00:00';
  const popup = (A, id) => { const m = A.app.markers[id]; if (!m) return null; m.openPopup(); const el = A.w.document.querySelector('.leaflet-popup'); const t = el ? el.textContent : ''; A.app.map.closePopup(); return t; };
  const fill = (A, id) => { const m = A.app.markers[id], el = m && m.getElement(); const c = el && el.querySelector('circle[r="17"]'); return c ? c.getAttribute('fill') : null; };
  const ghost = (A, id) => { const m = A.app.markers[id], el = m && m.getElement(); return !!el && el.classList.contains('ghost'); };
  const HOURS = /\d\d:\d\d–\d\d:\d\d/;

  // Н1. Часы — только у Дома птиц, Аквариума, Дома хищников, Экзотариума и кассы
  { const A = await launch({ lang: 'ru', now: SUMMER });
    const withH = ['birdhouse', 'aquarium', 'predators', 'exotarium', 'entrance'];
    check('Н1a. Признак showHours — ровно у четырёх павильонов и кассы', D.places.filter(p => p.showHours).map(p => p.id).sort().join() === withH.slice().sort().join());
    const t = {}; withH.forEach(id => { t[id] = popup(A, id) || ''; });
    check('Н1b. В карточках четырёх павильонов есть часы', ['birdhouse', 'aquarium', 'predators', 'exotarium'].every(id => HOURS.test(t[id])), t);
    check('Н1c. Экзотариум — свои часы 10:00–18:00, остальные три — часы зоопарка 09:00–20:00', /10:00–18:00/.test(t.exotarium) && ['birdhouse', 'aquarium', 'predators'].every(id => /09:00–20:00/.test(t[id])));
    const none = D.places.filter(p => !p.showHours && A.app.markers[p.id]).map(p => p.id).filter(id => HOURS.test(popup(A, id) || ''));
    check('Н1d. У всех остальных мест (пруды, вольеры, Приматы, зимние вольеры, инфраструктура) часов в карточке нет', none.length === 0, none);
    check('Н1e. У пруда часов нет (так было в 0.1.7)', !HOURS.test(popup(A, 'pond')) && !/Сейчас (открыто|закрыто)/.test(popup(A, 'pond')));
    check('Н1f. Санитарный день у Экзотариума по-прежнему указан', /Санитарный день — вторник/.test(t.exotarium));
    A.close(); }

  // Н2. Касса: часы кассы и часы зоопарка, летом и зимой, на трёх языках
  for (const lang of ['kz', 'ru', 'en']) {
    const A = await launch({ lang, now: SUMMER });
    const s = popup(A, 'entrance');
    check(`Н2a. [${lang}] Касса летом: «${D.ui.hoursCash[lang]} 09:00–19:00» и «${D.ui.hoursZoo[lang]} 09:00–20:00»`, s.includes(D.ui.hoursCash[lang] + ' 09:00–19:00') && s.includes(D.ui.hoursZoo[lang] + ' 09:00–20:00'), s);
    A.close();
  }
  { const A = await launch({ lang: 'ru', now: '2027-01-15T17:30:00' });
    const s = popup(A, 'entrance');
    check('Н2b. Зимой в 17:30: кассы 09:00–17:00 закрыты, зоопарк 09:00–18:00 открыт', /Кассы 09:00–17:00 · Сейчас закрыто/.test(s) && /Зоопарк 09:00–18:00 · Сейчас открыто/.test(s), s);
    A.close(); }

  // Н3. Признак можно включить новому месту (ларьку) — часы появляются без правки кода
  { const A = await launch({ lang: 'ru', now: SUMMER, patch: X => { X.places.find(p => p.id === 'kiosk-2').showHours = true; } });
    const s = popup(A, 'kiosk-2'), w = popup(A, 'wc-2');
    check('Н3. Ларёк с признаком showHours — с часами, туалет без признака — без часов', /09:00–20:00 · Сейчас открыто/.test(s) && !HOURS.test(w), [s, w]);
    A.close(); }

  // Н4. Раздел «Животные»: пометка «Открыто / Закрыто» с часами — только у строк с признаком
  { const A = await launch({ lang: 'ru', now: '2026-07-08T09:30:00' });
    A.click('[data-tab="coll"]');
    const exo = A.$('#coll-exotarium'), gir = A.$('#coll-giraffes'), bh = A.$('#coll-birdhouse');
    check('Н4a. Экзотариум в 09:30: «Сейчас закрыто · 10:00–18:00»', !!exo && /Сейчас закрыто · 10:00–18:00/.test(exo.textContent), exo && exo.textContent);
    check('Н4b. Дом птиц в 09:30: «Сейчас открыто · 09:00–20:00»', !!bh && /Сейчас открыто · 09:00–20:00/.test(bh.textContent), bh && bh.textContent);
    check('Н4c. У жирафов (вольер) часов нет', !!gir && !HOURS.test(gir.textContent), gir && gir.textContent);
    A.close(); }

  // Н5. Цвет маркеров животных — по классу (лист-образец №3); пруд, инфраструктура, еда — как раньше
  { const A = await launch({ lang: 'ru', now: SUMMER });
    const exp = { lions: '#A70E13', tigers: '#A70E13', elephant: '#B44B15', zebras: '#B44B15', primates: '#C16E02', raptors: '#0082B7', birdhouse: '#0082B7',
      crocodiles: '#5C9330', exotarium: '#5C9330', aquarium: '#008F91', koi: '#008F91', pond: '#4E8C12', 'wc-2': '#2E5A0A', 'cafe-2': '#C4920A' };
    const bad = Object.entries(exp).filter(([id, c]) => fill(A, id) !== c).map(([id, c]) => [id, fill(A, id), c]);
    check('Н5a. Цвета маркеров: хищные — красный, копытные — оранжевый, приматы — жёлтый, птицы — голубой, рептилии — зелёный, рыбы — бирюзовый', bad.length === 0, bad);
    const sil = D.places.filter(p => p.kind === 'animal' && /^s-\d/.test(p.icon) && A.app.markers[p.id] && !p.winterFor);
    const wrong = sil.filter(p => fill(A, p.id) === '#4E8C12').map(p => p.id);
    check('Н5b. Ни один маркер с силуэтом не остался прежним зелёным', wrong.length === 0, wrong);
    A.click('[data-tab="coll"]');
    const mini = A.$('#coll-lions .mkmini circle[r="17"]');
    check('Н5c. В разделе «Животные» значок того же цвета (львы — красный)', !!mini && mini.getAttribute('fill') === '#A70E13');
    A.close(); }

  // Н6. Служебные вход, въезды, парковка — серым, с пометкой; ветчасть и тихая зона посетителю не видны
  { const A = await launch({ lang: 'ru', now: SUMMER });
    const vis = ['service-entrance', 'service-gate', 'service-gate-2', 'service-parking'];
    check('Н6a. Четыре служебных объекта на карте, серым (#6E6E6E)', vis.every(id => fill(A, id) === '#6E6E6E'), vis.map(id => fill(A, id)));
    check('Н6b. Ветчасть и тихая зона хищных птиц посетителю не видны', !A.app.markers.vet && !A.app.markers['raptors-quiet']);
    const pe = popup(A, 'service-entrance'), pg = popup(A, 'service-gate'), pp = popup(A, 'service-parking');
    check('Н6c. Карточки: «Служебный вход · Только для персонала», въезд — «Только для техники», парковка — «Только для персонала»',
      /Служебный вход/.test(pe) && /Только для персонала/.test(pe) && /Служебный въезд/.test(pg) && /Только для техники/.test(pg) && /Только для персонала/.test(pp), [pe, pg, pp]);
    check('Н6d. Часов у служебных объектов нет', ![pe, pg, pp].some(s => HOURS.test(s)));
    check('Н6e. Служебные — в слое инфраструктуры (фильтр «Инфраструктура»)', vis.every(id => A.app.layers.infra.hasLayer(A.app.markers[id])));
    check('Н6f. Поиск служебные объекты не находит', A.app.fn.doSearch('служеб').length === 0 && A.app.fn.doSearch('въезд').length === 0);
    A.close(); }
  for (const lang of ['kz', 'en']) {
    const A = await launch({ lang, now: SUMMER });
    const s = popup(A, 'service-gate');
    check(`Н6g. [${lang}] Пометка въезда на своём языке`, s.includes(D.ui.vehiclesOnly[lang]), s);
    A.close();
  }

  // Н7. Зимние вольеры на настоящих данных
  { const A = await launch({ lang: 'ru', now: SUMMER });
    check('Н7a. Летом: жирафы на месте, их зимний вольер — серый полупрозрачный', !!A.app.markers.giraffes && ghost(A, 'winter-giraffes') && fill(A, 'winter-giraffes') === '#8A8A8A');
    const s = popup(A, 'winter-giraffes');
    check('Н7b. Летом в карточке: заголовок «Зимний вольер» (без повтора), «Сюда зимой переводят: Жирафы»', /^Зимний вольерСюда зимой переводят: Жирафы/.test(s), s);
    check('Н7c. Летом неэкспонируемых зимних вольеров (носороги, зебры) на карте нет, носороги и зебры на месте', !A.app.markers['winter-rhinos'] && !A.app.markers['winter-zebras'] && !!A.app.markers.rhinos && !!A.app.markers.zebras);
    A.close(); }
  { const A = await launch({ lang: 'ru', now: WINTER });
    check('Н7d. Зимой: летнего вольера жирафов нет, зимний — непрозрачный, цвет копытных', !A.app.markers.giraffes && !ghost(A, 'winter-giraffes') && fill(A, 'winter-giraffes') === '#B44B15');
    const s = popup(A, 'winter-giraffes');
    check('Н7e. Зимой в карточке: «Зимний вольер», «Сейчас здесь: Жирафы»', /^Зимний вольерСейчас здесь: Жирафы/.test(s), s);
    check('Н7f. Зимой неэкспонируемый вольер носорогов — серый, непрозрачный; летних мест носорогов и зебр нет', fill(A, 'winter-rhinos') === '#6E6E6E' && !ghost(A, 'winter-rhinos') && !A.app.markers.rhinos && !A.app.markers.zebras && !A.app.markers['zebras-2']);
    const r = popup(A, 'winter-rhinos');
    check('Н7g. В карточке: «Зимний вольер», «не экспонируется: Носороги»', /^Зимний вольерне экспонируется: Носороги/.test(r), r);
    A.click('[data-tab="coll"]');
    const row = A.$('#coll-rhinos');
    check('Н7h. «Животные»: носороги — «Зимой не экспонируется, вернётся весной», «На карте» ведёт к серому зимнему вольеру',
      !!row && row.textContent.includes(D.ui.winterOff.ru) && !!row.querySelector('[data-act="focus"][data-id="winter-rhinos"]'), row && row.innerHTML.slice(0, 400));
    check('Н7i. Приматы зимой: «На карте» — к зимнему вольеру приматов', !!A.$('#coll-primates [data-act="focus"][data-id="winter-primates"]'));
    A.close(); }

  // Н8. Общие даты перевода: в зимние — 15 октября, в летние — 15 апреля
  for (const [day, winter] of [['2026-10-14', false], ['2026-10-15', true], ['2027-04-14', true], ['2027-04-15', false]]) {
    const A = await launch({ lang: 'ru', now: day + 'T12:00:00' });
    const got = !A.app.markers.elephant && !!A.app.markers['winter-elephant'] && !ghost(A, 'winter-elephant');
    check(`Н8. ${day}: слон ${winter ? 'в зимнем вольере' : 'в летнем вольере'}`, got === winter && (winter || (!!A.app.markers.elephant && ghost(A, 'winter-elephant'))));
    A.close();
  }
  // Н9. Свои даты у места важнее общих
  { const A = await launch({ lang: 'ru', now: '2026-11-20T12:00:00', patch: X => { X.places.find(p => p.id === 'elephant').winter.from = '12-01'; } });
    check('Н9. У слона свои даты с 1 декабря: 20 ноября он ещё в летнем вольере, бегемоты (общие даты) — уже в зимнем', !!A.app.markers.elephant && ghost(A, 'winter-elephant') && !A.app.markers.hippos && !ghost(A, 'winter-hippos'));
    A.close(); }

  // Н10. Рамка карты — из данных, симметричная
  { const A = await launch({ lang: 'ru', now: SUMMER });
    const mb = A.app.map.options.maxBounds, [[s, w], [n, e]] = D.meta.bounds;
    check('Н10. Карта ограничена новой рамкой из данных', !!mb && Math.abs(mb.getSouth() - s) < 1e-9 && Math.abs(mb.getNorth() - n) < 1e-9 && Math.abs(mb.getWest() - w) < 1e-9 && Math.abs(mb.getEast() - e) < 1e-9);
    check('Н11. Запуск без ошибок', A.errors.length === 0, A.errors);
    A.close(); }
  return done();
};
