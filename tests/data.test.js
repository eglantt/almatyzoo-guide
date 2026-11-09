/* Набор data: целостность data.json, пиктограмм и строк интерфейса. */
'use strict';
const { suite, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('data');
  const D = JSON.parse(read('data.json'));
  const sprite = read('icons/sprite.svg');
  const spriteIds = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]));
  const LANGS = ['kz', 'ru', 'en'];

  // D1. Все текстовые объекты {kz,ru,en} заполнены на трёх языках
  const holes = [];
  (function walk(o, p) {
    if (Array.isArray(o)) return o.forEach((x, i) => walk(x, p + '[' + i + ']'));
    if (o && typeof o === 'object') {
      const keys = Object.keys(o);
      if (keys.includes('ru') && keys.some(k => k === 'kz' || k === 'en')) {
        LANGS.forEach(l => {
          const v = o[l];
          if (Array.isArray(v) ? !v.length || v.some(x => !String(x).trim()) : !String(v || '').trim()) holes.push(p + '.' + l);
        });
        return;
      }
      keys.forEach(k => walk(o[k], p + '.' + k));
    }
  })(D, 'data');
  check('D1. Все тексты заполнены на kz, ru, en', holes.length === 0, holes.slice(0, 10));

  // D2. Уникальные id
  const uniq = (arr, what) => { const s = new Set(); const dup = arr.filter(x => s.has(x.id) || !s.add(x.id)).map(x => x.id); check(`D2. Уникальные id: ${what}`, dup.length === 0, dup); };
  uniq(D.zones, 'zones'); uniq(D.places, 'places'); uniq(D.animals, 'animals');

  // D3. Связи: место животного → зона, зона → место, обитатель → место
  const zoneIds = new Set(D.zones.map(z => z.id)), placeIds = new Set(D.places.map(p => p.id));
  const badZone = D.places.filter(p => p.kind === 'animal' && !zoneIds.has(p.zone)).map(p => p.id);
  check('D3a. У каждого места с животными есть зона', badZone.length === 0, badZone);
  const lonely = D.zones.filter(z => !D.places.some(p => p.zone === z.id)).map(z => z.id);
  check('D3b. У каждой зоны есть место на карте', lonely.length === 0, lonely);
  const orphan = D.animals.filter(a => !placeIds.has(a.place)).map(a => a.id);
  check('D3c. Каждый обитатель ссылается на существующее место', orphan.length === 0, orphan);
  check('D3d. Типы зон известны', D.zones.every(z => ['pavilion', 'enclosure', 'zone'].includes(z.kind)), D.zones.map(z => z.kind));

  // D4. Пиктограммы: каждая есть в реестре и в спрайте; правила и интерфейс — в спрайте
  const used = new Set(D.places.map(p => p.icon).concat(D.rules.short.map(r => r.icon)));
  const notReg = [...used].filter(i => !D.icons[i]);
  const notSprite = [...used].filter(i => !spriteIds.has(i));
  check('D4a. Каждая пиктограмма мест и правил есть в реестре icons', notReg.length === 0, notReg);
  check('D4b. Каждая пиктограмма мест и правил есть в icons/sprite.svg', notSprite.length === 0, notSprite);
  const uiUse = new Set([...read('index.html').matchAll(/href="#([a-z]-[a-z]+)"/g), ...read('app.js').matchAll(/'([ui]-[a-z]+)'/g)].map(m => m[1]));
  const uiMissing = [...uiUse].filter(i => !spriteIds.has(i));
  check('D4c. Иконки интерфейса из index.html и app.js есть в спрайте', uiMissing.length === 0, uiMissing);
  const animalPh = D.places.filter(p => p.kind === 'animal').every(p => D.icons[p.icon].placeholder === true);
  check('D4d. Пиктограммы животных помечены как временные (placeholder)', animalPh);
  check('D4e. Знаки правил помечены как временные (placeholder)', D.rules.short.every(r => D.icons[r.icon].placeholder === true));
  check('D4f. Инфраструктура утверждена — без пометки placeholder', D.places.filter(p => p.kind !== 'animal').every(p => D.icons[p.icon].placeholder === false));

  // D5. Координаты в границах карты; места на территории — внутри контура
  const [[s, w], [n, e]] = D.meta.bounds;
  const outB = D.places.filter(p => !(p.lat > s && p.lat < n && p.lng > w && p.lng < e)).map(p => p.id);
  check('D5a. Все места внутри границ карты', outB.length === 0, outB);
  const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [yi, xi] = poly[i], [yj, xj] = poly[j]; if (((yi > p.lat) !== (yj > p.lat)) && (p.lng < (xj - xi) * (p.lat - yi) / (yj - yi) + xi)) c = !c; } return c; };
  const wrongSide = D.places.filter(p => (p.kind === 'outside') === inPoly(p, D.meta.boundary)).map(p => p.id);
  check('D5b. Места зоопарка внутри контура, парковка и остановка — снаружи', wrongSide.length === 0, wrongSide);
  // Расстояние от входа до ближайшей стороны контура (плоское приближение, метры)
  const toXY = p => [p[1] * 111320 * Math.cos(43.26 * Math.PI / 180), p[0] * 110540];
  const segDist = (pt, a, b) => { const [px, py] = pt, [ax, ay] = a, [bx, by] = b; const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
  const en = toXY([D.meta.entrance.lat, D.meta.entrance.lng]), B = D.meta.boundary.map(toXY);
  const edgeDist = Math.min(...B.map((b, i) => segDist(en, b, B[(i + 1) % B.length])));
  check('D5c. Центральный вход стоит на контуре (не дальше 30 м от границы)', edgeDist <= 30, Math.round(edgeDist) + ' м');
  const entPlace = D.places.find(p => p.cat === 'entrance');
  check('D5e. Место «Центральный вход» совпадает с meta.entrance', entPlace && entPlace.lat === D.meta.entrance.lat && entPlace.lng === D.meta.entrance.lng);
  check('D5d. Все места помечены approx (до полевого сбора)', D.places.every(p => p.approx === true));

  // D6. Часы и сезоны
  const hm = /^\d\d:\d\d$/, md = /^\d\d-\d\d$/;
  const H = D.settings.hours;
  check('D6a. Часы зоопарка и касс в формате ЧЧ:ММ', ['summer', 'winter'].every(sn => ['zoo', 'cash'].every(k => H[sn][k].every(x => hm.test(x)))));
  check('D6b. Даты сезона в формате ММ-ДД', md.test(D.settings.seasons.summer.from) && md.test(D.settings.seasons.summer.to));
  check('D6c. Санитарные дни — числа 1–7', D.places.filter(p => p.sanitaryDay).every(p => p.sanitaryDay >= 1 && p.sanitaryDay <= 7));
  const exo = D.places.find(p => p.id === 'exotarium'), bh = D.places.find(p => p.id === 'birdhouse');
  check('D6d. Экзотариум: 10:00–18:00, санитарный день вторник', exo.hours[0] === '10:00' && exo.hours[1] === '18:00' && exo.sanitaryDay === 2);
  check('D6e. Дом птиц: санитарный день четверг', bh.sanitaryDay === 4);
  check('D6f. Лето 09:00–20:00 (кассы до 19:00), зима 09:00–18:00 (кассы до 17:00)',
    H.summer.zoo.join() === '09:00,20:00' && H.summer.cash.join() === '09:00,19:00' && H.winter.zoo.join() === '09:00,18:00' && H.winter.cash.join() === '09:00,17:00');

  // D7. Строки интерфейса: каждый ключ, который вызывает код, есть в data.ui
  const app = read('app.js'), html = read('index.html');
  const keys = new Set([
    ...[...app.matchAll(/\bt\('([A-Za-z_0-9]+)'\s*[,)]/g)].map(m => m[1]),
    ...[...html.matchAll(/data-i18n(?:-ph|-aria)?="([A-Za-z_0-9]+)"/g)].map(m => m[1]),
    ...['dir0', 'dir1', 'dir2', 'dir3', 'dir4', 'dir5', 'dir6', 'dir7', 'filter_all', 'filter_animal', 'filter_infra', 'kind_pavilion', 'kind_enclosure', 'kind_zone', 'nearToilet', 'nearCafe', 'nearMed', 'nearExit', 'summer', 'winter', 'openNow', 'closedNow', 'searchAnimals', 'searchPlaces']
  ]);
  const missing = [...keys].filter(k => !D.ui[k]);
  check('D7. Все ключи интерфейса из кода есть в data.ui', missing.length === 0, missing);
  check('D7b. Дни недели: по 7 на каждом языке', LANGS.every(l => D.ui.weekdays[l].length === 7));

  // D8. Контакты: неактуальный телефон с сайта не используется
  check('D8. Старый телефон +7 (727) 310-19-37 нигде не указан', !/310.?19.?37/.test(read('data.json')));
  // D10 (0.1.3, 0.1.5). Зимние вольеры, закрытия, дорожки, служебные объекты
  // 0.1.5: зимняя настройка — у летнего места (place.winter); зимний вольер — место с winterFor
  const PI = Object.fromEntries(D.places.map(p => [p.id, p]));
  const badW = D.places.filter(p => p.winter && (!['moves', 'off'].includes(p.winter.mode) || !md.test(p.winter.from) || !md.test(p.winter.to) ||
    (p.winter.mode === 'moves' && !((PI[p.winter.place] || {}).winterFor || []).includes(p.id)))).map(p => p.id);
  check('D10a. Зимняя настройка мест: режим moves/off, даты ММ-ДД; у moves — зимний вольер, в чьём winterFor есть это место', badW.length === 0, badW);
  const badWo = D.places.filter(p => p.winterFor && (!p.winterFor.length || p.winterFor.some(id => !PI[id] || !PI[id].winter || PI[id].winter.place !== p.id))).map(p => p.id);
  check('D10b. Зимний вольер: каждое место в winterFor существует и ссылается на него', badWo.length === 0, badWo);
  check('D10f. Старая схема (zone.winter, winterOf) не используется', !D.zones.some(z => z.winter) && !D.places.some(p => p.winterOf));
  const ymd = /^\d{4}-\d\d-\d\d$/;
  const badC = D.places.filter(p => (p.closures || []).some(c => !ymd.test(c.from) || !ymd.test(c.to) || c.from > c.to)).map(p => p.id);
  check('D10c. Закрытия: даты ГГГГ-ММ-ДД, «с» не позже «по»', badC.length === 0, badC);
  const outPath = (D.paths || []).filter(p => p.coords.some(([la, ln]) => !(la > s && la < n && ln > w && ln < e))).map(p => p.id);
  check('D10d. Все дорожки внутри границ карты', outPath.length === 0, outPath.slice(0, 5));
  const svcClash = (D.service || []).filter(x => placeIds.has(x.id)).map(x => x.id);
  check('D10e. Служебные объекты не пересекаются по id с местами', svcClash.length === 0, svcClash);
  check('D9. Правил — 13, из них «Дети под присмотром» без черты', D.rules.short.length === 13 && D.rules.short.filter(r => r.ok).length === 1);
  return done();
};
