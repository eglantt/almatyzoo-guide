/* Запуск всех наборов по очереди (не параллельно — часть проверок завязана на время).
   node run.js            — все наборы
   node run.js sw app     — только указанные */
'use strict';
const ORDER = ['data', 'version', 'fonts', 'app', 'schedule', 'geo', 'panel', 'field', 'places', 'sw'];

(async () => {
  const pick = process.argv.slice(2);
  const list = pick.length ? ORDER.filter(n => pick.includes(n)) : ORDER;
  let ok = 0, fail = 0;
  for (const name of list) {
    const t0 = Date.now();
    try {
      const r = await require(`./${name}.test.js`)();
      ok += r.ok; fail += r.fail;
    } catch (e) {
      fail++; console.log(`[${name}] ОШИБКА НАБОРА: ${e.stack}`);
    }
    console.log(`        ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  }
  console.log(`\nИТОГО: ${ok} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
