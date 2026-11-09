/* Набор version: номер версии совпадает во всех местах (защита от забытой смены CACHE_VERSION). */
'use strict';
const { suite, read } = require('./harness');

module.exports = async function () {
  const { check, done } = suite('version');
  const app = (read('app.js').match(/const APP_VERSION = '([^']+)'/) || [])[1];
  const sw = (read('sw.js').match(/const CACHE_VERSION = '([^']+)'/) || [])[1];
  const data = JSON.parse(read('data.json')).meta.dataVersion;
  const log = read('CHANGELOG.md');
  check('V1. Версия найдена в app.js', !!app, app);
  check('V2. CACHE_VERSION в sw.js = APP_VERSION', sw === app, { app, sw });
  check('V3. Версия данных начинается с версии приложения', typeof data === 'string' && data.startsWith(app), { app, data });
  check('V4. Версия есть в CHANGELOG.md', log.includes(app), app);
  check('V5. Каркас SW включает все файлы, на которые ссылается index.html', (() => {
    const html = read('index.html'), swSrc = read('sw.js');
    const refs = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map(m => m[1]).filter(r => !r.startsWith('http'));
    return refs.every(r => swSrc.includes(`'./${r}'`));
  })(), [...read('index.html').matchAll(/(?:href|src)="([^"#:]+)"/g)].map(m => m[1]));
  check('V6. Номер версии виден в разделе «Ещё» (versionTag)', /id="versionTag"[^>]*>\$\{esc\(t\('version'\)\)\} \$\{APP_VERSION\}/.test(read('app.js')));
  return done();
};
