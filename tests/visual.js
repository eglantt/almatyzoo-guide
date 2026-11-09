/* Слой 2: настоящий Chromium (Playwright). Снимки 360 / 393 / ПК × kz / ru / en и проверка переполнения текста.
   Запуск: сервер в корне проекта (python3 -m http.server 8765), затем
   node visual.js <папка-для-снимков> [базовый URL]
   Часы зафиксированы (среда, лето, 12:00), геолокация задана, анимации выключены, тайлы карты не грузятся. */
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
    }
    // Шрифт Nunito реально применён (не системный)
    // Проверяется текст текущего языка: файлы алфавитов грузятся только по необходимости (unicode-range)
    const sample = { kz: 'Ережелер Құстар үйі', ru: 'Правила Карта', en: 'Rules Map' }[lang];
    const font = await page.evaluate(t => document.fonts.check('700 16px Nunito', t) && [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Nunito' && f.status === 'loaded'), sample);
    check(`[${w} ${lang}] шрифт Nunito загружен`, font);
    await ctx.close();
  }
  await browser.close();
  console.log(`[visual] ${ok} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
