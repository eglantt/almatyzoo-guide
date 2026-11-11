/* Набор app: настоящий index.html в jsdom — запуск, язык, меню, поиск, связи, правила, «Ещё». Каждый сценарий — с чистого запуска. */
'use strict';
const { suite, launch, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('app');
  const D = JSON.parse(read('data.json'));
  const NOW = '2026-07-15T12:00:00';     // среда, лето, зоопарк открыт

  // A1. Первый запуск: экран выбора языка, подсвечен язык устройства
  { const A = await launch({ lang: null, deviceLang: 'kk-KZ', now: NOW });
    check('A1a. Запуск без ошибок', A.errors.length === 0, A.errors);
    check('A1b. Первый запуск — экран выбора языка', !A.$('#langScreen').hidden);
    check('A1c. Подсвечен язык устройства (казахский)', A.$('[data-pick="kz"]').classList.contains('suggest') && !A.$('[data-pick="ru"]').classList.contains('suggest'));
    A.click('[data-pick="en"]');
    check('A1d. Выбор языка закрывает экран и сохраняется', A.$('#langScreen').hidden && A.w.localStorage.getItem('zoo_lang') === 'en');
    check('A1e. Интерфейс переключился на английский', A.$('[data-tab="map"] span').textContent === 'Map');
    A.close(); }

  // A2. Повторный запуск — экрана выбора нет
  { const A = await launch({ lang: 'ru', now: NOW });
    check('A2. Повторный запуск без экрана выбора языка', A.$('#langScreen').hidden); A.close(); }

  for (const lang of ['kz', 'ru', 'en']) {
    const A = await launch({ lang, now: NOW });
    const tag = `[${lang}]`;
    check(`A3. ${tag} Запуск без ошибок`, A.errors.length === 0, A.errors);
    // Все подписи интерфейса заполнены строками нужного языка, а не ключами
    const empty = A.$$('[data-i18n]').filter(el => !el.textContent.trim() || el.textContent === el.dataset.i18n).map(el => el.dataset.i18n);
    check(`A4. ${tag} Все подписи интерфейса заполнены`, empty.length === 0, empty);
    check(`A5. ${tag} Подписи меню на нужном языке`, A.$('[data-tab="rules"] span').textContent === D.ui.tabRules[lang]);
    check(`A6. ${tag} Атрибут lang документа`, A.w.document.documentElement.lang === (lang === 'kz' ? 'kk' : lang));
    // Карта: маркеры всех мест, подписи главных
    // 0.1.8: летом экспонируемый зимний вольер виден (серый полупрозрачный); неэкспонируемый, ветчасть и тихая зона — нет
    const vis = D.places.filter(p => !p.staffOnly && !(p.winterFor && p.exhibit === false));
    check(`A7. ${tag} На карте маркер у каждого места (кроме неэкспонируемых зимних вольеров летом и служебных «только для персонала»)`, Object.keys(A.app.markers).length === vis.length && vis.every(p => !!A.app.markers[p.id]), Object.keys(A.app.markers).length);
    // Фильтры
    A.click('[data-filter="animal"]');
    check(`A8a. ${tag} Фильтр «Животные» убирает инфраструктуру`, A.app.map.hasLayer(A.app.layers.animal) && !A.app.map.hasLayer(A.app.layers.infra));
    A.click('[data-filter="infra"]');
    check(`A8b. ${tag} Фильтр «Инфраструктура» убирает животных`, !A.app.map.hasLayer(A.app.layers.animal) && A.app.map.hasLayer(A.app.layers.infra));
    A.click('[data-filter="all"]');
    check(`A8c. ${tag} «Все» возвращает оба слоя`, A.app.map.hasLayer(A.app.layers.animal) && A.app.map.hasLayer(A.app.layers.infra));
    // Меню
    for (const tab of ['coll', 'rules', 'more', 'map']) {
      A.click(`[data-tab="${tab}"]`);
      const vis = A.$$('.screen').filter(s => !s.hidden).map(s => s.dataset.screen);
      check(`A9. ${tag} Вкладка ${tab} открывается одна`, vis.length === 1 && vis[0] === tab, vis);
    }
    // Коллекция: все зоны
    A.click('[data-tab="coll"]');
    check(`A10. ${tag} В коллекции все ${D.zones.length} зон`, A.$$('.coll__item').length === D.zones.length, A.$$('.coll__item').length);
    // Правила
    A.click('[data-tab="rules"]');
    check(`A11a. ${tag} Знаков правил — 13`, A.$$('#rulesBody .rule').length === 13);
    check(`A11b. ${tag} Предупреждение о выводе без возврата стоимости`, A.$('#rulesBody .warn').textContent.includes(D.rules.warning[lang]));
    check(`A11c. ${tag} Полный текст — раскрывающийся блок`, !!A.$('#rulesBody details.full') && A.$$('#rulesBody details.full li').length === D.rules.full.length);
    // Ещё
    A.click('[data-tab="more"]');
    check(`A12a. ${tag} Номер версии внизу «Ещё»`, A.$('#versionTag') && A.$('#versionTag').textContent.includes(A.app.version));
    check(`A12b. ${tag} Пустой телефон не показывается`, !A.$('#moreBody a[href^="tel:"]') && !A.$('#moreBody a[href*="wa.me"]'));
    const ent = D.meta.entrance;
    const links = A.$$('#moreBody .btnrow a').map(a => a.href);
    check(`A12c. ${tag} Кнопки маршрута ведут по координатам центрального входа`, links.length === 3 && links.every(h => h.includes(String(ent.lat)) && h.includes(String(ent.lng))), links);
    A.close();
  }

  // A13. Поиск: по всем языкам сразу, частично, без учёта ё/е и казахских букв
  { const A = await launch({ lang: 'ru', now: NOW });
    const ids = q => A.app.fn.doSearch(q).map(r => r.placeId);
    check('A13a. «жир» находит жирафов', ids('жир').includes('giraffes'));
    check('A13b. «lion» в русском интерфейсе находит львов', ids('lion').includes('lions'));
    check('A13c. «арыстан» находит львов', ids('арыстан').includes('lions'));
    check('A13d. «КҰСТАР» (заглавные, ұ) находит Дом птиц', ids('КҰСТАР').includes('birdhouse'));
    check('A13e. «кустар» (без казахских букв) находит Дом птиц', ids('кустар').includes('birdhouse'));
    check('A13f. «туал» находит все туалеты', ids('туал').filter(i => i.startsWith('wc')).length === D.places.filter(p => p.cat === 'wc').length && D.places.filter(p => p.cat === 'wc').length >= 2);
    check('A13g. Одна буква — пустой результат', ids('ж').length === 0);
    A.click('#btnSearch'); A.$('#searchInput').value = 'слон'; A.$('#searchInput').dispatchEvent(new A.w.Event('input'));
    const item = A.$('#searchResults [data-act="focus"]');
    check('A13h. Результаты сгруппированы, есть «Животные»', !!item && A.$('#searchResults .sr__h').textContent === D.ui.searchAnimals.ru);
    A.click(item);
    check('A13i. Выбор результата: поиск закрыт, карта, попап слона открыт', A.$('#searchOverlay').hidden && !A.$('#screen-map').hidden && A.app.markers.elephant.isPopupOpen());
    A.close(); }

  // A14. Связи карта ↔ коллекция
  { const A = await launch({ lang: 'ru', now: NOW });
    A.click('[data-tab="coll"]');
    A.click('#coll-hippos [data-act="focus"]');
    check('A14a. «На карте» из коллекции: вкладка карты, попап места открыт', !A.$('#screen-map').hidden && A.app.markers.hippos.isPopupOpen());
    const btn = A.w.document.querySelector('.leaflet-popup [data-act="toColl"]');
    check('A14b. В попапе места с животными есть кнопка «В коллекцию»', !!btn);
    if (btn) { A.click(btn); check('A14c. Кнопка открывает коллекцию и подсвечивает карточку', !A.$('#screen-coll').hidden && A.$('#coll-hippos').classList.contains('hl')); }
    A.app.markers.entrance.openPopup();
    check('A14d. У инфраструктуры кнопки «В коллекцию» нет', !A.w.document.querySelector('.leaflet-popup [data-act="toColl"]'));
    A.click('[data-tab="coll"]'); A.$('#collSearch').value = 'тигр'; A.$('#collSearch').dispatchEvent(new A.w.Event('input'));
    check('A14e. Поиск по коллекции оставляет только найденное', A.$$('.coll__item').length === 1 && !!A.$('#coll-tigers'));
    A.close(); }

  // A15. Пиктограммы-заглушки помечены пурпурным кольцом, утверждённые — нет
  { const A = await launch({ lang: 'ru', now: NOW });
    const ring = id => !!A.app.markers[id].getElement().querySelector('circle[stroke="#FF00FF"]');
    // 0.1.6: у слона — утверждённый силуэт заказчика, заглушка осталась у пруда
    check('A15a. Маркер-заглушка (пруд) — с пурпурным кольцом, утверждённый силуэт (слон) — без', ring('pond') && !ring('elephant'));
    check('A15b. Маркер инфраструктуры (утверждён) — без кольца', !ring('wc-1'));
    A.click('[data-tab="rules"]');
    check('A15c. Знаки правил (заглушки) — с кольцом', A.$$('#rulesBody .rule circle[stroke="#FF00FF"]').length === 13);
    A.close(); }
  return done();
};
