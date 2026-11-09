/* Набор fonts: каждый символ приложения есть в файлах Nunito; внешних сервисов шрифтов нет.
   Чтение таблицы символов шрифта — через Python fontTools (pip install fonttools brotli). */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { suite, read, ROOT } = require('./harness');

/** Символы, которые реально видит пользователь: data.json, текст index.html, строки app.js (без комментариев). */
function usedChars() {
  const D = JSON.parse(read('data.json'));
  const strs = [];
  (function walk(o, key) {
    if (typeof o === 'string') { if (!/^(id|icon|cat|kind|zone|url|site|_)/.test(key || '')) strs.push(o); return; }
    if (Array.isArray(o)) return o.forEach(x => walk(x, key));
    if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => walk(v, k));
  })(D);
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
  const app = read('app.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const lits = [...app.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(m => m[2]);
  const set = new Set();
  [...strs, html, ...lits].join('').split('').forEach(c => { if (c.charCodeAt(0) > 32) set.add(c); });
  return set;
}

module.exports = async function () {
  const { check, done } = suite('fonts');
  const files = fs.readdirSync(path.join(ROOT, 'fonts')).filter(f => f.endsWith('.woff2'));
  check('F1. Шесть файлов Nunito (400/700 × latin/cyrillic/cyrillic-ext)', files.length === 6, files);
  let cover = {};
  try {
    const py = `import sys,json\nfrom fontTools.ttLib import TTFont\nr={}\nfor f in sys.argv[1:]:\n  r[f]=sorted(TTFont(f).getBestCmap().keys())\nprint(json.dumps(r))`;
    cover = JSON.parse(execFileSync('python3', ['-c', py, ...files.map(f => path.join(ROOT, 'fonts', f))], { encoding: 'utf8' }));
  } catch (e) {
    check('F2. Таблицы символов прочитаны (нужен Python + fontTools + brotli)', false, e.message.split('\n')[0]);
    return done();
  }
  for (const w of ['400', '700']) {
    const codes = new Set();
    Object.entries(cover).filter(([f]) => f.includes('-' + w + '-')).forEach(([, list]) => list.forEach(c => codes.add(c)));
    const missing = [...usedChars()].filter(c => !codes.has(c.codePointAt(0)));
    check(`F3. Все символы приложения есть в Nunito ${w}`, missing.length === 0, missing.map(c => c + ' U+' + c.codePointAt(0).toString(16).toUpperCase()).join(', '));
  }
  const kz = 'ӘәҒғҚқҢңӨөҰұҮүҺһІі';
  const all400 = new Set(Object.entries(cover).filter(([f]) => f.includes('-400-')).flatMap(([, l]) => l));
  check('F4. Все казахские буквы есть в шрифте', kz.split('').every(c => all400.has(c.codePointAt(0))));
  // Внешние сервисы шрифтов — нигде
  const srcs = ['index.html', 'styles.css', 'app.js', 'sw.js', 'manifest.json'].map(read).join('\n');
  check('F5. Нет ссылок на Google Fonts и другие внешние шрифты', !/fonts\.googleapis|fonts\.gstatic|use\.typekit|fonts\.bunny/.test(srcs));
  const css = read('styles.css');
  const faces = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map(m => m[0]);
  check('F6. У каждого @font-face — swap, unicode-range и относительный путь fonts/', faces.length === 6 && faces.every(f => /font-display:\s*swap/.test(f) && /unicode-range/.test(f) && /url\(fonts\//.test(f)), faces.length);
  check('F7. Файлы шрифтов в списке ASSET_FILES Service Worker', files.every(f => read('sw.js').includes(`./fonts/${f}`)));
  check('F8. Лицензия шрифта лежит рядом', fs.existsSync(path.join(ROOT, 'fonts', 'OFL.txt')));
  return done();
};
