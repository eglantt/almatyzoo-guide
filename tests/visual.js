/* Слой 2: настоящий Chromium (Playwright). Снимки 360 / 393 / ПК × kz / ru / en и проверка переполнения текста.
   Запуск: сервер в корне проекта (python3 -m http.server 8765), затем
   node visual.js <папка-для-снимков> [базовый URL]
   Часы зафиксированы (среда, лето, 12:00), геолокация задана, анимации выключены, тайлы карты не грузятся (с 0.1.9 «Схема» — своя карта-подложка, видна на снимках). */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT = process.argv[2] || 'shots';
const BASE = process.argv[3] || 'http://localhost:8765/';
const WIDTHS = [[360, 740], [393, 800], [1280, 800]];
const LANGS = ['kz', 'ru', 'en'];
const SCREENS = ['map', 'coll', 'rules', 'more'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let fail = 0, ok = 0;
  const check = (title, cond, fact) => { if (cond) ok++; else { fail++; console.log('  FAIL ' + title + (fact ? '\n       факт: ' + JSON.stringify(fact) : '')); } };
  for (const [w, h] of WIDTHS) for (const lang of LANGS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, serviceWorkers: 'block',
      geolocation: { latitude: 43.2636, longitude: 76.9742 }, permissions: ['geolocation'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/tile\.openstreetmap|arcgisonline/, r => r.abort());
    await page.addInitScript(l => {
      try { localStorage.setItem('zoo_lang', l); localStorage.setItem('zoo_dev_now', '2026-07-08T12:00'); } catch (e) { /* */ }
    }, lang);
    await page.goto(BASE + 'index.html');
    await page.waitForFunction(() => window.ZooApp && window.ZooApp.data);
    const baseOk = await page.evaluate(() => window.ZooApp.basemapReady);          // 0.1.9: своя карта-подложка
    check(`[${w} ${lang}] карта-подложка загружена`, baseOk === true, baseOk);
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    await page.evaluate(() => document.fonts.ready);
    check(`[${w} ${lang}] без ошибок`, errors.length === 0, errors);
    for (const s of SCREENS) {
      await page.click(`[data-tab="${s}"]`);
      await page.waitForTimeout(300);
      const file = path.join(OUT, `${w}-${lang}-${s}.png`);
      await page.screenshot({ path: file });
      // Переполнение: страница не скроллится вбок; подписи меню, фильтров и кнопок не обрезаны
      const r = await page.evaluate(() => {
        const cut = [];
        document.querySelectorAll('.tabbar button span, .mapfilters button, .near__btn span, .langsw button, .btn span, .btn, .coll__txt b, .rule span')
          .forEach(el => { if (el.offsetParent && el.scrollWidth > el.clientWidth + 1) cut.push(el.textContent.trim()); });
        return { overflow: document.documentElement.scrollWidth - innerWidth, cut };
      });
      check(`[${w} ${lang} ${s}] нет горизонтальной прокрутки`, r.overflow <= 0, r.overflow);
      check(`[${w} ${lang} ${s}] подписи не обрезаны`, r.cut.length === 0, r.cut);
      // Низ экрана виден над нижним меню после прокрутки до конца (ошибка 0.1.0: номер версии под меню)
      if (s !== 'map') {
        const b = await page.evaluate(scr => {
          window.scrollTo(0, 1e7);
          const pad = document.querySelector(`[data-screen="${scr}"] .pad`);
          const last = pad && pad.lastElementChild;
          const lr = last.getBoundingClientRect(), tb = document.querySelector('.tabbar').getBoundingClientRect();
          return { lastBottom: Math.round(lr.bottom), tabTop: Math.round(tb.top), what: last.id || last.className };
        }, s);
        await page.screenshot({ path: path.join(OUT, `${w}-${lang}-${s}-end.png`) });
        check(`[${w} ${lang} ${s}] последний элемент (${b.what}) виден над нижним меню`, b.lastBottom <= b.tabTop, b);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
    // 0.1.5: карточка самого северного места не уходит под фильтры (карта сдвигается с запасом)
    await page.click('[data-tab="map"]'); await page.waitForTimeout(200);
    await page.evaluate(() => { const ms = Object.values(ZooApp.markers); ms.sort((a, b) => b.getLatLng().lat - a.getLatLng().lat); ms[0].openPopup(); });
    await page.waitForTimeout(500);
    const pp = await page.evaluate(() => { const a = document.querySelector('.leaflet-popup').getBoundingClientRect(), f = document.querySelector('#mapFilters').getBoundingClientRect(); return { popTop: Math.round(a.top), filtersBottom: Math.round(f.bottom) }; });
    check(`[${w} ${lang}] карточка места не под фильтрами`, pp.popTop >= pp.filtersBottom, pp);
    await page.evaluate(() => ZooApp.map.closePopup());
    // 0.1.4: «Путь через парк» — оба входа видны на карте над карточкой
    await page.click('[data-tab="more"]');
    await page.evaluate(() => { const b = document.querySelector('[data-act="parkRoute"]'); if (b) b.closest('details').open = true; });
    await page.click('[data-act="parkRoute"]'); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${w}-${lang}-park.png`) });
    const pr = await page.evaluate(() => {
      const m = ZooApp.map, mr = m.getContainer().getBoundingClientRect(), sh = document.querySelector('#sheet').getBoundingClientRect();
      const pts = [ZooApp.data.parkRoute.from, ZooApp.data.meta.entrance].map(q => m.latLngToContainerPoint(q));
      return { ok: pts.every(p => p.y + mr.top < sh.top && p.y > 0 && p.x > 0 && p.x < mr.width), ys: pts.map(p => Math.round(p.y + mr.top)), sheetTop: Math.round(sh.top) };
    });
    check(`[${w} ${lang}] путь через парк: вход в парк и вход в зоопарк видны над карточкой`, pr.ok, pr);
    await page.click('#sheetClose');
    // Шрифт Nunito реально применён (не системный)
    // Проверяется текст текущего языка: файлы алфавитов грузятся только по необходимости (unicode-range)
    const sample = { kz: 'Ережелер Құстар үйі', ru: 'Правила Карта', en: 'Rules Map' }[lang];
    const font = await page.evaluate(t => document.fonts.check('700 16px Nunito', t) && [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Nunito' && f.status === 'loaded'), sample);
    check(`[${w} ${lang}] шрифт Nunito загружен`, font);
    await ctx.close();
  }
  // 0.1.13: подпись карты — отдельной полосой; не заходит на «Найти рядом», «Где я?», переключатель подложки
  // (замечание заказчика: Mi A1, спутник — длинная подпись Esri в две строки). Размеры: 360, 393, Mi A1 (412 × 732); шрифт 100 и 130 %.
  for (const [w, h] of [[360, 740], [393, 800], [412, 732]]) for (const base of ['top', 'sat']) for (const fs of [100, 130]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route(/tile\.openstreetmap|arcgisonline/, r => r.abort());
    await page.addInitScript(bs => { try { localStorage.setItem('zoo_lang', 'ru'); localStorage.setItem('zoo_dev_now', '2026-07-08T12:00'); localStorage.setItem('zoo_base_v2', bs); } catch (e) { /* */ } }, base);
    await page.goto(BASE + 'index.html');
    await page.waitForFunction(() => window.ZooApp && window.ZooApp.data);
    await page.evaluate(() => window.ZooApp.topViewReady);
    await page.addStyleTag({ content: `html{font-size:${fs}%}` });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const a = document.querySelector('.leaflet-control-attribution').getBoundingClientRect(), hit = [];
      ['#btnNear', '.mapside', '#baseSwitch'].forEach(s => { const e = document.querySelector(s); if (!e || !e.offsetParent) return; const q = e.getBoundingClientRect();
        if (q.bottom > a.top + 0.5 && q.right > a.left && q.left < a.right) hit.push(s); });
      const t = document.querySelector('.tabbar').getBoundingClientRect();
      return { hit, strip: Math.round(a.height), belowTabTop: Math.round(a.bottom - t.top) };
    });
    check(`[${w} ${base} ${fs}%] подпись карты не заходит на кнопки`, r.hit.length === 0, r);
    check(`[${w} ${base} ${fs}%] подпись карты над нижним меню`, r.belowTabTop <= 2, r);
    if (base === 'sat' && fs === 130) await page.screenshot({ path: path.join(OUT, `${w}-attr-sat-130.png`) });
    await ctx.close();
  }
  // 0.1.15: кроны у ограды не обрезаются краем «Вида сверху». Деревья чертежа, стоящие за оградой на 0,5–4 м, —
  // в центре кроны плитка масштаба 20 непрозрачна (альфа > 200). На 0.1.13–0.1.14 там прозрачно (край по ограде).
  { const ctx = await browser.newContext({ serviceWorkers: 'block' }); const page = await ctx.newPage();
    await page.goto(BASE + 'manifest.json');
    const r = await page.evaluate(async () => {
      const D = await (await fetch('data.json')).json(), S = await (await fetch('tools/topview/src/topview-src.json')).json();
      const dir = D.settings.topView, ix = await (await fetch(dir + '/index.json')).json(), have = new Set(ix.tiles);
      const [lat0, lng0] = S.center, KX = 111320 * Math.cos(lat0 * Math.PI / 180), KY = 111320, B = S.zooBoundary;
      const inPoly = (x, y) => { let c = false; for (let i = 0, j = B.length - 1; i < B.length; j = i++) { const [xi, yi] = B[i], [xj, yj] = B[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
      const dEdge = (x, y) => Math.min(...B.map((p, i) => { const q = B[(i + 1) % B.length], dx = q[0] - p[0], dy = q[1] - p[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / L)); return Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy); }));
      const pts = S.trees.filter(([x, y]) => !inPoly(x, y) && dEdge(x, y) >= 0.5 && dEdge(x, y) <= 4);
      const Z = 20, N = 256 * 2 ** Z, cache = {}; let opaque = 0, n = 0;
      for (const [x, y] of pts) {
        const lat = lat0 + y / KY, lng = lng0 + x / KX, s = Math.sin(lat * Math.PI / 180);
        const px = (lng + 180) / 360 * N, py = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * N;
        const key = `${Z}/${Math.floor(px / 256)}/${Math.floor(py / 256)}`; n++;
        if (!have.has(key)) continue;
        if (!cache[key]) { const img = new Image(); img.src = `${dir}/${key}.webp`; await img.decode(); const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.drawImage(img, 0, 0); cache[key] = g.getImageData(0, 0, 256, 256).data; }
        const a = cache[key][((Math.floor(py) % 256) * 256 + (Math.floor(px) % 256)) * 4 + 3];
        if (a > 200) opaque++;
      }
      return { n, opaque };
    });
    check('[вид сверху] кроны деревьев сразу за оградой видны целиком (≥ 95 %)', r.n > 50 && r.opaque >= 0.95 * r.n, r);
    await ctx.close(); }
  await browser.close();
  console.log(`[visual] ${ok} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
