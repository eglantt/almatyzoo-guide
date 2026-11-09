# Технологии из проекта SLDT (PWA на GitHub Pages): обновление без ожидания и ключ к служебной панели

Описание сверено с кодом SLDT версии 7.4.5. Обе технологии проверены в работе на телефонах и покрыты тестами.

**Два уточнения до начала:**
- **«Безусловно» обновляется только при наличии сети.** Офлайн, а также при ответе сервера дольше 3,5 с открывается прежняя версия из кэша, а новая подхватится при следующем открытии.
- **Ключ к панели — это «замок от случайного входа», а не защита.** Хэш не даёт прочитать ключ в коде, но всю проверку можно обойти из консоли браузера одной строкой. Подробности — в разделе 2.

---

## 1. Обновление приложения при открытии

### Почему обычная PWA «застревает» на старой версии
1. **Браузер сам кэширует `sw.js`.** GitHub Pages отдаёт файлы с `Cache-Control: max-age=600`. Браузер до 10 минут берёт старый `sw.js` и не видит, что вышла новая версия.
2. **Страница отдаётся «сначала из кэша».** Новый код не запускается, пока не установится новый воркер, а он может ждать закрытия всех вкладок.
3. **Установка тяжёлая и «всё или ничего».** `cache.addAll()` на ~90 файлов (14 МБ): одна недоступная иконка или закрытое на середине приложение отменяют установку целиком. Телефон остаётся на старой версии.

В SLDT было всё это. Пункт 1 исправлен в 6.5.29, пункты 2 и 3 — в 6.5.32.

### Как устроено сейчас

#### А. Регистрация воркера на странице (в конце основного скрипта)
```js
let swRegistration = null;
if ('serviceWorker' in navigator) {
  // Замер ДО регистрации: был ли у страницы воркер. Без него первая установка
  // тоже вызвала бы перезагрузку.
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return;   // защита от бесконечной перезагрузки
    refreshing = true;
    location.reload();                          // одна перезагрузка на новую версию
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })  // sw.js мимо HTTP-кэша
      .then(reg => { swRegistration = reg; reg.update(); })               // проверить сразу
      .catch(() => {});
  });
}
// Возврат в приложение (вкладка, экран телефона) — ещё одна проверка обновления.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && swRegistration) swRegistration.update();
});
```

#### Б. Два кэша в `sw.js`
```js
const CACHE_VERSION  = 'v1-0-0';   // менять на КАЖДОМ релизе
const ASSETS_VERSION = 'v1';       // менять только при замене содержимого картинок/шрифтов
const APP_CACHE    = `app-${CACHE_VERSION}`;
const ASSETS_CACHE = `assets-${ASSETS_VERSION}`;
const NAV_TIMEOUT_MS = 3500;

// Каркас: маленький и обязательный.
const CORE_FILES = [
  './', './index.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-192.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png', './icons/favicon-16.png'
];
// Тяжёлое: докачивается в фоне.
const ASSET_FILES = [ /* './icons/items/....png', './fonts/....woff2', ... */ ];

function isAssetPath(p) { return p.includes('/icons/items/') || p.includes('/fonts/'); }
function isCacheable(r) { return r && r.ok; }
```
- `APP_CACHE` — каркас (~10 маленьких файлов). Смена `CACHE_VERSION` делает `sw.js` побайтно другим, и браузер видит новую версию.
- `ASSETS_CACHE` — картинки и шрифты. Обычное обновление его не трогает, поэтому 14 МБ заново не качаются.

#### В. Установка и активация — короткие и без ожидания
```js
self.addEventListener('install', e => e.waitUntil(
  caches.open(APP_CACHE)
    .then(c => c.addAll(CORE_FILES.map(u => new Request(u, { cache: 'reload' }))))  // мимо HTTP-кэша
    .then(() => self.skipWaiting())          // не ждать закрытия вкладок
));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys
      .filter(k => k !== APP_CACHE && k !== ASSETS_CACHE)
      .map(k => caches.delete(k))))
    .then(() => self.clients.claim())        // сразу взять открытые страницы → controllerchange → reload
));
```
`cache: 'reload'` нужен, чтобы в новый кэш не легла 10-минутная копия прошлой версии с GitHub Pages.

#### Г. Страница — «сначала сеть» с таймаутом, остальное — «сначала кэш»
```js
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (err) { return Response.error(); }
}

function handleNavigation(event) {
  const network = fetch(event.request, { cache: 'no-cache' })   // свежесть проверяется у сервера (ETag)
    .then(async r => {
      if (isCacheable(r)) (await caches.open(APP_CACHE)).put('./index.html', r.clone());
      return r;
    });
  event.waitUntil(network.catch(() => {}));   // запоздавший ответ тоже ляжет в кэш — к следующему открытию
  event.respondWith((async () => {
    let net = null;
    try {
      net = await Promise.race([network, new Promise(res => setTimeout(() => res(null), NAV_TIMEOUT_MS))]);
      if (net && net.ok) return net;
    } catch (e) {}
    const cache = await caches.open(APP_CACHE);
    const cached = (await cache.match(event.request, { ignoreSearch: true })) ||
                   (await cache.match('./index.html')) || (await cache.match('./'));
    if (cached) return cached;
    if (net) return net;
    try { return await network; } catch (e) { return Response.error(); }
  })());
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') { handleNavigation(event); event.waitUntil(prefetchAssetsOnce()); return; }
  event.respondWith(cacheFirst(req, isAssetPath(url.pathname) ? ASSETS_CACHE : APP_CACHE));
});
```

#### Д. Фоновая докачка картинок
```js
let assetsPrefetchStarted = false;
function prefetchAssetsOnce() {
  if (assetsPrefetchStarted) return Promise.resolve();
  assetsPrefetchStarted = true;
  return (async () => {
    const cache = await caches.open(ASSETS_CACHE);
    for (const url of ASSET_FILES) {
      try {
        if (await cache.match(url)) continue;
        const response = await fetch(url);
        if (isCacheable(response)) await cache.put(url, response);
      } catch (err) {}
    }
  })();
}
```
Один раз за жизнь воркера, по одному файлу, уже скачанные пропускаются, ошибка одного файла глотается. Запускать её **из навигации, а не из `activate`**. Иначе перезагруженная после обновления страница ждала бы, пока скачаются все картинки. Файл, забытый в списке, всё равно попадёт в кэш при первом показе (через `cacheFirst`).

### Что видит пользователь
1. Открыл приложение в сети — сразу получает свежую `index.html` (если сервер ответил быстрее 3,5 с).
2. Параллельно `reg.update()` находит новый `sw.js`, установка каркаса занимает секунды, `skipWaiting` → `clients.claim` → одна автоматическая перезагрузка. После неё работает уже новый воркер.
3. Без сети или при ответе дольше 3,5 с — прежняя версия из кэша. Свежая сохранится и откроется в следующий раз.
4. Первая установка (воркера ещё не было) проходит без перезагрузки — за это отвечает `hadController`.

### Обязательные правила при каждом релизе
- Менять `CACHE_VERSION` в `sw.js` вместе с версией приложения. Без этого телефоны новую версию не заметят.
- `ASSETS_VERSION` менять только при замене содержимого существующих картинок или шрифтов. Новые файлы — просто дописывать в `ASSET_FILES`.
- В `CORE_FILES` не класть картинки и прочее тяжёлое: установка должна оставаться короткой. Если файл каркаса недоступен, установка отменяется, старый воркер работает дальше, повтор будет при следующей проверке. Это правильно.
- Пути относительные (`./…`): сайт на GitHub Pages живёт в подпапке репозитория.
- Номер версии видимо показывать в интерфейсе. Так на телефоне сразу видно, что открылась новая.
- После пуша на GitHub Pages сайт обновляется не мгновенно, обычно в пределах минуты-двух.

### Как проверять
В SLDT есть стенд `tests/sw.test.js`: `sw.js` запускается в песочнице Node (`vm`) с поддельными `caches`, `fetch` и `self`, с задержками, 404 и офлайном. 16 сценариев:
- установка только каркаса, а 404 одной иконки её не ломает;
- `skipWaiting` и `claim`, удаление старых кэшей, сохранение кэша картинок;
- страница из сети, из кэша при офлайне и при таймауте, запоздавший ответ ложится в кэш;
- докачка один раз, по одному файлу.

Стенд можно взять за образец.

---

## 2. Ключ к служебной панели

### Вход: 7 нажатий по номеру версии за 2 секунды
Обработчик повешен на постоянного родителя, потому что сам номер перерисовывается вместе с окном:
```js
let pulses = [];
function onVersionPulse() {
  const now = Date.now();
  pulses = pulses.filter(t => now - t <= 2000); pulses.push(now);
  if (pulses.length >= 7) { pulses = []; openAuth(); }
}
document.getElementById('stableParent').addEventListener('click', e => {
  if (e.target && e.target.id === 'versionTag') onVersionPulse();
});
```

### Окно ввода
```html
<div class="overlay" id="authOverlay" style="z-index:1600;">   <!-- поверх всех окон -->
  <div class="window">
    <div class="header">АВТОРИЗАЦИЯ</div>
    <div class="body">
      <input type="password" id="authInput" placeholder="Ключ" autocomplete="off">
      <button onclick="cancelAuth()">Отмена</button>
      <button onclick="confirmAuth()">Подтвердить</button>
    </div>
  </div>
</div>
```
- Enter = «Подтвердить».
- Тап по фону окно **не** закрывает — случайное касание не стирает ввод. Закрытие — только «Отмена» или верный ключ.
- Ошибка — окно остаётся открытым, поле очищается и снова в фокусе, сообщение «Ключ не принят» не пишется в журнал.

### Проверка: в коде лежат только соль и хэш
```js
const SALT = 'ПРОЕКТ:ARCH:2026';          // своя строка для проекта
const KEY_HASH = '…64 hex-символа…';      // SHA-256(SALT + ключ)

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function openAuth() {
  const overlay = document.getElementById('authOverlay');
  overlay.style.display = 'flex';
  document.getElementById('authInput').focus();
}
function cancelAuth() {
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('authInput').value = '';
}

let authorized = false;
async function confirmAuth() {
  const input = document.getElementById('authInput');
  const hash = await sha256Hex(SALT + input.value.trim());
  if (hash === KEY_HASH) {
    authorized = true;
    document.getElementById('authOverlay').style.display = 'none';
    input.value = '';
    openPanel();
  } else {
    input.value = ''; input.focus();
    showNotice('Ключ не принят.', 'danger', /* не в журнал */ true);
  }
}
document.getElementById('authInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmAuth();
});

function openPanel() {
  if (!authorized) return;     // без этой строки панель открывалась бы прямым вызовом из консоли
  /* … заполнить и показать панель … */
}
```

### Как получить хэш для своего ключа
Один раз, ключ никуда в проект не записывать:
```
node -e "console.log(require('crypto').createHash('sha256').update('ПРОЕКТ:ARCH:2026' + 'ваш_ключ').digest('hex'))"
```
Или в консоли браузера:
```js
crypto.subtle.digest('SHA-256', new TextEncoder().encode('ПРОЕКТ:ARCH:2026' + 'ваш_ключ'))
  .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')));
```
В SLDT сверено: Node и браузер дают одинаковый хэш. Сменить ключ = пересчитать хэш и заменить одну константу `KEY_HASH`.

- `crypto.subtle` работает только на `https` и `localhost`. GitHub Pages это `https`, так что подходит.
- Все блоки панели в коде (HTML, CSS, JS) отмечены одним маркером (в SLDT это `SL:SYS-TOOLS:START/END`), чтобы их можно было найти или вырезать.

### Честно о границах этой защиты
- Это **замок от случайного входа и от чтения ключа в исходниках**, а не настоящая защита. Весь код открыт в браузере: можно выполнить `authorized = true; openPanel()` в консоли или поправить код. Тесты SLDT именно так и открывают панель. Данные в `localStorage` тоже можно менять руками. Без сервера иначе нельзя — это ограничение любого чисто клиентского приложения.
- Подбор: соль и хэш лежат в открытом коде, а SHA-256 считается очень быстро. Короткий или словарный ключ подбирается перебором на компьютере. Длинный случайный ключ — 16+ символов или 4–5 случайных слов — перебором не найти.

### Если в новом проекте нужна защита посерьёзнее
1. Брать длинный случайный ключ.
2. Вместо одного SHA-256 использовать PBKDF2 из того же `crypto.subtle` — каждая попытка перебора станет в сотни тысяч раз дороже:
   ```js
   async function pbkdf2Hex(key, salt, iterations = 200000) {
     const enc = new TextEncoder();
     const base = await crypto.subtle.importKey('raw', enc.encode(key), 'PBKDF2', false, ['deriveBits']);
     const bits = await crypto.subtle.deriveBits(
       { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, base, 256);
     return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
   }
   ```
   Хэш для константы считается той же функцией (в консоли браузера) или в Node: `crypto.pbkdf2Sync(key, salt, 200000, 32, 'sha256').toString('hex')`.
3. Держать флаг `authorized` внутри замыкания или модуля, а не глобальной переменной — тогда одной строкой из консоли его не включить (но правка кода всё равно возможна).
4. Помнить: от обхода через консоль и правку кода защищает только проверка на сервере.
