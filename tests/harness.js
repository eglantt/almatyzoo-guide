/* Общий стенд для наборов: проверки, запуск настоящего index.html в jsdom с заглушками. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const util = require('util');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Набор проверок с итогом «N OK, M FAIL». */
function suite(name) {
  let ok = 0, fail = 0;
  const check = (title, cond, actual) => {
    if (cond) { ok++; }
    else { fail++; console.log(`  FAIL ${title}` + (actual !== undefined ? `\n       факт: ${typeof actual === 'string' ? actual : JSON.stringify(actual)}` : '')); }
  };
  const done = () => { console.log(`[${name}] ${ok} OK, ${fail} FAIL`); return { ok, fail }; };
  return { check, done };
}

/** Подставное время: «сейчас» = заданный момент, идёт вместе с реальным. */
function fakeDateClass(RealDate, startIso) {
  const offset = new RealDate(startIso).getTime() - RealDate.now();
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); }
    static now() { return RealDate.now() + offset; }
  }
  return FakeDate;
}

/**
 * Запуск приложения.
 * opts.lang — язык в хранилище (null — первый запуск)
 * opts.now — ISO-время «сейчас»
 * opts.gps — {lat,lng,acc} | 'deny' | не задан (в браузере нет геолокации)
 * opts.storage — дополнительные ключи localStorage
 * opts.deviceLang — язык устройства
 */
async function launch(opts = {}) {
  const html = read('index.html').replace(/<script src="[^"]+"><\/script>/g, '');
  const errors = [];
  const dom = new JSDOM(html, { url: 'https://zoo.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.addEventListener('error', e => errors.push(e.message));
  // Хранилище
  if (opts.lang) w.localStorage.setItem('zoo_lang', opts.lang);
  Object.entries(opts.storage || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));
  // Время
  if (opts.now) w.Date = fakeDateClass(w.Date, opts.now);
  // Язык устройства
  Object.defineProperty(w.navigator, 'languages', { value: [opts.deviceLang || 'ru-RU'], configurable: true });
  // Геолокация
  const geo = {
    getCurrentPosition(ok, err) {
      setTimeout(() => {
        if (opts.gps === 'deny') err({ code: 1 });
        else ok({ coords: { latitude: opts.gps.lat, longitude: opts.gps.lng, accuracy: opts.gps.acc || 10 } });
      }, 5);
    },
    watchPosition(ok) { const id = setInterval(() => { if (opts.gps && opts.gps !== 'deny') ok({ coords: { latitude: opts.gps.lat, longitude: opts.gps.lng, accuracy: 5 } }); }, 50); return id; },
    clearWatch(id) { clearInterval(id); }
  };
  Object.defineProperty(w.navigator, 'geolocation', { value: opts.gps == null ? undefined : geo, configurable: true });
  // fetch — настоящие файлы проекта
  w.fetch = async (url) => {
    const f = String(url).replace(/^https:\/\/zoo\.test\//, '');
    try { const body = read(f); return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) }; }
    catch (e) { return { ok: false, status: 404, text: async () => '', json: async () => { throw new Error('404'); } }; }
  };
  // Криптография и прочее, чего нет в jsdom
  Object.defineProperty(w, 'crypto', { value: require('crypto').webcrypto, configurable: true });
  w.TextEncoder = util.TextEncoder;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  // Leaflet определяет поддержку SVG по createSVGRect — в jsdom его нет
  w.SVGSVGElement.prototype.createSVGRect = () => ({});
  // Скрипты страницы
  w.eval(read('lib/leaflet.js'));
  w.eval(read('app.js'));
  try { await w.ZooApp.ready; } catch (e) { errors.push('init: ' + e.message); }
  await tick(w, 20);
  const $ = s => w.document.querySelector(s);
  const $$ = s => Array.from(w.document.querySelectorAll(s));
  const click = s => { const el = typeof s === 'string' ? $(s) : s; if (!el) throw new Error('нет элемента ' + s); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  return { dom, w, $, $$, click, errors, app: w.ZooApp, wait: ms => tick(w, ms), close: () => w.close() };
}
const tick = (w, ms) => new Promise(r => setTimeout(r, ms || 0));

module.exports = { suite, launch, read, ROOT };
