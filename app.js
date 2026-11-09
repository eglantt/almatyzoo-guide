/* =====================================================================
   Путеводитель по Алматинскому зоопарку — app.js
   Чистый JS без фреймворков. Разделы:
     1. Константы и хранилище
     2. Данные, язык, тексты
     3. Время: сезоны, часы, санитарные дни
     4. География: расстояния, направление, «внутри зоопарка»
     5. Пиктограммы и маркеры
     6. Карта (Leaflet)
     7. «Где я?», «Найти рядом», «К выходу»
     8. Поиск
     9. Коллекция
    10. Правила
    11. Раздел «Ещё»
    12. Навигация, язык, шапка
    13. Service Worker и автообновление
    14. Сервисная панель и полевой режим (ZOO:SYS-TOOLS)
    15. Запуск
   ===================================================================== */
(function () {
  'use strict';

  /* ===================== 1. Константы и хранилище ===================== */
  const APP_VERSION = '0.1.2-alpha';
  const KEY = {
    lang: 'zoo_lang',
    devNow: 'zoo_dev_now',       // подмена даты (сервисная панель)
    devGps: 'zoo_dev_gps',       // подмена местоположения
    approx: 'zoo_dev_approx',    // подсветка ориентировочных координат
    field: 'zoo_field',          // данные полевого режима
    errors: 'zoo_errors',        // журнал ошибок
    bannerClosed: 'zoo_banner_closed'   // плашка закрыта посетителем — до конца этого дня
  };
  const WALK_M_PER_MIN = 75;     // ~4,5 км/ч
  const TAP_COUNT = 7, TAP_WINDOW_MS = 3000;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } },
    json(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    setJson(k, v) { this.set(k, JSON.stringify(v)); }
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ===================== 2. Данные, язык, тексты ===================== */
  let D = null;                       // содержимое data.json
  const S = {                         // состояние
    lang: 'ru', tab: 'map', filter: 'all',
    user: null,                       // {lat, lng, acc}
    nearOpen: false,
    deferredInstall: null
  };
  const LANGS = ['kz', 'ru', 'en'];

  /** Текст объекта {kz, ru, en} на текущем языке (запасной — ru). */
  function L(obj) {
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    return obj[S.lang] || obj.ru || obj.en || '';
  }
  /** Строка интерфейса по ключу. */
  function t(key, vars) {
    let s = L(D.ui[key]) || key;
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }
  function deviceLang() {
    const l = ((navigator.languages && navigator.languages[0]) || navigator.language || 'ru').toLowerCase();
    if (l.startsWith('kk') || l.startsWith('kz')) return 'kz';
    if (l.startsWith('ru')) return 'ru';
    if (l.startsWith('en')) return 'en';
    return 'ru';
  }
  /** Нормализация для поиска: регистр, ё/е, казахские буквы → близкие русские. */
  function norm(s) {
    const map = { 'ё': 'е', 'і': 'и', 'ү': 'у', 'ұ': 'у', 'ә': 'а', 'ө': 'о', 'қ': 'к', 'ғ': 'г', 'ң': 'н', 'һ': 'х', 'й': 'и' };
    return String(s || '').toLowerCase().replace(/[ёіүұәөқғңһй]/g, c => map[c]).replace(/\s+/g, ' ').trim();
  }

  /* ===================== 3. Время ===================== */
  /** «Сейчас» — с учётом подмены даты из сервисной панели. */
  function now() {
    const o = store.get(KEY.devNow);
    if (o) { const d = new Date(o); if (!isNaN(d)) return d; }
    return new Date();
  }
  const mmdd = d => String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

  function season(d) {
    const s = D.settings.seasons.summer, x = mmdd(d);
    return (x >= s.from && x <= s.to) ? 'summer' : 'winter';
  }
  function zooHours(d) { return D.settings.hours[season(d)]; }
  /** Номер дня недели: 1 — понедельник … 7 — воскресенье. */
  const isoDay = d => (d.getDay() + 6) % 7 + 1;
  function isSanitary(place, d) { return !!place.sanitaryDay && place.sanitaryDay === isoDay(d); }
  function placeHours(place, d) { return place.hours || zooHours(d).zoo; }
  function isOpen(range, d) { const x = hhmm(d); return x >= range[0] && x < range[1]; }
  function placeStatus(place, d) {
    if (isSanitary(place, d)) return 'sanitary';
    return isOpen(placeHours(place, d), d) ? 'open' : 'closed';
  }

  /* ===================== 4. География ===================== */
  const R_EARTH = 6371000;
  const rad = x => x * Math.PI / 180;
  function dist(a, b) {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function dirName(deg) { return t('dir' + Math.round(deg / 45) % 8); }
  function inPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][1], yi = poly[i][0], xj = poly[j][1], yj = poly[j][0];
      if (((yi > p.lat) !== (yj > p.lat)) && (p.lng < (xj - xi) * (p.lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  const insideZoo = p => inPolygon(p, D.meta.boundary);
  function fmtDist(m) {
    if (m < 1000) return t('meters', { n: Math.max(10, Math.round(m / 10) * 10) });
    return t('km', { n: (m / 1000).toFixed(1).replace('.', S.lang === 'en' ? '.' : ',') });
  }
  const walkMin = m => Math.max(1, Math.round(m / WALK_M_PER_MIN));
  const placeLatLng = p => ({ lat: p.lat, lng: p.lng });

  /* ===================== 5. Пиктограммы и маркеры ===================== */
  const COLORS = { animal: '#4E8C12', infra: '#2E5A0A', food: '#C4920A' };
  function iconColor(place) { return place.cat === 'food' ? COLORS.food : (place.kind === 'animal' ? COLORS.animal : COLORS.infra); }
  function isPlaceholder(iconId) { return !!(D.icons[iconId] && D.icons[iconId].placeholder); }
  /** Маркер стиля А: цветной круг, белая обводка, белая пиктограмма; тонкое пурпурное кольцо у заглушек. */
  function markerSvg(iconId, color) {
    const ring = isPlaceholder(iconId) ? '<circle class="ph-ring" cx="22" cy="22" r="20.6" fill="none" stroke="#FF00FF" stroke-width="1.2"/>' : '';
    return `<svg viewBox="0 0 44 44" style="--mk:${color}" aria-hidden="true">${ring}` +
      `<circle cx="22" cy="22" r="17" fill="${color}" stroke="#fff" stroke-width="3"/>` +
      `<svg x="11" y="11" width="22" height="22" color="#fff"><use href="#${iconId}"/></svg></svg>`;
  }
  /** Знак правила: красный круг с чертой (или зелёный без черты). */
  function ruleSvg(iconId, ok) {
    const col = ok ? '#4E8C12' : '#D32F2F';
    const ring = isPlaceholder(iconId) ? '<circle cx="20" cy="20" r="19.4" fill="none" stroke="#FF00FF" stroke-width="1"/>' : '';
    const slash = ok ? '' : `<path d="M7.6 7.6 32.4 32.4" stroke="${col}" stroke-width="3.2" stroke-linecap="round"/>`;
    return `<svg viewBox="0 0 40 40" aria-hidden="true">${ring}<circle cx="20" cy="20" r="16.8" fill="#fff" stroke="${col}" stroke-width="3.2"/>` +
      `<svg x="10.5" y="10.5" width="19" height="19" color="#1A1A1A"><use href="#${iconId}"/></svg>${slash}</svg>`;
  }
  const uiIcon = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

  /* ===================== 6. Карта ===================== */
  let map = null, layers = {}, markers = {}, userMarker = null, userCircle = null, exitLine = null;
  let osm = null, sat = null;

  function initMap() {
    if (map || typeof L_ === 'undefined') return;
    const b = D.meta.bounds;
    map = L_.map('map', {
      zoomControl: false, minZoom: 16, maxZoom: 19,
      maxBounds: L_.latLngBounds(b[0], b[1]), maxBoundsViscosity: 1.0,
      attributionControl: true
    });
    osm = L_.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, crossOrigin: 'anonymous',
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    sat = L_.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, crossOrigin: 'anonymous', attribution: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics'
    });
    L_.control.zoom({ position: 'topright' }).addTo(map);
    map.attributionControl.setPrefix(false);

    L_.polygon(D.meta.boundary, { color: '#4E8C12', weight: 3, dashArray: '8 6', fillColor: '#95C12B', fillOpacity: 0.08, interactive: false }).addTo(map);
    layers.areas = L_.layerGroup().addTo(map);
    layers.animal = L_.layerGroup().addTo(map);
    layers.infra = L_.layerGroup().addTo(map);
    layers.route = L_.layerGroup().addTo(map);
    layers.field = L_.layerGroup().addTo(map);

    fitZoo();
    map.on('zoomend', updateZoomClass);
    map.on('moveend', updateToZoo);
    map.on('click', onMapClick);
    buildMarkers();
    updateZoomClass();
    applyApproxView();
  }
  function fitZoo() {
    const el = map.getContainer();
    if (el.clientWidth > 0 && el.clientHeight > 0) map.fitBounds(D.meta.boundary, { padding: [16, 16] });
    else map.setView(D.meta.center, 17);
  }
  function updateZoomClass() {
    const z = map.getZoom(), el = map.getContainer();
    el.classList.toggle('z-low', z < 17);
    el.classList.toggle('z-mid', z < 18);
  }
  function updateToZoo() {
    const c = map.getCenter();
    $('#btnToZoo').hidden = insideZoo({ lat: c.lat, lng: c.lng });
  }
  /** Маркеры и контуры всех мест. Перестраиваются при смене языка. */
  function buildMarkers() {
    if (!map) return;
    layers.areas.clearLayers(); layers.animal.clearLayers(); layers.infra.clearLayers(); markers = {};
    D.places.forEach(p => {
      if (p.area) L_.polygon(p.area, { color: iconColor(p), weight: 1.5, fillOpacity: 0.12, interactive: false }).addTo(layers.areas);
      const cls = ['zmk', 'k-' + p.kind, p.major ? 'major' : 'minor', p.approx ? 'approx' : ''].join(' ');
      const m = L_.marker([p.lat, p.lng], {
        icon: L_.divIcon({ className: cls, html: markerSvg(p.icon, iconColor(p)), iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -18] }),
        title: L(p.title), keyboard: true, riseOnHover: true
      });
      m.bindPopup(() => popupHtml(p), { maxWidth: 280, minWidth: 220, className: 'zpop' });
      if (p.major) m.bindTooltip(esc(L(p.title)), { permanent: true, direction: 'bottom', offset: [0, 16], className: 'zlbl' });
      m.on('dragend', () => Field.onMarkerDrag(p.id, m.getLatLng()));
      m.addTo(p.kind === 'animal' ? layers.animal : layers.infra);
      markers[p.id] = m;
    });
    applyFilter();
    if (Field.isActive()) Field.applyMarkers();
  }
  function applyFilter() {
    if (!map) return;
    const show = { animal: S.filter !== 'infra', infra: S.filter !== 'animal' };
    ['animal', 'infra'].forEach(k => { if (show[k]) layers[k].addTo(map); else map.removeLayer(layers[k]); });
    $$('#mapFilters button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === S.filter)));
  }
  function popupHtml(p) {
    const d = now(), st = placeStatus(p, d), h = placeHours(p, d);
    let status = '';
    if (st === 'sanitary') status = `<div class="pp__st pp__st--closed">${esc(t('todayClosed'))} · ${esc(t('sanitaryDay'))}</div>`;
    else if (p.kind !== 'outside') status = `<div class="pp__st ${st === 'open' ? 'pp__st--open' : 'pp__st--closed'}">${esc(t(st === 'open' ? 'openNow' : 'closedNow'))} · ${h[0]}–${h[1]}</div>`;
    const san = p.sanitaryDay && st !== 'sanitary' ? `<div class="pp__note">${esc(t('sanitaryEvery', { day: weekday(p.sanitaryDay) }))}</div>` : '';
    const note = p.note ? `<div class="pp__note pp__note--warn">${esc(L(p.note))}</div>` : '';
    let distLine = '';
    if (S.user) { const m = dist(S.user, placeLatLng(p)); distLine = `<div class="pp__dist">${esc(fmtDist(m))} · ${esc(t('minWalk', { n: walkMin(m) }))}</div>`; }
    const coll = (p.kind === 'animal') ? `<button type="button" class="btn btn--sm" data-act="toColl" data-id="${p.id}">${esc(t('toCollection'))}</button>` : '';
    return `<div class="pp"><div class="pp__t">${esc(L(p.title))}</div>` +
      (p.desc ? `<div class="pp__d">${esc(L(p.desc))}</div>` : '') + status + san + note + distLine +
      (coll ? `<div class="pp__act">${coll}</div>` : '') + '</div>';
  }
  const weekday = n => L(D.ui.weekdays)[n - 1] || L(D.ui.weekdays)[n - 1];
  /** Показать место на карте: вкладка «Карта», центр, попап, пульсация маркера. */
  function focusPlace(id) {
    showTab('map');
    const p = D.places.find(x => x.id === id), m = markers[id];
    if (!p || !m) return;
    if (S.filter !== 'all' && ((S.filter === 'animal') !== (p.kind === 'animal'))) { S.filter = 'all'; applyFilter(); }
    map.setView([p.lat, p.lng], Math.max(map.getZoom(), 18));
    m.openPopup();
    const el = m.getElement();
    if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 3200); }
  }
  function onMapClick(e) { if (Field.onMapClick(e)) return; }

  /* ===================== 7. «Где я?», «Найти рядом», «К выходу» ===================== */
  /** Местоположение: подмена из панели или настоящий GPS. */
  function locate() {
    return new Promise((resolve, reject) => {
      const dev = store.get(KEY.devGps);
      if (dev) {
        if (dev === 'deny') return reject({ code: 1 });
        const p = presetGps(dev); if (p) return resolve(p);
      }
      if (!navigator.geolocation) return reject({ code: 2 });
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
        err => reject(err || { code: 2 }),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
    });
  }
  function setUser(p) {
    S.user = p;
    if (!map) return;
    const ll = [p.lat, p.lng];
    if (!userMarker) {
      userMarker = L_.marker(ll, { icon: L_.divIcon({ className: 'zme', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
      userCircle = L_.circle(ll, { radius: p.acc || 20, color: '#1E88E5', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
    } else { userMarker.setLatLng(ll); userCircle.setLatLng(ll).setRadius(p.acc || 20); }
  }
  async function whereAmI() {
    sheet(esc(t('locating')));
    try {
      const p = await locate();
      setUser(p);
      if (insideZoo(p)) {
        map.setView([p.lat, p.lng], Math.max(map.getZoom(), 18));
        sheet(`<b>${esc(t('youAreHere'))}</b><br>${esc(t('accuracy', { n: Math.round(p.acc || 0) }))}`);
      } else {
        const d = dist(p, D.meta.entrance);
        sheet(`<b>${esc(t('outside'))}</b><br>${esc(t('toEntrance', { d: fmtDist(d) }))}` +
          `<div class="sheet__act"><button type="button" class="btn btn--sm" data-act="toZoo">${esc(t('backToZoo'))}</button>` +
          `<button type="button" class="btn btn--sm btn--ghost" data-act="toEntranceRoute">${esc(t('routeTitle'))}</button></div>`);
      }
    } catch (err) { sheet(esc(t(err && err.code === 1 ? 'geoDenied' : 'geoUnavailable'))); }
  }
  function nearestOf(pred, from) {
    let best = null;
    D.places.filter(pred).forEach(p => { const m = dist(from, placeLatLng(p)); if (!best || m < best.m) best = { p, m }; });
    return best;
  }
  const NEAR = [
    { key: 'nearToilet', icon: 'i-wc', pred: p => p.cat === 'wc' },
    { key: 'nearCafe', icon: 'i-cafe', pred: p => p.cat === 'food' },
    { key: 'nearMed', icon: 'i-med', pred: p => p.cat === 'med' },
    { key: 'nearExit', icon: 'u-exit', exit: true }
  ];
  function renderNearList() {
    $('#nearList').innerHTML = NEAR.map((n, i) =>
      `<button type="button" data-near="${i}">${uiIcon(n.icon)}<span>${esc(t(n.key))}</span></button>`).join('');
  }
  function toggleNear(open) {
    S.nearOpen = open == null ? !S.nearOpen : open;
    $('#nearList').hidden = !S.nearOpen;
    $('#btnNear').setAttribute('aria-expanded', String(S.nearOpen));
  }
  async function findNear(i) {
    toggleNear(false);
    const n = NEAR[i];
    if (n.exit) return toExit();
    sheet(esc(t('locating')));
    let from;
    try { from = await locate(); setUser(from); } catch (e) { from = null; }
    if (!from) {
      sheet(esc(t('noGpsNear')));
      const list = D.places.filter(n.pred);
      if (list.length) map.fitBounds(list.map(p => [p.lat, p.lng]), { padding: [60, 60], maxZoom: 18 });
      return;
    }
    const best = nearestOf(n.pred, from);
    if (!best) return sheet(esc(t('nothingNear')));
    clearRoute();
    L_.polyline([[from.lat, from.lng], [best.p.lat, best.p.lng]], { color: '#1E88E5', weight: 4, dashArray: '2 8', lineCap: 'round' }).addTo(layers.route);
    map.fitBounds([[from.lat, from.lng], [best.p.lat, best.p.lng]], { padding: [70, 70], maxZoom: 18 });
    sheet(`<b>${esc(t('nearestIs', { name: L(best.p.title) }))}</b><br>${esc(fmtDist(best.m))} · ${esc(t('minWalk', { n: walkMin(best.m) }))} · ${esc(dirName(bearing(from, placeLatLng(best.p))))}`);
  }
  function clearRoute() { if (layers.route) layers.route.clearLayers(); }
  /** «К выходу», этап 1: линия до центрального входа, расстояние, направление. */
  async function toExit() {
    sheet(esc(t('locating')));
    let from;
    try { from = await locate(); setUser(from); } catch (e) {
      sheet(esc(t('noGpsExit'))); focusEntrance(); return;
    }
    const ent = D.meta.entrance, m = dist(from, ent), deg = bearing(from, ent);
    clearRoute();
    L_.polyline([[from.lat, from.lng], [ent.lat, ent.lng]], { color: '#1E88E5', weight: 5, dashArray: '2 9', lineCap: 'round' }).addTo(layers.route);
    map.fitBounds([[from.lat, from.lng], [ent.lat, ent.lng]], { padding: [70, 70], maxZoom: 18 });
    // Стрелка — SVG, а не символ «↑»: в шрифте Nunito стрелок нет
    sheet(`<div class="exitinfo"><span class="arrow" style="transform:rotate(${Math.round(deg)}deg)"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5 19 11h-4.6v10.5H9.6V11H5z"/></svg></span>` +
      `<div><b>${esc(t('exitTitle'))}</b><br>${esc(fmtDist(m))} · ${esc(t('minWalk', { n: walkMin(m) }))}<br>${esc(t('exitDir', { dir: dirName(deg) }))}</div></div>`);
  }
  function focusEntrance() { const e = D.places.find(p => p.cat === 'entrance'); if (e) focusPlace(e.id); }
  function sheet(html) {
    if (html == null) { $('#sheet').hidden = true; return; }
    $('#sheetBody').innerHTML = html; $('#sheet').hidden = false;
  }

  /* ===================== 8. Поиск ===================== */
  function searchIndex() {
    const items = [];
    D.places.forEach(p => items.push({ type: p.kind === 'animal' ? 'animal' : 'place', id: p.id, placeId: p.id, icon: p.icon, color: iconColor(p), title: p.title, extra: p.keywords || [] }));
    D.animals.forEach(a => {
      const p = D.places.find(x => x.id === a.place);
      if (p && !(a.title.ru === p.title.ru)) items.push({ type: 'animal', id: a.id, placeId: p.id, icon: p.icon, color: iconColor(p), title: a.title, sub: p.title, extra: [] });
    });
    return items;
  }
  function doSearch(q) {
    const nq = norm(q);
    if (nq.length < 2) return [];
    return searchIndex().filter(it => LANGS.some(l => norm(it.title[l]).includes(nq)) || it.extra.some(k => norm(k).includes(nq)));
  }
  function renderSearch() {
    const q = $('#searchInput').value, res = doSearch(q), box = $('#searchResults');
    if (norm(q).length < 2) { box.innerHTML = `<p class="muted">${esc(t('searchHint'))}</p>`; return; }
    if (!res.length) { box.innerHTML = `<p class="muted">${esc(t('searchEmpty'))}</p>`; return; }
    const group = (type, title) => {
      const list = res.filter(r => r.type === type);
      if (!list.length) return '';
      return `<h2 class="sr__h">${esc(t(title))}</h2>` + list.map(r =>
        `<button type="button" class="sr__item" data-act="focus" data-id="${r.placeId}"><span class="mkmini">${markerSvg(r.icon, r.color)}</span>` +
        `<span><b>${esc(L(r.title))}</b>${r.sub ? `<small>${esc(L(r.sub))}</small>` : ''}</span></button>`).join('');
    };
    box.innerHTML = group('animal', 'searchAnimals') + group('place', 'searchPlaces');
  }
  function openSearch() { $('#searchOverlay').hidden = false; $('#searchInput').value = ''; renderSearch(); setTimeout(() => $('#searchInput').focus(), 30); }
  function closeSearch() { $('#searchOverlay').hidden = true; }

  /* ===================== 9. Коллекция ===================== */
  function renderCollection() {
    const q = norm($('#collSearch').value);
    const kinds = ['pavilion', 'enclosure', 'zone'];
    let html = '';
    kinds.forEach(kind => {
      const zones = D.zones.filter(z => z.kind === kind).filter(z => {
        if (!q) return true;
        const p = D.places.find(x => x.zone === z.id);
        const names = [z.title].concat(D.animals.filter(a => p && a.place === p.id).map(a => a.title));
        return names.some(n => LANGS.some(l => norm(n[l]).includes(q)));
      });
      if (!zones.length) return;
      html += `<h2 class="coll__h">${esc(t('kind_' + kind))}</h2><div class="coll__list">`;
      zones.forEach(z => {
        const p = D.places.find(x => x.zone === z.id);
        if (!p) return;
        const d = now(), st = placeStatus(p, d);
        const animals = D.animals.filter(a => a.place === p.id && a.title.ru !== z.title.ru);
        const notes = [];
        if (st === 'sanitary') notes.push(`<span class="tag tag--warn">${esc(t('todayClosed'))}</span>`);
        if (p.hours) notes.push(`<span class="tag">${esc(t('ownHours', { h: p.hours[0] + '–' + p.hours[1] }))}</span>`);
        if (p.sanitaryDay && st !== 'sanitary') notes.push(`<span class="tag">${esc(t('sanitaryEvery', { day: weekday(p.sanitaryDay) }))}</span>`);
        html += `<article class="coll__item" id="coll-${p.id}">` +
          `<span class="mkmini mkmini--lg">${markerSvg(p.icon, iconColor(p))}</span>` +
          `<div class="coll__txt"><b>${esc(L(z.title))}</b>` +
          (animals.length ? `<small>${animals.map(a => esc(L(a.title))).join(', ')}</small>` : (kind === 'pavilion' ? `<small class="muted">${esc(t('collSoon'))}</small>` : '')) +
          (notes.length ? `<div class="tags">${notes.join('')}</div>` : '') + `</div>` +
          `<button type="button" class="btn btn--sm btn--ghost" data-act="focus" data-id="${p.id}" aria-label="${esc(t('onMap'))}">${uiIcon('u-map')}<span>${esc(t('onMap'))}</span></button></article>`;
      });
      html += '</div>';
    });
    $('#collList').innerHTML = html || `<p class="muted">${esc(t('collEmpty'))}</p>`;
  }
  function focusColl(placeId) {
    showTab('coll'); $('#collSearch').value = ''; renderCollection();
    const el = document.getElementById('coll-' + placeId);
    if (el) { if (el.scrollIntoView) el.scrollIntoView({ block: 'center' }); el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 2500); }
  }

  /* ===================== 10. Правила ===================== */
  function renderRules() {
    const r = D.rules;
    $('#rulesBody').innerHTML =
      `<h1>${esc(t('rulesTitle'))}</h1>` +
      `<div class="warn">${uiIcon('u-warn')}<p>${esc(L(r.warning))}</p></div>` +
      `<div class="rules">${r.short.map(x => `<div class="rule">${ruleSvg(x.icon, x.ok)}<span>${esc(L(x.text))}</span></div>`).join('')}</div>` +
      `<details class="full"><summary>${esc(t('rulesFull'))}</summary><ol>${r.full.map(x => `<li>${esc(L(x))}</li>`).join('')}</ol>` +
      `<p class="muted">${esc(L(r.note))}</p></details>`;
  }

  /* ===================== 11. Раздел «Ещё» ===================== */
  function renderMore() {
    const I = D.info, d = now(), h = zooHours(d), c = D.contacts;
    const contactRows = [];
    if (c.phone) contactRows.push(`<a class="row" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${uiIcon('u-phone')}<span>${esc(c.phone)}</span></a>`);
    if (c.whatsapp) contactRows.push(`<a class="row" href="https://wa.me/${esc(c.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">${uiIcon('u-chat')}<span>WhatsApp</span></a>`);
    (c.social || []).forEach(s => contactRows.push(`<a class="row" href="${esc(s.url)}" target="_blank" rel="noopener">${uiIcon('u-chat')}<span>${esc(s.name)}</span></a>`));
    if (c.email) contactRows.push(`<a class="row" href="mailto:${esc(c.email)}">${uiIcon('u-chat')}<span>${esc(c.email)}</span></a>`);
    const e = D.meta.entrance, ll = `${e.lat},${e.lng}`;
    const routeLinks = [
      ['2GIS', `https://2gis.kz/almaty/geo/${e.lng},${e.lat}`],
      ['Google Maps', `https://www.google.com/maps/dir/?api=1&destination=${ll}`],
      [L(t('yandexName')) || 'Яндекс Карты', `https://yandex.kz/maps/?rtext=~${ll}&rtt=auto`]
    ];
    const installed = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
    $('#moreBody').innerHTML =
      `<h1>${esc(t('tabMore'))}</h1>` +
      // Часы работы
      `<section class="card"><h2>${uiIcon('u-clock')}${esc(t('hoursTitle'))}</h2>` +
      `<p><b>${esc(t(season(d) === 'summer' ? 'summer' : 'winter'))}</b> · ${esc(t('daily'))}</p>` +
      `<p>${esc(t('hoursZoo'))}: <b>${h.zoo[0]}–${h.zoo[1]}</b><br>${esc(t('hoursCash'))}: <b>${h.cash[0]}–${h.cash[1]}</b></p>` +
      `<p class="muted">${esc(t('pricesOnSite'))} <a href="${esc(I.site)}" target="_blank" rel="noopener">almatyzoo.kz</a></p></section>` +
      // О зоопарке
      `<details class="card" open><summary><h2>${esc(t('moreAbout'))}</h2></summary>` +
      `<ul class="facts">${I.facts.map(f => `<li><b>${esc(f.n)}</b><span>${esc(L(f.t))}</span></li>`).join('')}</ul>` +
      I.programs.map(p => `<p><b>${esc(L(p.title))}.</b> ${esc(L(p.text))} <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t('more'))}</a></p>`).join('') +
      `</details>` +
      // Помощь и контакты
      `<details class="card"><summary><h2>${esc(t('moreHelp'))}</h2></summary>` +
      (contactRows.length ? contactRows.join('') : '') +
      (!c.phone ? `<p class="muted">${esc(t('contactsSoon'))}</p>` : '') +
      `<div class="lost"><b>${esc(t('lostChild'))}</b><p>${esc(L(I.lostChild))}</p>` +
      `<button type="button" class="btn btn--sm btn--ghost" data-act="focusCat" data-cat="guard">${uiIcon('u-map')}<span>${esc(t('guardOnMap'))}</span></button></div>` +
      `<button type="button" class="btn btn--sm btn--ghost" data-act="focusCat" data-cat="med">${uiIcon('u-map')}<span>${esc(t('medOnMap'))}</span></button>` +
      `</details>` +
      // Как добраться
      `<details class="card"><summary><h2>${esc(t('moreRoute'))}</h2></summary>` +
      `<p>${esc(L(I.address))}</p><p class="muted">${esc(t('routeToEntrance'))}</p>` +
      `<div class="btnrow">${routeLinks.map(([n, u]) => `<a class="btn btn--sm" href="${esc(u)}" target="_blank" rel="noopener">${uiIcon('u-route')}<span>${esc(n)}</span></a>`).join('')}</div>` +
      `<h3>${esc(t('busTitle'))}</h3><p>${esc(L(I.bus))}</p>` +
      `<h3>${esc(t('parkingTitle'))}</h3><p>${esc(L(I.parking))}</p></details>` +
      // Установка
      `<section class="card"><h2>${uiIcon('u-install')}${esc(t('installTitle'))}</h2>` +
      (installed ? `<p>${esc(t('installDone'))}</p>` :
        ios ? `<p>${esc(t('installIos'))}</p>` :
          `<button type="button" class="btn" data-act="install" ${S.deferredInstall ? '' : 'disabled'}>${esc(t('installBtn'))}</button>` +
          (S.deferredInstall ? '' : `<p class="muted">${esc(t('installMenu'))}</p>`)) +
      `</section>` +
      `<p class="version" id="versionTag">${esc(t('version'))} ${APP_VERSION}</p>`;
  }

  /* ===================== 12. Навигация, язык, шапка ===================== */
  function showTab(tab) {
    S.tab = tab;
    $$('.screen').forEach(s => { s.hidden = s.dataset.screen !== tab; });
    $$('#tabbar button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    if (tab === 'map') { initMap(); if (map) setTimeout(() => map.invalidateSize(), 0); }
    if (tab === 'coll') renderCollection();
  }
  function setLang(l, opts) {
    S.lang = LANGS.includes(l) ? l : 'ru';
    store.set(KEY.lang, S.lang);
    document.documentElement.lang = S.lang === 'kz' ? 'kk' : S.lang;
    $$('.langsw button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang)));
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    $$('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    document.title = t('docTitle');
    $('#mapFilters').innerHTML = ['all', 'animal', 'infra'].map(f => `<button type="button" data-filter="${f}">${esc(t('filter_' + f))}</button>`).join('');
    renderNearList(); renderBanner(); renderRules(); renderMore();
    if (S.tab === 'coll') renderCollection();
    if (!$('#searchOverlay').hidden) renderSearch();
    if (map) { map.closePopup(); buildMarkers(); }
    if (!opts || !opts.keepSheet) sheet(null);
  }
  const dayKey = d => d.getFullYear() + '-' + mmdd(d);
  /** Плашка сверху карты: «зоопарк закрыт», санитарный день. Одна строка; крестик скрывает её до конца дня. */
  function renderBanner() {
    const d = now(), msgs = [];
    const h = zooHours(d);
    if (!isOpen(h.zoo, d)) msgs.push(t('zooClosedNow', { from: h.zoo[0], to: h.zoo[1] }));
    D.places.filter(p => isSanitary(p, d)).forEach(p => msgs.push(t('sanitaryToday', { name: L(p.title) })));
    const b = $('#banner');
    b.hidden = !msgs.length || store.get(KEY.bannerClosed) === dayKey(d);
    b.innerHTML = msgs.length ? `<p class="banner__text">${msgs.map(esc).join(' · ')}</p>` +
      `<button type="button" class="banner__close" data-act="bannerClose" aria-label="${esc(t('close'))}">${uiIcon('u-close')}</button>` : '';
  }
  function showLangScreen() {
    const sug = deviceLang();
    $$('#langScreen [data-pick]').forEach(b => b.classList.toggle('suggest', b.dataset.pick === sug));
    $('#langScreen').hidden = false;
  }
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /** Все нажатия — через один обработчик на документе (элементы перерисовываются). */
  function onClick(e) {
    const el = e.target.closest('button, a');
    if (!el) return;
    if (el.dataset.tab) return showTab(el.dataset.tab);
    if (el.dataset.lang) return setLang(el.dataset.lang);
    if (el.dataset.pick) { setLang(el.dataset.pick); $('#langScreen').hidden = true; return; }
    if (el.dataset.filter) { S.filter = el.dataset.filter; return applyFilter(); }
    if (el.dataset.near) return findNear(+el.dataset.near);
    switch (el.dataset.act || el.id) {
      case 'btnSearch': return openSearch();
      case 'searchBack': return closeSearch();
      case 'btnLocate': return whereAmI();
      case 'btnNear': return toggleNear();
      case 'btnToZoo': return fitZoo();
      case 'sheetClose': clearRoute(); return sheet(null);
      case 'bannerClose': store.set(KEY.bannerClosed, dayKey(now())); return renderBanner();
      case 'focus': closeSearch(); return focusPlace(el.dataset.id);
      case 'toColl': return focusColl(el.dataset.id);
      case 'toZoo': sheet(null); return fitZoo();
      case 'toEntranceRoute': return toExit();
      case 'focusCat': { const p = D.places.find(x => x.cat === el.dataset.cat); if (p) focusPlace(p.id); return; }
      case 'install':
        if (S.deferredInstall) { S.deferredInstall.prompt(); S.deferredInstall.userChoice.finally(() => { S.deferredInstall = null; renderMore(); }); }
        return;
    }
  }

  /* ===================== 13. Service Worker и автообновление ===================== */
  let pendingReload = false;
  const reloadBlocked = () => Field.isRecording();
  function tryPendingReload() { if (pendingReload && !reloadBlocked()) location.reload(); }
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (!(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
    const hadController = !!navigator.serviceWorker.controller;   // без воркера — первая установка без перезагрузки
    let refreshing = false, reg = null;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing || !hadController) return;
      if (reloadBlocked()) { pendingReload = true; return; }       // идёт запись трека — ждём
      refreshing = true; location.reload();
    });
    const go = () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(r => { reg = r; r.update(); }).catch(() => {});
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && reg) reg.update(); });
  }

  /* ===================== 14. Сервисная панель и полевой режим =====================
     ZOO:SYS-TOOLS:START
     «Замок от случайного входа», не защита: в коде только соль и хэш PBKDF2. */
  const SALT = 'ALMATYZOO:SYS:2026';
  const KEY_HASH = 'e9100556d649a7bfbff70af21aed3a76590ead66403396bcf785e828a05a49c3';   // временный ключ на период тестов
  const PBKDF2_ITER = 150000;
  let authorized = false;           // внутри модуля, наружу не отдаётся
  let taps = [];

  async function pbkdf2Hex(key, salt, iterations) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(key), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, base, 256);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function onVersionTap() {
    const n = Date.now();
    taps = taps.filter(x => n - x <= TAP_WINDOW_MS); taps.push(n);
    if (taps.length >= TAP_COUNT) { taps = []; if (authorized) openPanel(); else openAuth(); }
  }
  function openAuth() { $('#authErr').hidden = true; $('#authInput').value = ''; $('#authOverlay').hidden = false; setTimeout(() => $('#authInput').focus(), 30); }
  function cancelAuth() { $('#authOverlay').hidden = true; $('#authInput').value = ''; }
  async function confirmAuth() {
    const input = $('#authInput');
    let ok = false;
    try { ok = (await pbkdf2Hex(input.value.trim(), SALT, PBKDF2_ITER)) === KEY_HASH; } catch (e) { ok = false; }
    if (ok) { authorized = true; cancelAuth(); openPanel(); }
    else { input.value = ''; input.focus(); $('#authErr').hidden = false; }
  }

  function presetGps(name) {
    const P = {
      entrance: { lat: D.meta.entrance.lat, lng: D.meta.entrance.lng, acc: 8 },
      center: { lat: D.meta.center[0], lng: D.meta.center[1], acc: 10 },
      pond: (() => { const p = D.places.find(x => x.id === 'pond'); return p ? { lat: p.lat, lng: p.lng, acc: 12 } : null; })(),
      outside: { lat: D.meta.outsidePoint[0], lng: D.meta.outsidePoint[1], acc: 15 }
    };
    return P[name] || null;
  }
  function errorLog() { return store.json(KEY.errors, []); }
  function logError(msg) {
    const l = errorLog(); l.push({ t: new Date().toISOString(), v: APP_VERSION, m: String(msg).slice(0, 500) });
    store.setJson(KEY.errors, l.slice(-50));
  }
  function applyApproxView() { if (map) map.getContainer().classList.toggle('show-approx', store.get(KEY.approx) === '1'); }

  async function cacheInfo() {
    if (!('caches' in window)) return 'Кэш недоступен в этом браузере';
    try {
      const keys = await caches.keys(), out = [];
      for (const k of keys) { const c = await caches.open(k); out.push(`${k}: ${(await c.keys()).length}`); }
      return out.join('<br>') || 'Кэшей нет';
    } catch (e) { return 'Ошибка чтения кэша'; }
  }
  async function openPanel() {
    if (!authorized) return;      // без этой проверки панель открывалась бы прямым вызовом
    const ph = Object.keys(D.icons).filter(isPlaceholder);
    const approx = D.places.filter(p => p.approx).length;
    const errs = errorLog();
    const dev = { now: store.get(KEY.devNow) || '', gps: store.get(KEY.devGps) || '' };
    const sw = ('serviceWorker' in navigator && navigator.serviceWorker.controller) ? 'активен' : 'не активен';
    $('#panelBody').innerHTML =
      `<section class="card"><h2>Версия</h2><p>Приложение: <b>${APP_VERSION}</b><br>Данные: <b>${esc(D.meta.dataVersion)}</b><br>Service Worker: <b>${sw}</b></p>` +
      `<p id="pCache" class="muted">Кэш: читаю…</p><button type="button" class="btn btn--ghost btn--sm" data-p="clear">Очистить кэш и перезагрузить</button></section>` +
      `<section class="card"><h2>GPS</h2><p id="pGps" class="muted">Нажмите «Обновить»</p><button type="button" class="btn btn--sm" data-p="gps">Обновить</button></section>` +
      `<section class="card"><h2>Подмена даты</h2><p class="muted">Сейчас: ${esc(now().toLocaleString('ru-RU'))}${dev.now ? ' (подменено)' : ''}</p>` +
      `<input type="datetime-local" id="pNow" value="${esc(dev.now)}"><div class="btnrow"><button type="button" class="btn btn--sm" data-p="setNow">Применить</button><button type="button" class="btn btn--sm btn--ghost" data-p="resetNow">Сбросить</button></div></section>` +
      `<section class="card"><h2>Подмена местоположения</h2><div class="btnrow">` +
      [['entrance', 'У входа'], ['center', 'В глубине'], ['pond', 'У пруда'], ['outside', 'Вне территории'], ['deny', 'Без GPS']]
        .map(([k, n]) => `<button type="button" class="btn btn--sm ${dev.gps === k ? '' : 'btn--ghost'}" data-p="gpsSet" data-v="${k}">${n}</button>`).join('') +
      `<button type="button" class="btn btn--sm btn--ghost" data-p="gpsSet" data-v="">Настоящий GPS</button></div></section>` +
      `<section class="card"><h2>Язык</h2><button type="button" class="btn btn--sm btn--ghost" data-p="resetLang">Сбросить язык (снова экран выбора)</button></section>` +
      `<section class="card"><h2>Ориентировочные координаты</h2><p>Мест с пометкой approx: <b>${approx}</b> из ${D.places.length}</p>` +
      `<button type="button" class="btn btn--sm btn--ghost" data-p="approx">${store.get(KEY.approx) === '1' ? 'Выключить подсветку' : 'Подсветить на карте'}</button></section>` +
      `<section class="card"><h2>Заглушки пиктограмм: ${ph.length}</h2><p class="muted small">${ph.map(esc).join(', ')}</p></section>` +
      `<section class="card"><h2>Полевой режим</h2><p>Записей: <b>${Field.items().length}</b></p><div class="btnrow">` +
      `<button type="button" class="btn btn--sm" data-p="field">Включить на карте</button>` +
      `<button type="button" class="btn btn--sm btn--ghost" data-p="export" ${Field.items().length ? '' : 'disabled'}>Экспорт</button></div></section>` +
      `<section class="card"><h2>Журнал ошибок: ${errs.length}</h2>` +
      (errs.length ? `<pre class="log">${errs.slice(-10).map(e => esc(e.t + ' ' + e.m)).join('\n')}</pre>` : '<p class="muted">Ошибок нет</p>') +
      `<div class="btnrow"><button type="button" class="btn btn--sm" data-p="sendLog" ${errs.length ? '' : 'disabled'}>Отправить</button><button type="button" class="btn btn--sm btn--ghost" data-p="clearLog">Очистить</button></div></section>`;
    $('#panelOverlay').hidden = false;
    cacheInfo().then(s => { const el = $('#pCache'); if (el) el.innerHTML = 'Кэш:<br>' + s; });
  }
  async function shareText(title, text) {
    try { if (navigator.share) { await navigator.share({ title, text }); return; } } catch (e) { return; }
    try { await navigator.clipboard.writeText(text); toast('Скопировано'); } catch (e) { toast('Не удалось отправить'); }
  }
  async function onPanelClick(e) {
    const b = e.target.closest('[data-p]'); if (!b || !authorized) return;
    switch (b.dataset.p) {
      case 'clear':
        try { if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k); } catch (er) { /* */ }
        try { if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (er) { /* */ }
        location.reload(); return;
      case 'gps':
        try { const p = await locate(); $('#pGps').textContent = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} · точность ${Math.round(p.acc || 0)} м`; }
        catch (er) { $('#pGps').textContent = 'Нет данных GPS'; }
        return;
      case 'setNow': { const v = $('#pNow').value; if (v) store.set(KEY.devNow, v); refreshAfterDev(); return; }
      case 'resetNow': store.del(KEY.devNow); refreshAfterDev(); return;
      case 'gpsSet': if (b.dataset.v) store.set(KEY.devGps, b.dataset.v); else store.del(KEY.devGps); refreshAfterDev(); return;
      case 'resetLang': store.del(KEY.lang); closePanel(); showLangScreen(); return;
      case 'approx': store.set(KEY.approx, store.get(KEY.approx) === '1' ? '0' : '1'); applyApproxView(); openPanel(); return;
      case 'field': closePanel(); showTab('map'); Field.start(); return;
      case 'export': Field.exportFile(); return;
      case 'sendLog': shareText('Almaty Zoo — журнал ошибок', errorLog().map(x => `${x.t} [${x.v}] ${x.m}`).join('\n')); return;
      case 'clearLog': store.del(KEY.errors); openPanel(); return;
    }
  }
  function refreshAfterDev() { renderBanner(); renderMore(); if (map) buildMarkers(); openPanel(); }
  function closePanel() { $('#panelOverlay').hidden = true; }

  /** Полевой режим: точки, контуры, треки; хранение в localStorage; экспорт GeoJSON. */
  const Field = (function () {
    let active = false, mode = null, draft = [], draftLayer = null, watchId = null, wakeLock = null, recording = false;
    let handles = [], editId = null;     // кружки точек контура; id контура, который правится
    const items = () => store.json(KEY.field, []);
    const save = list => store.setJson(KEY.field, list);
    const CATS = ['animal', 'infra', 'border', 'path', 'service', 'other'];
    const CAT_NAMES = { animal: 'Животные', infra: 'Инфраструктура', border: 'Граница', path: 'Дорожка', service: 'Служебное', other: 'Другое' };

    function bar(html) { const el = $('#fieldbar'); el.innerHTML = html; el.hidden = !html; }
    function mainBar() {
      bar(`<b>Полевой режим</b><span class="muted">записей: ${items().length}</span>` +
        `<button type="button" class="btn btn--sm" data-f="gpsPoint">Точка: я здесь</button>` +
        `<button type="button" class="btn btn--sm" data-f="tapPoint">Точка тапом</button>` +
        `<button type="button" class="btn btn--sm" data-f="polygon">Контур</button>` +
        `<button type="button" class="btn btn--sm" data-f="track">Трек</button>` +
        `<button type="button" class="btn btn--sm btn--ghost" data-f="list">Список</button>` +
        `<button type="button" class="btn btn--sm btn--ghost" data-f="exit">Выйти</button>`);
    }
    function draw() {
      if (!map) return;
      layers.field.clearLayers();
      items().forEach(it => {
        const style = { color: '#FF00FF', weight: 3 };
        if (it.id === editId) return;                              // правится — рисуется черновиком
        if (it.type === 'point' && it.place && markers[it.place]) return;   // место показано самой пиктограммой
        if (it.type === 'point') L_.circleMarker(it.coords[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#FF00FF', fillOpacity: 1 }).bindTooltip(esc(it.name)).addTo(layers.field);
        if (it.type === 'polygon') L_.polygon(it.coords, Object.assign({ fillOpacity: 0.1 }, style)).bindTooltip(esc(it.name)).addTo(layers.field);
        if (it.type === 'track') L_.polyline(it.coords, style).bindTooltip(esc(it.name)).addTo(layers.field);
      });
    }
    function start() {
      if (!authorized) return;
      active = true; mode = null;
      document.body.classList.add('field-on');                   // плашка и кнопки посетителя спрятаны
      if (map) { map.closePopup(); map.removeLayer(osm); sat.addTo(map); sat.bringToBack(); }
      applyMarkers(); draw(); mainBar();
    }
    function stop() {
      active = false; mode = null; cancelDraft();
      document.body.classList.remove('field-on');
      if (map) {
        map.removeLayer(sat); osm.addTo(map); osm.bringToBack(); layers.field.clearLayers();
        D.places.forEach(p => { const m = markers[p.id]; if (m) { if (m.dragging) m.dragging.disable(); m.setLatLng([p.lat, p.lng]); } });
      }
      bar('');
    }
    /** Пиктограммы мест: перетаскиваются; стоят там, куда их перетащили (только в полевом режиме). */
    function applyMarkers() {
      const moved = {};
      items().forEach(it => { if (it.type === 'point' && it.place) moved[it.place] = it.coords[0]; });
      D.places.forEach(p => {
        const m = markers[p.id]; if (!m) return;
        if (m.dragging) m.dragging.enable();
        if (moved[p.id]) m.setLatLng(moved[p.id]);
      });
    }
    /** Перетащили пиктограмму — одна запись на место, повторное перетаскивание её заменяет. */
    function onMarkerDrag(id, ll) {
      if (!active) return;
      const p = D.places.find(x => x.id === id); if (!p) return;
      const list = items().filter(x => !(x.type === 'point' && x.place === id));
      list.push({ id: 'f' + Date.now(), type: 'point', name: p.title.ru + ' — перетащено', place: id, cat: p.kind === 'animal' ? 'animal' : 'infra',
        coords: [[+ll.lat.toFixed(7), +ll.lng.toFixed(7)]], acc: null, ts: new Date().toISOString() });
      save(list); draw(); mainBar(); toast('Сохранено: ' + p.title.ru);
    }
    function cancelDraft() {
      draft = []; editId = null;
      if (draftLayer && map) map.removeLayer(draftLayer); draftLayer = null;
      handles.forEach(h => map && map.removeLayer(h)); handles = [];
      if (map) map.getContainer().classList.remove('drawing');
    }
    /** Черновик контура: линия + перетаскиваемые кружки точек. */
    function redrawLine() {
      if (draftLayer) map.removeLayer(draftLayer);
      draftLayer = L_.polyline(draft.concat(draft.length > 2 ? [draft[0]] : []), { color: '#FF00FF', weight: 3, dashArray: '4 6' }).addTo(map);
    }
    function redrawDraft() {
      map.getContainer().classList.add('drawing');                // пиктограммы не перехватывают тапы по углам контура
      handles.forEach(h => map.removeLayer(h)); handles = [];
      redrawLine();
      handles = draft.map((ll, i) => {
        const h = L_.marker(ll, { draggable: true, icon: L_.divIcon({ className: 'fh', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 2000 });
        const upd = () => { const q = h.getLatLng(); draft[i] = [+q.lat.toFixed(7), +q.lng.toFixed(7)]; redrawLine(); };
        h.on('drag', upd).on('dragend', upd);
        return h.addTo(map);
      });
      polyBar();
    }
    function polyBar() {
      bar(`<b>${editId ? 'Правка контура' : 'Контур'}</b><span class="muted">Точек: ${draft.length} · тап — добавить, перетащить — сдвинуть</span>` +
        `<button type="button" class="btn btn--sm btn--ghost" data-f="undo" ${draft.length ? '' : 'disabled'}>Шаг назад</button>` +
        `<button type="button" class="btn btn--sm" data-f="polyDone" ${draft.length > 2 ? '' : 'disabled'}>Готово</button>` +
        `<button type="button" class="btn btn--sm btn--ghost" data-f="cancel">Отмена</button>`);
    }
    function onMapClick(e) {
      if (!active || !mode) return false;
      const ll = [+e.latlng.lat.toFixed(7), +e.latlng.lng.toFixed(7)];
      if (mode === 'tapPoint') { mode = null; askName('point', [ll], null); return true; }
      if (mode === 'polygon') { draft.push(ll); redrawDraft(); return true; }
      return false;
    }
    function gpsPoint() {
      if (!navigator.geolocation && !store.get(KEY.devGps)) return toast('GPS недоступен');
      const dev = store.get(KEY.devGps);
      if (dev && dev !== 'deny') { const p = presetGps(dev); return askName('point', [[p.lat, p.lng]], p.acc); }
      const samples = []; let left = 10;
      bar(`<b>Слушаю GPS…</b><span class="muted" id="fCount">10 с</span><button type="button" class="btn btn--sm btn--ghost" data-f="cancel">Отмена</button>`);
      watchId = navigator.geolocation.watchPosition(pos => samples.push(pos.coords), () => {}, { enableHighAccuracy: true, maximumAge: 0 });
      const timer = setInterval(() => {
        left--; const c = $('#fCount'); if (c) c.textContent = left + ' с · замеров ' + samples.length;
        if (left <= 0) {
          clearInterval(timer); navigator.geolocation.clearWatch(watchId); watchId = null;
          if (!samples.length) { toast('Нет сигнала GPS'); return mainBar(); }
          const good = samples.filter(s => s.accuracy <= Math.min(...samples.map(x => x.accuracy)) * 2);
          const lat = good.reduce((a, s) => a + s.latitude, 0) / good.length, lng = good.reduce((a, s) => a + s.longitude, 0) / good.length;
          const acc = good.reduce((a, s) => a + s.accuracy, 0) / good.length;
          askName('point', [[+lat.toFixed(7), +lng.toFixed(7)]], Math.round(acc));
        }
      }, 1000);
    }
    async function startTrack() {
      if (!navigator.geolocation) return toast('GPS недоступен');
      draft = []; recording = true;
      try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
      bar(`<b>Запись трека</b><span class="muted" id="fCount">точек: 0</span><button type="button" class="btn btn--sm" data-f="trackStop">Стоп</button>` +
        `<span class="muted small">Не блокируйте экран</span>`);
      watchId = navigator.geolocation.watchPosition(pos => {
        const c = pos.coords; if (c.accuracy > 30) return;
        const ll = [+c.latitude.toFixed(7), +c.longitude.toFixed(7)];
        const last = draft[draft.length - 1];
        if (last && dist({ lat: last[0], lng: last[1] }, { lat: ll[0], lng: ll[1] }) < 3) return;
        draft.push(ll);
        if (draftLayer) map.removeLayer(draftLayer);
        draftLayer = L_.polyline(draft, { color: '#FF00FF', weight: 4 }).addTo(map);
        const el = $('#fCount'); if (el) el.textContent = 'точек: ' + draft.length;
      }, () => {}, { enableHighAccuracy: true, maximumAge: 0 });
    }
    function stopTrack() {
      if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null;
      try { if (wakeLock) wakeLock.release(); } catch (e) { /* */ } wakeLock = null;
      recording = false;
      const pts = draft.slice(); cancelDraft();
      if (pts.length < 2) { toast('Трек слишком короткий'); mainBar(); }
      else askName('track', pts, null);
      tryPendingReload();
    }
    function askName(type, coords, acc) {
      const f = $('#fieldFormBody');
      f.innerHTML = `<div class="dialog__head">Новая запись: ${{ point: 'точка', polygon: 'контур', track: 'трек' }[type]}</div>` +
        (acc != null ? `<p class="muted">Точность: ${acc} м</p>` : '') +
        placeSelect(type) +
        `<input type="text" id="fName" placeholder="Название или примечание, например «центр вольера»" autocomplete="off">` +
        `<select id="fCat">${CATS.map(c => `<option value="${c}">${CAT_NAMES[c]}</option>`).join('')}</select>` +
        `<div class="dialog__btns"><button type="button" class="btn btn--ghost" data-f="formCancel">Отмена</button><button type="button" class="btn" data-f="formSave">Сохранить</button></div>`;
      f.dataset.pending = JSON.stringify({ type, coords, acc });
      $('#fieldForm').hidden = false; setTimeout(() => $('#fName').focus(), 30);
    }
    /** Привязка записи к существующему месту из data.json: перенос координат без угадывания. */
    function placeSelect(type) {
      const done = new Set(items().map(x => x.place).filter(Boolean));
      const mark = id => done.has(id) ? ' (уже есть запись)' : '';
      const byTitle = (a, b) => a.title.ru.localeCompare(b.title.ru, 'ru');
      const group = (label, list) => list.length ? `<optgroup label="${label}">${list.sort(byTitle).map(p => `<option value="${p.id}">${esc(p.title.ru)} · ${p.id}${mark(p.id)}</option>`).join('')}</optgroup>` : '';
      const opts = type === 'point'
        ? group('Животные', D.places.filter(p => p.kind === 'animal')) + group('Инфраструктура', D.places.filter(p => p.kind === 'infra')) + group('Снаружи', D.places.filter(p => p.kind === 'outside'))
        : type === 'polygon'
          ? `<option value="boundary">Граница зоопарка${mark('boundary')}</option>` + group('Контур места', D.places.filter(p => p.kind === 'animal'))
          : '';
      return `<label class="muted small" for="fPlace">Какое это место</label><select id="fPlace"><option value="">— новое, нет в списке —</option>${opts}</select>`;
    }
    function formSave() {
      const f = $('#fieldFormBody'), pend = JSON.parse(f.dataset.pending || '{}');
      const place = $('#fPlace') ? $('#fPlace').value : '';
      const pl = place && place !== 'boundary' ? D.places.find(x => x.id === place) : null;
      const label = place === 'boundary' ? 'Граница зоопарка' : (pl ? pl.title.ru : '');
      const note = $('#fName').value.trim();
      const name = [label, note].filter(Boolean).join(' — ') || ('Без названия ' + new Date().toLocaleTimeString('ru-RU'));
      const list = items();
      list.push({ id: 'f' + Date.now(), type: pend.type, name, place: place || null, cat: $('#fCat').value, coords: pend.coords, acc: pend.acc, ts: new Date().toISOString() });
      save(list); $('#fieldForm').hidden = true; draw(); mainBar(); toast('Сохранено');
    }
    function showList() {
      const list = items();
      bar(`<b>Записи: ${list.length}</b><button type="button" class="btn btn--sm btn--ghost" data-f="back">Назад</button>` +
        `<div class="flist">${list.map(it => `<div><span>${esc(it.name)} <small class="muted">${it.type}</small></span>` +
          `<button type="button" class="btn btn--sm btn--ghost" data-f="show" data-id="${it.id}">Показать</button>` +
          (it.type === 'polygon' ? `<button type="button" class="btn btn--sm btn--ghost" data-f="edit" data-id="${it.id}">Изменить</button>` : '') +
          `<button type="button" class="btn btn--sm btn--ghost" data-f="del" data-id="${it.id}">Удалить</button></div>`).join('') || '<p class="muted">Пусто</p>'}</div>`);
    }
    /** Имя файла с датой и временем: zoo-points_2026-11-10_14-30.geojson */
    function fileName(d) {
      const p = n => String(n).padStart(2, '0');
      return `zoo-points_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}.geojson`;
    }
    function toGeoJSON() {
      return {
        type: 'FeatureCollection',
        properties: { app: 'almatyzoo-guide', version: APP_VERSION, exported: new Date().toISOString() },
        features: items().map(it => ({
          type: 'Feature',
          properties: { id: it.id, name: it.name, place: it.place || null, cat: it.cat, kind: it.type, accuracy: it.acc, time: it.ts },
          geometry: it.type === 'point' ? { type: 'Point', coordinates: [it.coords[0][1], it.coords[0][0]] }
            : it.type === 'polygon' ? { type: 'Polygon', coordinates: [it.coords.concat([it.coords[0]]).map(c => [c[1], c[0]])] }
              : { type: 'LineString', coordinates: it.coords.map(c => [c[1], c[0]]) }
        }))
      };
    }
    async function exportFile() {
      if (!authorized) return;
      const name = fileName(new Date()), text = JSON.stringify(toGeoJSON(), null, 1);
      const blob = new Blob([text], { type: 'application/geo+json' });
      try {
        const file = new File([blob], name, { type: 'application/geo+json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    function onClick(e) {
      const b = e.target.closest('[data-f]'); if (!b || !authorized) return;
      switch (b.dataset.f) {
        case 'gpsPoint': return gpsPoint();
        case 'tapPoint': mode = 'tapPoint'; return bar(`<b>Коснитесь карты</b><button type="button" class="btn btn--sm btn--ghost" data-f="cancel">Отмена</button>`);
        case 'polygon': cancelDraft(); mode = 'polygon'; return redrawDraft();
        case 'undo': draft.pop(); return redrawDraft();
        case 'edit': {
          const it = items().find(x => x.id === b.dataset.id); if (!it) return;
          cancelDraft(); mode = 'polygon'; editId = it.id; draft = it.coords.map(c => c.slice());
          draw(); return redrawDraft();
        }
        case 'polyDone': {
          const pts = draft.slice(), wasEdit = editId; mode = null; cancelDraft();
          if (wasEdit) {                          // правка: координаты меняются, место и название — прежние
            save(items().map(x => x.id === wasEdit ? Object.assign({}, x, { coords: pts, ts: new Date().toISOString() }) : x));
            draw(); mainBar(); return toast('Контур обновлён');
          }
          return askName('polygon', pts, null);
        }
        case 'track': return startTrack();
        case 'trackStop': return stopTrack();
        case 'list': return showList();
        case 'back': case 'cancel':
          if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
          mode = null; cancelDraft(); draw(); return mainBar();
        case 'show': { const it = items().find(x => x.id === b.dataset.id); if (it && map) map.fitBounds(it.coords.length > 1 ? it.coords : [it.coords[0], it.coords[0]], { maxZoom: 19, padding: [40, 40] }); return; }
        case 'del': save(items().filter(x => x.id !== b.dataset.id)); draw(); return showList();
        case 'formCancel': $('#fieldForm').hidden = true; return mainBar();
        case 'formSave': return formSave();
        case 'exit': return stop();
      }
    }
    return { start, stop, onMapClick, onClick, items, exportFile, fileName, toGeoJSON, applyMarkers, onMarkerDrag,
      isRecording: () => recording, isActive: () => active, debug: () => ({ handles: handles.slice() }) };
  })();
  /* ZOO:SYS-TOOLS:END */

  /* ===================== 15. Запуск ===================== */
  const L_ = window.L;    // Leaflet (имя L занято функцией перевода)

  async function loadSprite() {
    try { const r = await fetch('icons/sprite.svg'); $('#sprite').innerHTML = await r.text(); } catch (e) { logError('sprite: ' + e.message); }
  }
  async function init() {
    window.addEventListener('error', e => logError((e.message || 'error') + ' @' + (e.filename || '') + ':' + (e.lineno || '')));
    window.addEventListener('unhandledrejection', e => logError('promise: ' + (e.reason && e.reason.message || e.reason)));
    const [data] = await Promise.all([fetch('data.json').then(r => r.json()), loadSprite()]);
    D = data;
    document.addEventListener('click', onClick);
    document.addEventListener('click', e => { const v = e.target.closest('#versionTag'); if (v) onVersionTap(); });
    $('#panelOverlay').addEventListener('click', onPanelClick);
    document.addEventListener('click', Field.onClick);
    $('#authOk').addEventListener('click', confirmAuth);
    $('#authCancel').addEventListener('click', cancelAuth);
    $('#authInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAuth(); });
    $('#panelClose').addEventListener('click', closePanel);
    $('#searchInput').addEventListener('input', renderSearch);
    $('#collSearch').addEventListener('input', renderCollection);
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.deferredInstall = e; renderMore(); });
    const saved = store.get(KEY.lang);
    setLang(saved || deviceLang());
    showTab('map');
    if (!saved) showLangScreen();
    setInterval(renderBanner, 60000);
    registerSW();
  }

  /** Доступ для автотестов: только чтение состояния, без ключа и флага авторизации. */
  const ready = init().catch(e => { logError('init: ' + e.message); throw e; });
  window.ZooApp = Object.freeze({
    version: APP_VERSION, ready,
    get data() { return D; }, get state() { return Object.assign({}, S); },
    get map() { return map; }, get markers() { return Object.assign({}, markers); },
    get layers() { return layers; },
    debugField: () => Field.debug(),
    fn: Object.freeze({ season, zooHours, placeStatus, isSanitary, dist, bearing, insideZoo, norm, doSearch, fileName: d => Field.fileName(d), now })
  });
})();
