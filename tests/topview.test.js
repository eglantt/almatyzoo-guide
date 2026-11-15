/* Набор topview (0.1.12): «Вид сверху» — основная карта посетителя. Файлы плиток, выбор по умолчанию, масштаб 20,
   пустые плитки без запросов, контур и дорожки поверх картинки, полевой режим, запасной путь без плиток. */
'use strict';
const fs = require('fs');
const path = require('path');
const { suite, launch, read, ROOT } = require('./harness');

const SUMMER = '2026-07-08T12:00:00';

async function enterField(A) {
  A.click('[data-tab="more"]'); for (let i = 0; i < 7; i++) A.click('#versionTag'); await A.wait(5);
  A.$('#authInput').value = '12345'; A.click('#authOk'); await A.wait(900); A.click('[data-p="field"]'); await A.wait(5);
  A.click('[data-tab="map"]'); await A.wait(5);
}

module.exports = async function () {
  const { check, done } = suite('topview');
  const D = JSON.parse(read('data.json'));
  const dir = D.settings.topView;

  // Т1. Файлы
  { check('Т1a. settings.topView — папка плиток с версией сборки', /^map\/top\/r\d+$/.test(dir || ''), dir);
    let ix = null; try { ix = JSON.parse(read(dir + '/index.json')); } catch (e) { /* нет */ }
    check('Т1b. index.json есть: версия = папке, масштабы 16–20', !!ix && ix.version === path.basename(dir) && ix.minZoom === 16 && ix.maxZoom === 20, ix && { v: ix.version, z: [ix.minZoom, ix.maxZoom] });
    if (ix) {
      const miss = ix.tiles.filter(k => !fs.existsSync(path.join(ROOT, dir, k + '.webp')));
      check('Т1c. Все плитки из списка лежат в папке', ix.tiles.length > 300 && miss.length === 0, { n: ix.tiles.length, miss: miss.slice(0, 3) });
      const onDisk = []; const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.webp') && onDisk.push(path.relative(path.join(ROOT, dir), path.join(d, e.name)).replace(/\\/g, '/').replace(/\.webp$/, '')));
      walk(path.join(ROOT, dir));
      check('Т1d. Лишних плиток вне списка нет', onDisk.length === ix.tiles.length, { disk: onDisk.length, list: ix.tiles.length });
      const mb = ix.tiles.reduce((s, k) => s + fs.statSync(path.join(ROOT, dir, k + '.webp')).size, 0) / 1e6;
      check('Т1e. Вес плиток — до 8 МБ', mb <= 8, mb.toFixed(2));
      const zs = new Set(ix.tiles.map(k => +k.split('/')[0]));
      check('Т1f. Плитки есть на каждом масштабе 16–20', [16, 17, 18, 19, 20].every(z => zs.has(z)), [...zs]);
      const [[s, w], [n, e]] = ix.bounds;
      check('Т1g. Картинка накрывает всю территорию зоопарка', D.meta.boundary.every(([la, lo]) => la > s && la < n && lo > w && lo < e));
      const webp = fs.readFileSync(path.join(ROOT, dir, ix.tiles[ix.tiles.length - 1] + '.webp'));
      check('Т1h. Плитки — WebP', webp.slice(0, 4).toString() === 'RIFF' && webp.slice(8, 12).toString() === 'WEBP');
    }
    const sw = read('sw.js'), tv = (sw.match(/TOP_VERSION = '([^']+)'/) || [])[1];
    check('Т1i. TOP_VERSION в sw.js = папке settings.topView', tv && dir === 'map/top/' + tv, { sw: tv, dir });
    check('Т1j. Скрипты сборки и исходные данные в репозитории', ['tools/topview/render.py', 'tools/topview/tiles.py', 'tools/topview/src/topview-src.json'].every(f => fs.existsSync(path.join(ROOT, f))));
    const ui = D.ui.baseTop;
    check('Т1k. «Вид сверху» — на трёх языках', !!ui && ui.kz && ui.ru === 'Вид сверху' && ui.en, ui);
    check('Т1l. В репозиторий не идёт рабочая папка рендера (tools/topview/out/)', /tools\/topview\/out\//.test(read('.gitignore')));
  }

  // Т2. Посетитель: «Вид сверху» по умолчанию
  { const A = await launch({ lang: 'ru', now: SUMMER, basemap: true });
    await A.app.basemapReady; const ok = await A.app.topViewReady; await A.wait(10);
    const map = A.app.map, Ly = A.app.layers, top = A.app.topLayer;
    const btns = () => A.$$('#baseSwitch button').map(b => b.dataset.base);
    check('Т2a. Плитки «Вида сверху» подключены', ok === true && !!top, ok);
    check('Т2b. По умолчанию у посетителя — «Вид сверху»', !!top && map.hasLayer(top) && A.$('[data-base="top"]').getAttribute('aria-pressed') === 'true' && map.getContainer().classList.contains('base-top'));
    check('Т2c. Переключатель «Вид сверху / Схема / Спутник»', JSON.stringify(btns()) === '["top","osm","sat"]' && A.$('[data-base="top"]').textContent === 'Вид сверху', btns());
    check('Т2d. Максимальный масштаб карты — 20', map.getMaxZoom() === 20, map.getMaxZoom());
    check('Т2e. Плитки: родные масштабы 16–20, мельче 16 — растягиваются', top && top.options.maxNativeZoom === 20 && top.options.minNativeZoom === 16, top && top.options);
    const ix = JSON.parse(read(dir + '/index.json')); const k = ix.tiles[0].split('/').map(Number);
    check('Т2f. Плитка из списка — адрес файла в папке сборки', top.getTileUrl({ z: k[0], x: k[1], y: k[2] }) === `${dir}/${ix.tiles[0]}.webp`, top.getTileUrl({ z: k[0], x: k[1], y: k[2] }));
    check('Т2g. Пустая плитка — без запроса (прозрачная картинка)', /^data:image\//.test(top.getTileUrl({ z: 20, x: 1, y: 1 })));
    check('Т2h. Под картинкой — схема города, подписи улиц на месте', map.hasLayer(Ly.baseMain) && map.hasLayer(Ly.baseLabels));
    check('Т2i. Ограды и стенки схемы не рисуются (они на картинке)', (map.setZoom(19, { animate: false }), !map.hasLayer(Ly.baseFence) && !map.hasLayer(Ly.baseWall)));
    check('Т2j. Контур OSM поверх картинки не рисуется', !map.hasLayer(Ly.boundary));
    const svc = (D.paths || []).filter(p => p.service).length;
    check('Т2k. Дорожки: на картинке; поверх — только служебные (пунктир, «Проход запрещён»)', Ly.paths.getLayers().length === svc, { drawn: Ly.paths.getLayers().length, svc });
    check('Т2l. Спутника нет', !map.hasLayer(A.app.layers.sat || {}) && (() => { const u = []; map.eachLayer(l => { if (l._url && /arcgis/.test(l._url)) u.push(l._url); }); return u.length === 0; })());
    A.click('[data-base="osm"]'); await A.wait(5);
    check('Т2m. «Схема»: картинки нет, контур и все дорожки — снова', !map.hasLayer(top) && map.hasLayer(Ly.boundary) && Ly.paths.getLayers().length === (D.paths || []).length && map.getContainer().classList.contains('base-scheme'));
    A.click('[data-base="top"]'); await A.wait(5);
    check('Т2n. Обратно «Вид сверху»', map.hasLayer(top) && !map.hasLayer(Ly.boundary));
    A.click('.langsw [data-lang="kz"]'); await A.wait(5);
    check('Т2o. Казахский: «Жоғарыдан»', A.$('[data-base="top"]').textContent === D.ui.baseTop.kz);
    A.click('.langsw [data-lang="en"]'); await A.wait(5);
    check('Т2p. Английский: «Top view»', A.$('[data-base="top"]').textContent === 'Top view');
    check('Т2q. Без ошибок', A.errors.length === 0, A.errors);
    A.close(); }

  // Т3. Выбор запоминается; старый выбор 0.1.11 («Схема», ключ zoo_base) не мешает
  { const A = await launch({ lang: 'ru', now: SUMMER, basemap: true, storage: { zoo_base_v2: 'sat' } });
    await A.app.basemapReady; await A.app.topViewReady; await A.wait(5);
    check('Т3a. Выбранный посетителем спутник запомнился', !A.app.map.hasLayer(A.app.topLayer) && A.$('[data-base="sat"]').getAttribute('aria-pressed') === 'true');
    A.close(); }
  { const A = await launch({ lang: 'ru', now: SUMMER, basemap: true, storage: { zoo_base: 'osm' } });
    await A.app.basemapReady; await A.app.topViewReady; await A.wait(5);
    check('Т3b. После обновления с 0.1.11 — «Вид сверху» по умолчанию', A.app.map.hasLayer(A.app.topLayer));
    A.close(); }

  // Т4. Полевой режим
  { const A = await launch({ lang: 'ru', now: SUMMER, basemap: true });
    await A.app.basemapReady; await A.app.topViewReady; await A.wait(5);
    const map = A.app.map, Ly = A.app.layers;
    await enterField(A);
    const btns = () => A.$$('#baseSwitch button').map(b => b.dataset.base);
    check('Т4a. Полевой режим: по умолчанию спутник, есть «Вид сверху»', !map.hasLayer(A.app.topLayer) && A.$('[data-base="sat"]').getAttribute('aria-pressed') === 'true' && btns().includes('top'), btns());
    A.click('[data-base="top"]'); await A.wait(5);
    check('Т4b. «Вид сверху» в полевом режиме: контур и все дорожки — для правки', map.hasLayer(A.app.topLayer) && map.hasLayer(Ly.boundary) && Ly.paths.getLayers().length === (D.paths || []).length);
    A.click('[data-f="exit"]'); await A.wait(5);
    check('Т4c. После выхода — у посетителя снова «Вид сверху» без контура', map.hasLayer(A.app.topLayer) && !map.hasLayer(Ly.boundary));
    check('Т4d. Без ошибок', A.errors.length === 0, A.errors);
    A.close(); }

  // Т5. Нет плиток — схема
  { const A = await launch({ lang: 'ru', now: SUMMER, basemap: true, patch: d => { d.settings.topView = 'map/top/none'; } });
    await A.app.basemapReady; const ok = await A.app.topViewReady; await A.wait(5);
    const log = JSON.parse(A.w.localStorage.getItem('zoo_errors') || '[]');
    check('Т5a. Нет index.json — без падения, запись в журнале', ok === false && A.errors.length === 0 && log.some(x => /topview/.test(x.m)), log);
    check('Т5b. У посетителя — схема, кнопки «Схема / Спутник»', A.app.map.hasLayer(A.app.layers.baseMain) && JSON.stringify(A.$$('#baseSwitch button').map(b => b.dataset.base)) === '["osm","sat"]');
    A.close(); }

  return done();
};
