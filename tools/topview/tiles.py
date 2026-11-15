"""Нарезка «Вида сверху» на плитки карты (Web Mercator, 256 × 256, WebP) — 0.1.12.

Запуск (из корня репозитория):  python3 tools/topview/tiles.py <версия, напр. r1> [PNG рендера]
Вход: tools/topview/out/topview.png + topview.json (из render.py).
Выход: map/top/<версия>/{z}/{x}/{y}.webp для масштабов 16–20 и map/top/<версия>/index.json:
  { version, minZoom, maxZoom, bounds, tiles: ["z/x/y", …] } — список нужен приложению (пустые плитки не запрашиваются)
  и Service Worker (докачка для работы без сети).
Полностью прозрачные плитки не пишутся. Новая сборка рендера — новая версия папки (r2, r3 …): старые плитки в телефоне не мешают.
После нарезки: settings.topView в data.json и TOP_VERSION в sw.js — на новую версию (проверяется тестом).
"""
import json, math, os, sys, shutil, numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
VER = sys.argv[1]
PNG = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'out', 'topview.png')
META = json.load(open(os.path.splitext(PNG)[0] + '.json'))
Z0, Z1, TS, QUALITY = 16, 20, 256, 82
OUT = os.path.join(ROOT, 'map', 'top', VER)
if os.path.exists(OUT): shutil.rmtree(OUT)

Image.MAX_IMAGE_PIXELS = None
src = Image.open(PNG).convert('RGBA')
R = META['metersPerPixel']; lat0, lng0 = META['center']; RX0, RY0, RX1, RY1 = META['frameMeters']
KX = 111320 * math.cos(math.radians(lat0)); KY = 111320
(la0, lo0), (la1, lo1) = META['bounds']

def lon2px(lon, z): return (lon + 180) / 360 * TS * 2 ** z
def lat2px(lat, z):
    s = math.sin(math.radians(lat)); return (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * TS * 2 ** z

tiles = []; total = 0
for z in range(Z0, Z1 + 1):
    mpp = 156543.03392 * math.cos(math.radians(lat0)) / 2 ** z          # метров в пикселе плитки
    f = mpp / R
    if f > 1.3:                                                         # уменьшенная копия — без «ряби» при выборке
        img = src.resize((max(1, round(src.width / f)), max(1, round(src.height / f))), Image.LANCZOS); sc = img.width / src.width
    else:
        img = src; sc = 1.0
    A = np.asarray(img).astype(np.float32)
    # premultiplied alpha — края растворения без тёмной каймы
    A[..., :3] *= A[..., 3:4] / 255
    CH = [np.ascontiguousarray(A[..., c]) for c in range(4)]; del A     # по каналу — без копии всего кадра на каждой плитке
    x0, x1 = lon2px(lo0, z), lon2px(lo1, z); y0, y1 = lat2px(la1, z), lat2px(la0, z)
    tx0, tx1, ty0, ty1 = int(x0 // TS), int(x1 // TS), int(y0 // TS), int(y1 // TS)
    for ty in range(ty0, ty1 + 1):
        py = ty * TS + np.arange(TS) + 0.5
        lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * py / (TS * 2 ** z)))))
        sy = ((RY1 - (lat - lat0) * KY) / R) * sc - 0.5
        for tx in range(tx0, tx1 + 1):
            px = tx * TS + np.arange(TS) + 0.5
            lon = px / (TS * 2 ** z) * 360 - 180
            sx = ((((lon - lng0) * KX) - RX0) / R) * sc - 0.5
            SY, SX = np.meshgrid(sy, sx, indexing='ij')
            out = np.stack([ndimage.map_coordinates(ch, [SY, SX], order=1, mode='constant', cval=0) for ch in CH], -1)
            a = out[..., 3]
            if a.max() < 1: continue
            out[..., :3] = np.where(a[..., None] > 0, out[..., :3] * 255 / np.maximum(a, 1e-3)[..., None], 0)
            im = Image.fromarray(out.clip(0, 255).astype(np.uint8), 'RGBA')
            d = os.path.join(OUT, str(z), str(tx)); os.makedirs(d, exist_ok=True)
            fn = os.path.join(d, f'{ty}.webp')
            if a.min() >= 254.5: im = im.convert('RGB')                 # без прозрачности — меньше
            im.save(fn, 'WEBP', quality=QUALITY, method=6)
            tiles.append(f'{z}/{tx}/{ty}'); total += os.path.getsize(fn)
    print('масштаб', z, 'плиток', sum(1 for t in tiles if t.startswith(f'{z}/')), flush=True)

json.dump({'version': VER, 'minZoom': Z0, 'maxZoom': Z1, 'bounds': [[round(la0, 7), round(lo0, 7)], [round(la1, 7), round(lo1, 7)]],
           'metersPerPixel': R, 'tiles': tiles}, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
print('всего плиток', len(tiles), '%.2f МБ' % (total / 1e6))
