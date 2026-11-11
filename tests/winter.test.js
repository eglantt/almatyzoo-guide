/* Набор winter (0.1.5): несколько мест одной зоны (одинаковые пиктограммы), зимняя настройка у каждого места,
   общий зимний вольер для нескольких мест, новые места и зимние вольеры из полевого режима. */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('winter');
  const D = JSON.parse(read('data.json'));
  const SUMMER = '2026-07-08T12:00:00';
  const iconOf = (A, id) => { const el = A.app.markers[id] && A.app.markers[id].getElement(); const u = el && el.querySelector('use'); return u ? u.getAttribute('href') : null; };
  const popupText = (A, id) => { A.app.markers[id].openPopup(); const el = A.w.document.querySelector('.leaflet-popup'); return el ? el.textContent : ''; };
  const enterField = async A => {
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
    A.$('#authInput').value = '12345'; A.click('#authOk'); await A.wait(900); A.click('[data-p="field"]');
  };

  // Сценарий: медведи — в вольере (bears, остаётся на месте) и в павильоне (bears-2, зимой в общий зимний вольер с 1 декабря);
  // жирафы — в общий зимний вольер с 1 ноября; зебры — зимой не экспонируются (неэкспозиционный зимний вольер посетителю не показывается).
  const patch = X => {
    const P = id => X.places.find(p => p.id === id);
    const b = P('bears');
    X.places.push(Object.assign({}, b, { id: 'bears-2', lat: 43.2629, lng: 76.9779, major: false,
      winter: { from: '12-01', to: '03-15', mode: 'moves', place: 'winter-1' } }));
    P('giraffes').winter = { from: '11-01', to: '03-31', mode: 'moves', place: 'winter-1' };
    X.places.filter(p => p.zone === 'zebras').forEach(p => { p.winter = { from: '11-01', to: '03-31', mode: 'off' }; });   // 0.1.7: у зебр три места
    X.places.push({ id: 'winter-1', kind: 'animal', cat: 'winter', winterFor: ['bears-2', 'giraffes'], icon: 'a-deer',
      lat: 43.2650, lng: 76.9775, approx: true, major: false,
      title: { kz: 'Жылы павильон', ru: 'Тёплый павильон', en: 'Warm pavilion' } });
  };

  // В1. Несколько мест одной зоны — одинаковые пиктограммы, одна строка в разделе «Животные»
  { const A = await launch({ lang: 'ru', now: SUMMER, patch });
    check('В1a. Летом у медведей две пиктограммы на карте', !!A.app.markers.bears && !!A.app.markers['bears-2']);
    check('В1b. Пиктограммы одинаковые', iconOf(A, 'bears') && iconOf(A, 'bears') === iconOf(A, 'bears-2'), [iconOf(A, 'bears'), iconOf(A, 'bears-2')]);
    { const el = A.app.markers['winter-1'] && A.app.markers['winter-1'].getElement();
      check('В1c. Летом общий зимний вольер — серый полупрозрачный (в нём никого, 0.1.8)', !!el && el.classList.contains('ghost')); }
    A.click('[data-tab="coll"]');
    const rows = A.$$('#collList .coll__item').filter(el => el.textContent.includes('Медведи') && !el.textContent.includes('Белый'));
    check('В1d. В разделе «Животные» медведи — одной строкой', rows.length === 1, rows.length);
    const btn = rows[0] && rows[0].querySelector('[data-act="focusMany"]');
    check('В1e. «На карте» у медведей ведёт сразу к обоим местам', !!btn && btn.dataset.ids.split(',').sort().join() === 'bears,bears-2', btn && btn.dataset.ids);
    if (btn) A.click(btn);
    const pulsing = ['bears', 'bears-2'].every(id => { const el = A.app.markers[id].getElement(); return el && el.classList.contains('pulse'); });
    check('В1f. Нажатие: открыта карта, обе пиктограммы пульсируют', A.app.state.tab === 'map' && pulsing);
    const res = A.app.fn.doSearch('медвед').map(r => r.placeId);
    check('В1g. Поиск «медвед» находит оба места', res.includes('bears') && res.includes('bears-2'), res);
    A.app.markers['bears-2'].openPopup();
    const tc = A.w.document.querySelector('.leaflet-popup [data-act="toColl"]');
    check('В1h. «Об обитателях» во втором месте ведёт к той же строке раздела (медведи)', !!tc && tc.dataset.id === 'bears', tc && tc.dataset.id);
    if (tc) { A.click(tc); check('В1i. …и строка медведей подсвечена', A.$$('#collList .coll__item.hl').some(el => el.textContent.includes('Медведи'))); }
    A.close(); }

  // В2. Зимняя настройка — у каждого места: часть медведей уходит, часть остаётся
  { const A = await launch({ lang: 'ru', now: '2027-01-15T12:00:00', patch });
    check('В2a. Зимой медведи в вольере остаются на карте', !!A.app.markers.bears);
    check('В2b. Медведи из павильона ушли в зимний вольер: летнего места нет', !A.app.markers['bears-2']);
    check('В2c. Общий зимний вольер на карте', !!A.app.markers['winter-1']);
    const txt = A.app.markers['winter-1'] ? popupText(A, 'winter-1') : '';
    check('В2d. В карточке: «Зимний вольер», название и кто в нём сейчас — медведи и жирафы', txt.includes('Зимний вольер') && txt.includes('Тёплый павильон') && txt.includes('Медведи') && txt.includes('Жирафы'), txt);
    check('В2e. Слово «зимник» посетителю не показывается', !/зимник/i.test(txt));
    A.click('[data-tab="coll"]');
    const row = A.$$('#collList .coll__item').find(el => el.textContent.includes('Медведи') && !el.textContent.includes('Белый'));
    const btn = row && row.querySelector('[data-act="focusMany"]');
    check('В2f. Медведи в разделе: «Зимний вольер», «На карте» — к вольеру и к зимнему вольеру', !!row && row.textContent.includes('Зимний вольер') && !!btn && btn.dataset.ids.split(',').sort().join() === 'bears,winter-1', btn && btn.dataset.ids);
    const g = A.$('#coll-giraffes');
    check('В2g. Жирафы: «На карте» — к общему зимнему вольеру', !!g && !!g.querySelector('[data-act="focus"][data-id="winter-1"]'));
    const res = A.app.fn.doSearch('жираф').map(r => r.placeId);
    check('В2h. Поиск «жираф» зимой ведёт к общему зимнему вольеру', res.includes('winter-1') && !res.includes('giraffes'), res);
    check('В2i. Пиктограмма зимнего вольера — от первого, кто в нём сейчас (медведь из павильона)', iconOf(A, 'winter-1') === iconOf(A, 'bears'), iconOf(A, 'winter-1'));
    A.close(); }

  // В3. Свои даты у каждого места: 15 ноября жирафы уже в зимнем вольере, медведи из павильона — ещё нет
  { const A = await launch({ lang: 'en', now: '2026-11-15T12:00:00', patch });
    const txt = A.app.markers['winter-1'] ? popupText(A, 'winter-1') : '';
    check('В3a. 15 ноября: зимний вольер на карте, в нём только жирафы (en)', txt.includes('Winter enclosure') && txt.includes('Giraffes') && !txt.includes('Bears'), txt);
    check('В3b. 15 ноября медведи из павильона ещё на летнем месте', !!A.app.markers['bears-2']);
    check('В3c. Пиктограмма зимнего вольера — жирафа (кто в нём сейчас)', iconOf(A, 'winter-1') === '#' + D.places.find(p => p.id === 'giraffes').icon, iconOf(A, 'winter-1'));
    A.close(); }

  // В4. Неэкспозиционный зимний вольер: посетитель видит только «Зимой не экспонируется, вернётся весной»
  { const A = await launch({ lang: 'kz', now: '2027-01-15T12:00:00', patch });
    check('В4a. Зебр зимой на карте нет', !A.app.markers.zebras);
    A.click('[data-tab="coll"]');
    const z = A.$('#coll-zebras');
    check('В4b. В разделе — «Зимой не экспонируется…» (kz), без «На карте»', !!z && z.textContent.includes(D.ui.winterOff.kz) && !z.querySelector('[data-act="focus"],[data-act="focusMany"]'), z && z.textContent);
    A.close(); }

  // В5. Полевой режим: «Ещё одно место для зоны…» и «Новый зимний вольер»
  { const A = await launch({ lang: 'ru', now: SUMMER, patch });
    await enterField(A);
    check('В5a. Зимний вольер виден в полевом режиме и летом (чтобы поставить его на место)', !!A.app.markers['winter-1']);
    A.click('[data-f="tapPoint"]'); A.app.map.fire('click', { latlng: { lat: 43.2641, lng: 76.9761 } });
    const opts = Array.from(A.w.document.querySelectorAll('#fPlace option')).map(o => ({ v: o.value, t: o.textContent }));
    const vals = opts.map(o => o.v);
    check('В5b. В списке есть «Ещё одно место для зоны» для каждой зоны', D.zones.every(z => vals.includes('new-zone:' + z.id)), vals.filter(v => v.startsWith('new')).length);
    check('В5c. В списке есть «Новый зимний вольер»', vals.includes('new-winter'));
    const allText = A.$('#fieldFormBody').textContent;
    check('В5d. В форме — «зимний вольер», слова «зимник» нет', /зимний вольер/i.test(allText) && !/зимник/i.test(allText));
    A.$('#fPlace').value = 'new-zone:bears'; A.$('#fName').value = 'павильон у пруда'; A.click('[data-f="formSave"]');
    let it = JSON.parse(A.w.localStorage.getItem('zoo_field') || '[]').pop() || {};
    check('В5e. Точка «ещё одно место»: привязана к зоне, в названии зона и примечание', it.newZone === 'bears' && /Медведи/.test(it.name) && /ещё одно место/.test(it.name) && /павильон у пруда/.test(it.name), it);
    A.click('[data-f="tapPoint"]'); A.app.map.fire('click', { latlng: { lat: 43.2652, lng: 76.9770 } });
    A.$('#fPlace').value = 'new-winter'; A.$('#fName').value = 'тёплый павильон'; A.click('[data-f="formSave"]');
    it = JSON.parse(A.w.localStorage.getItem('zoo_field') || '[]').pop() || {};
    check('В5f. Точка «новый зимний вольер»: признак и название', it.newWinter === true && /Зимний вольер/.test(it.name), it);
    check('В5g. Новые точки видны на карте полевого режима', A.app.layers.field.getLayers().length >= 2);
    // Экспорт: признаки новых мест попадают в GeoJSON
    A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
    let blobText = null; const RealBlob = A.w.Blob;
    A.w.Blob = function (parts, o) { blobText = parts.join(''); return new RealBlob(parts, o); };
    A.w.URL.createObjectURL = () => 'blob:x'; A.w.URL.revokeObjectURL = () => {}; A.w.HTMLAnchorElement.prototype.click = function () {};
    A.click('[data-p="export"]'); await A.wait(20);
    const fs = blobText ? JSON.parse(blobText).features : [];
    check('В5h. Экспорт: newZone и newWinter в свойствах точек', fs.some(f => f.properties.newZone === 'bears') && fs.some(f => f.properties.newWinter === true), fs.map(f => f.properties));
    A.close(); }

  // В6. Настоящие данные (0.1.8): зимой летние места с переездом скрыты, их зимние вольеры видны; остальные зоны — на месте
  { const A = await launch({ lang: 'ru', now: '2027-01-15T12:00:00' });
    const animalZones = D.zones.filter(z => D.places.some(p => p.zone === z.id));
    const ok = animalZones.every(z => D.places.filter(p => p.zone === z.id).every(p => p.winter ? (!A.app.markers[p.id] && !!A.app.markers[p.winter.place]) : !!A.app.markers[p.id]));
    check('В6. Настоящие данные: зимой переехавшие — в зимних вольерах, остальные зоны на месте', ok);
    A.close(); }
  return done();
};
