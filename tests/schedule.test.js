/* Набор schedule: сезоны, часы, санитарные дни, «Сегодня закрыт» — с подменой часов. */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('schedule');
  const D = JSON.parse(read('data.json'));
  const S = D.settings.seasons.summer;
  const yr = 2026;
  // Даты недели 2026: 6 июля — понедельник
  const at = (iso) => launch({ lang: 'ru', now: iso });

  // Ш1. Сезоны и границы
  { const A = await at(`${yr}-07-08T12:00:00`); const f = A.app.fn, d = m => new A.w.Date(m);
    check('Ш1a. Июль — лето', f.season(d(`${yr}-07-08T12:00:00`)) === 'summer');
    check('Ш1b. Январь — зима', f.season(d(`${yr}-01-15T12:00:00`)) === 'winter');
    check(`Ш1c. Первый день лета (${S.from}) — лето`, f.season(d(`${yr}-${S.from}T00:01:00`)) === 'summer');
    check(`Ш1d. Последний день лета (${S.to}) — лето`, f.season(d(`${yr}-${S.to}T23:59:00`)) === 'summer');
    const dayBefore = new Date(`${yr}-${S.from}T12:00:00`); dayBefore.setDate(dayBefore.getDate() - 1);
    check('Ш1e. Накануне лета — зима', f.season(dayBefore) === 'winter');
    check('Ш1f. Летом зоопарк 09:00–20:00, кассы 09:00–19:00', f.zooHours(d(`${yr}-07-08T12:00:00`)).zoo.join() === '09:00,20:00' && f.zooHours(d(`${yr}-07-08T12:00:00`)).cash.join() === '09:00,19:00');
    check('Ш1g. Зимой зоопарк 09:00–18:00, кассы 09:00–17:00', f.zooHours(d(`${yr}-01-15T12:00:00`)).zoo.join() === '09:00,18:00' && f.zooHours(d(`${yr}-01-15T12:00:00`)).cash.join() === '09:00,17:00');
    A.click('[data-tab="more"]');
    check('Ш1h. В «Ещё» показан летний режим', A.$('#moreBody').textContent.includes(D.ui.summer.ru) && A.$('#moreBody').textContent.includes('09:00–20:00'));
    A.close(); }
  { const A = await at(`${yr}-01-14T12:00:00`); A.click('[data-tab="more"]');
    check('Ш1i. Зимой в «Ещё» — зимний режим 09:00–18:00', A.$('#moreBody').textContent.includes(D.ui.winter.ru) && A.$('#moreBody').textContent.includes('09:00–18:00')); A.close(); }

  // Ш2. Санитарные дни × сезоны — попарно (вторник/четверг/среда × лето/зима)
  const days = { tue: { s: '07-07', w: '01-13' }, thu: { s: '07-09', w: '01-15' }, wed: { s: '07-08', w: '01-14' } };
  for (const [dn, ds] of Object.entries(days)) for (const [sn, mmdd] of Object.entries(ds)) {
    const A = await at(`${yr}-${mmdd}T12:00:00`);
    const exo = D.places.find(p => p.id === 'exotarium'), bh = D.places.find(p => p.id === 'birdhouse');
    const st = p => A.app.fn.placeStatus(p, new A.w.Date());
    const banner = A.$('#banner').hidden ? '' : A.$('#banner').textContent;
    const label = `${dn}/${sn === 's' ? 'лето' : 'зима'}`;
    check(`Ш2a. ${label}: Экзотариум ${dn === 'tue' ? 'закрыт' : 'открыт'}`, st(exo) === (dn === 'tue' ? 'sanitary' : 'open'), st(exo));
    check(`Ш2b. ${label}: Дом птиц ${dn === 'thu' ? 'закрыт' : 'открыт'}`, st(bh) === (dn === 'thu' ? 'sanitary' : 'open'), st(bh));
    check(`Ш2c. ${label}: плашка про санитарный день`, dn === 'wed' ? banner === '' : banner.includes(dn === 'tue' ? 'Экзотариум' : 'Дом птиц'), banner);
    A.click('[data-tab="coll"]');
    const card = A.$(dn === 'thu' ? '#coll-birdhouse' : '#coll-exotarium').textContent;
    check(`Ш2d. ${label}: в коллекции ${dn === 'wed' ? 'нет' : 'есть'} «Сегодня закрыт»`, dn === 'wed' ? !card.includes(D.ui.todayClosed.ru) : card.includes(D.ui.todayClosed.ru), card);
    A.close();
  }

  // Ш3. Часы Экзотариума и закрытие зоопарка
  { const A = await at(`${yr}-07-08T09:30:00`);
    const exo = D.places.find(p => p.id === 'exotarium'), el = D.places.find(p => p.id === 'elephant');
    check('Ш3a. 09:30 — зоопарк открыт, Экзотариум (с 10:00) ещё закрыт', A.app.fn.placeStatus(el, new A.w.Date()) === 'open' && A.app.fn.placeStatus(exo, new A.w.Date()) === 'closed');
    check('Ш3b. 09:30 — плашки «закрыто» нет', A.$('#banner').hidden);
    A.app.markers.exotarium.openPopup();
    check('Ш3c. В попапе Экзотариума: сейчас закрыто, 10:00–18:00', /Сейчас закрыто · 10:00–18:00/.test(A.w.document.querySelector('.leaflet-popup').textContent));
    A.close(); }
  { const A = await at(`${yr}-07-08T20:30:00`);
    check('Ш3d. 20:30 летом — плашка «Зоопарк сейчас закрыт»', !A.$('#banner').hidden && A.$('#banner').textContent.includes('Зоопарк сейчас закрыт'));
    A.close(); }
  { const A = await at(`${yr}-01-14T18:30:00`);
    check('Ш3e. 18:30 зимой — закрыто (летом ещё было бы открыто)', !A.$('#banner').hidden && A.$('#banner').textContent.includes('09:00–18:00'));
    A.close(); }
  return done();
};
