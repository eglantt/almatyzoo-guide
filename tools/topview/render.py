"""«Вид сверху» — 2.5D-рендер территории зоопарка (0.1.12).

Запуск (из корня репозитория):  python3 tools/topview/render.py [м/пиксель, по умолчанию 0.1] [выходной PNG]
Выход по умолчанию: tools/topview/out/topview.png (RGBA) + topview.json (кадр). Папка out/ в git не идёт.
Дальше — tools/topview/tiles.py (нарезка на плитки map/top/<версия>/).

Источники: tools/topview/src/topview-src.json (здания с материалом крыши, полные ограды, граница по внешней ограде,
деревья, высотные отметки — из топосъёмки 2019), map/topo.json (водоёмы, подпорные стенки), map/base.json (город OSM),
data.json (дорожки, убранные линии basemapHide).
Порядок слоёв: земля → вода → дорожки → тени → кроны (над дорожкой — полупрозрачные) → ограды и стенки → крыши.
0.1.13: за внешней оградой картинки нет — чёткий край со сглаживанием (было растворение 4 → 12 м), дальше схема города.
Все размеры заданы в метрах — рендер одинаково выглядит при любом шаге пикселя.
"""
import json, math, os, sys, numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from scipy.interpolate import griddata, RBFInterpolator
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, Point

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
R = float(sys.argv[1]) if len(sys.argv) > 1 else 0.1
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'out', 'topview.png')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
PX = 0.2 / R                     # параметры подобраны на 0,2 м/px; PX переводит «пиксели 0,2 м» в пиксели текущего шага

D = json.load(open(ROOT + '/data.json')); TOPO = json.load(open(ROOT + '/map/topo.json')); BASE = json.load(open(ROOT + '/map/base.json'))
SRC = json.load(open(HERE + '/src/topview-src.json'))
lat0, lng0 = SRC['center']; KX = 111320 * math.cos(math.radians(lat0)); KY = 111320
m = lambda lat, lng: ((lng - lng0) * KX, (lat - lat0) * KY)
ll = lambda x, y: (lat0 + y / KY, lng0 + x / KX)
rng = np.random.default_rng(2019)

hide = set(D.get('basemapHide', []))
boundary = [m(*p) for p in D['meta']['boundary']]
zoo_b = [tuple(c) for c in SRC['zooBoundary']]
bld = [b['g'] for b in SRC['buildings']]; bmat = [b['mat'] for b in SRC['buildings']]
fences = SRC['fences']
walls = [[m(*c) for c in f['g']] for f in TOPO['features'] if f['c'] == 'twall' and f.get('id') not in hide]
water = [[m(*c) for c in f['g'][0]] for f in TOPO['features'] if f['c'] == 'twater']
trees = np.array(SRC['trees']); SP = np.array(SRC['spots'])
base_poly = lambda cls: [[m(*c) for c in f['g'][0]] for f in BASE['features'] if f['t'] == 'p' and f['c'] in cls]
base_line = lambda pref: [(f['c'], [m(*c) for c in f['g']]) for f in BASE['features'] if f['t'] == 'l' and f['c'].startswith(pref)]
paths = [[m(*c) for c in p['coords']] for p in D['paths']]

# ---------- кадр: граница OSM ± 25 м (как у прежних слоёв) ----------
bx = np.array(boundary); MARG = 25
RX0, RY0 = bx.min(0) - MARG; RX1, RY1 = bx.max(0) + MARG
Wd, Hd = int(round((RX1 - RX0) / R)), int(round((RY1 - RY0) / R))
P2 = lambda c: ((c[0] - RX0) / R, (RY1 - c[1]) / R)
print('кадр %d × %d px, %.2f м/px' % (Wd, Hd, R), flush=True)

def mask(fn):
    im = Image.new('L', (Wd, Hd), 0); fn(ImageDraw.Draw(im)); return np.array(im) > 0
polys = lambda lst: (lambda d: [d.polygon([P2(c) for c in p], fill=255) for p in lst if len(p) > 2])
def lines(lst, wm):
    wp = max(1, int(round(wm / R)))
    def f(d):
        for p in lst:
            q = [P2(c) for c in p]; d.line(q, fill=255, width=wp, joint='curve')
            if wp > 2:
                for c in (q[0], q[-1]): d.ellipse([c[0] - wp / 2, c[1] - wp / 2, c[0] + wp / 2, c[1] + wp / 2], fill=255)
    return f
it = lambda n: max(1, int(round(n * PX)))           # число итераций морфологии в «пикселях 0,2 м»

# ---------- рельеф по отметкам (1 м) ----------
RES_D = 1.0; DX0, DY0, DX1, DY1 = -300, -420, 360, 400
gx = np.arange(DX0, DX1, RES_D) + 0.5; gy = np.arange(DY1, DY0, -RES_D) - 0.5
GX, GY = np.meshgrid(gx, gy)
Zl = griddata(SP[:, :2], SP[:, 2], (GX, GY), method='linear')
inside = ~np.isnan(Zl)
Zl[inside] = RBFInterpolator(SP[:, :2], SP[:, 2], kernel='thin_plate_spline', smoothing=3.0, neighbors=60)(np.c_[GX[inside], GY[inside]])
A = np.c_[SP[:, 0], SP[:, 1], np.ones(len(SP))]; coef = np.linalg.lstsq(A, SP[:, 2], rcond=None)[0]
plane = coef[0] * GX + coef[1] * GY + coef[2]
dist = ndimage.distance_transform_edt(~inside) * RES_D; w_ = np.clip(1 - dist / 40, 0, 1)
Zn = griddata(SP[:, :2], SP[:, 2], (GX, GY), method='nearest')
Z = np.clip(np.where(inside, Zl, w_ * Zn + (1 - w_) * plane), SP[:, 2].min() - 1, SP[:, 2].max() + 1)
Z = ndimage.gaussian_filter(Z, 2.5)
dnear = cKDTree(SP[:, :2]).query(np.c_[GX.ravel(), GY.ravel()])[0].reshape(GX.shape)
ci = ((DY1 - (RY1 - (np.arange(Hd, dtype=np.float32) + 0.5) * R)) / RES_D - 0.5).astype(np.float32)
cj = (((RX0 + (np.arange(Wd, dtype=np.float32) + 0.5) * R) - DX0) / RES_D - 0.5).astype(np.float32)
CRD = np.stack(np.broadcast_arrays(ci[:, None], cj[None, :]))
Zg = ndimage.map_coordinates(Z.astype(np.float32), CRD, order=1, mode='nearest')
IN_g = ndimage.map_coordinates(np.clip((40 - dnear) / 25, 0, 1).astype(np.float32), CRD, order=1, mode='nearest')
del CRD

# ---------- шум ----------
def noise(scale_m, octaves=4, persist=0.5, seed=0):
    """Фрактальный шум; масштаб в метрах (крупная деталь)."""
    g = np.random.default_rng(seed); out = np.zeros((Hd, Wd), np.float32); amp = 1.0; tot = 0
    s = scale_m / R
    for o in range(octaves):
        h, w = max(2, int(Hd / s) + 3), max(2, int(Wd / s) + 3)
        base = g.random((h, w)).astype(np.float32)
        up = ndimage.zoom(base, (Hd / (h - 2), Wd / (w - 2)), order=3)[:Hd, :Wd]
        if up.shape != (Hd, Wd): up = np.pad(up, ((0, Hd - up.shape[0]), (0, Wd - up.shape[1])), mode='edge')
        out += amp * up; tot += amp; amp *= persist; s = max(2, s / 2)
    out /= tot; return (out - out.min()) / (out.max() - out.min() + 1e-6)

M_zoo = mask(polys([zoo_b]))
M_water = mask(polys(water + base_poly({'water', 'pool'})))
M_wood = mask(polys(base_poly({'wood'})))
M_area = mask(polys(base_poly({'play', 'pitch', 'parking', 'resid'})))
roads = base_line('road-'); RW = {'primary': 12, 'secondary': 10, 'tertiary': 8, 'residential': 6, 'living_street': 5, 'unclassified': 6, 'service': 4, 'pedestrian': 6}
M_road = np.zeros((Hd, Wd), bool)
for k, wdt in RW.items(): M_road |= mask(lines([p for c, p in roads if c.endswith(k)], wdt))
M_foot = mask(lines([p for c, p in base_line('foot')], 2.2))
print('маски', flush=True)

# ---------- 1. земля и газоны ----------
n_big = noise(44, 4, 0.55, 1); n_mid = noise(9, 3, 0.5, 2); n_fine = noise(1.2, 2, 0.5, 3)
lush, mid, olive, dry, soil = [np.array(c, np.float32) for c in ((88, 142, 58), (110, 156, 66), (138, 152, 80), (168, 160, 108), (150, 132, 98))]
zrel = (Zg - Zg.min()) / (Zg.max() - Zg.min() + 1e-6)
t = np.clip(0.55 * n_big + 0.25 * n_mid + 0.25 * zrel - 0.05, 0, 1); del n_big, zrel
def lerp(a, b, k): return a * (1 - k[..., None]) + b * k[..., None]
img = lerp(lush, mid, np.clip(t * 2, 0, 1))
img = np.where((t < 0.5)[..., None], img, lerp(mid, olive, np.clip(t * 2 - 1, 0, 1)))
img = lerp(img, dry, np.clip((n_mid - 0.72) * 4, 0, 1) * np.clip(t * 1.6 - 0.4, 0, 1) * 0.75)
img = lerp(img, soil, np.clip((n_fine - 0.86) * 6, 0, 1) * np.clip(t - 0.3, 0, 1) * 0.5); del t
img *= (0.93 + 0.12 * n_fine + 0.05 * (rng.random((Hd, Wd), dtype=np.float32) - 0.5))[..., None]; del n_fine
und = np.array((64, 104, 48), np.float32)
wk = ndimage.gaussian_filter((M_wood & M_zoo).astype(np.float32), 25 * PX) * (0.75 + 0.5 * n_mid); del n_mid
img = lerp(img, und, np.clip(wk, 0, 1) * 0.32); del wk
outz = ~M_zoo
gray = img[outz].mean(1, keepdims=True)
img[outz] = img[outz] * 0.45 + gray * 0.35 + np.array((205, 210, 195), np.float32) * 0.2; del gray
img[M_area & outz] = (214, 214, 208)
img[M_road & outz] = (204, 204, 200); img[M_foot & outz & ~M_road] = (215, 210, 196)
az, alt = math.radians(315), math.radians(45)
dzdy, dzdx = np.gradient(Zg * 2.0, R)
lx, ly, lz = math.cos(alt) * math.sin(az), math.cos(alt) * math.cos(az), math.sin(alt)
hs = (-dzdx * lx + dzdy * ly + lz) / np.sqrt(dzdx ** 2 + dzdy ** 2 + 1) / math.sin(alt); del dzdx, dzdy
hs = 1 + (np.clip(hs, 0.6, 1.25) - 1) * IN_g
img *= hs[..., None] ** 0.8; del hs
print('земля', flush=True)

# ---------- 2. вода ----------
dw = ndimage.distance_transform_edt(M_water) * R
k = np.clip(dw / 7.0, 0, 1) ** 0.8; del dw
wcol = lerp(np.array((118, 196, 186), np.float32), np.array((22, 104, 128), np.float32), k)
rip = noise(2.8, 3, 0.5, 7)
ripple = np.sin((np.arange(Hd, dtype=np.float32)[:, None] * 0.9 / PX + rip * 18)) * 0.5 + 0.5
wcol *= (0.95 + 0.07 * ripple * (0.4 + 0.6 * k))[..., None]; del ripple
glint = (rip > 0.88) & (k > 0.4); del rip, k
wcol[glint] = wcol[glint] * 0.88 + 255 * 0.12; del glint
img[M_water] = wcol[M_water]; del wcol
shore = M_water & ~ndimage.binary_erosion(M_water, iterations=it(1))
img[shore] = img[shore] * 0.55 + np.array((70, 90, 60)) * 0.45
wet = ndimage.binary_dilation(M_water, iterations=it(4)) & ~M_water
img[wet] *= 0.9; del shore, wet
print('вода', flush=True)

# ---------- 3. дорожки внутри зоопарка (до теней — тени ложатся и на них) ----------
M_path = mask(lines(paths, 2.8)) | mask(lines([p for c, p in base_line('foot')], 2.2)) | mask(lines([p for c, p in base_line('steps')], 2.5))
M_PATHS = (M_path | M_road) & M_zoo; del M_path
outer = ndimage.binary_dilation(M_PATHS, iterations=it(1)) & ~M_PATHS
img[outer] = (168, 150, 118)
pn = noise(1.5, 2, 0.5, 21)
img[M_PATHS] = np.array((228, 216, 190), np.float32)[None, :] * (0.96 + 0.06 * pn[M_PATHS])[:, None]; del pn
del outer

# ---------- 4. высоты зданий и крон (для теней) ----------
Hobj = np.zeros((Hd, Wd), np.float32)
def crop_mask(p, pad=2):
    q = [P2(c) for c in p]; xs = [a for a, b in q]; ys = [b for a, b in q]
    j0, i0 = max(0, int(min(xs)) - pad), max(0, int(min(ys)) - pad); j1, i1 = min(Wd, int(max(xs)) + pad + 1), min(Hd, int(max(ys)) + pad + 1)
    if j0 >= j1 or i0 >= i1: return None
    im = Image.new('L', (j1 - j0, i1 - i0), 0); ImageDraw.Draw(im).polygon([(a - j0, b - i0) for a, b in q], fill=255)
    mm = np.array(im) > 0
    return (i0, i1, j0, j1, mm) if mm.any() else None
roof_layers = []
for i, p in enumerate(bld):
    poly = Polygon(p)
    if poly.area < 2: continue
    a = poly.area; h = 4.0 if a < 60 else 5.0 if a < 300 else 6.0
    cm = crop_mask(p)
    if cm is None: continue
    i0, i1, j0, j1, mm = cm
    sub = Hobj[i0:i1, j0:j1]; sub[mm] = np.maximum(sub[mm], h)
    circ = 4 * math.pi * a / poly.length ** 2
    rect = poly.minimum_rotated_rectangle; rc = list(rect.exterior.coords)
    e1 = np.subtract(rc[1], rc[0]); e2 = np.subtract(rc[2], rc[1]); L1, L2 = np.hypot(*e1), np.hypot(*e2)
    kind = 'cone' if circ > 0.85 and a > 50 else 'gable' if (a / rect.area > 0.88 and min(L1, L2) <= 14 and a < 600) else 'flat'
    roof_layers.append((cm, bmat[i], kind, poly, (e1, e2, L1, L2), h))
TREE_G = [np.array(c, np.float32) for c in ((46, 96, 42), (60, 112, 48), (38, 86, 46), (74, 118, 52))]
tree_list = []
for k_, (x, y) in enumerate(trees):
    r_m = rng.uniform(2.0, 3.6); th = rng.uniform(6.0, 10.0); col = TREE_G[rng.integers(0, 4)] * rng.uniform(0.92, 1.08)
    cx, cy = P2((x, y)); r = r_m / R
    i0, i1 = int(max(0, cy - r * 1.2 - 1)), int(min(Hd, cy + r * 1.2 + 2)); j0, j1 = int(max(0, cx - r * 1.2 - 1)), int(min(Wd, cx + r * 1.2 + 2))
    if i0 >= i1 or j0 >= j1: continue
    yy, xx = np.mgrid[i0:i1, j0:j1]
    ang = np.arctan2(yy - cy, xx - cx)
    rr = r * (1 + 0.10 * np.sin(5 * ang + k_) + 0.06 * np.sin(9 * ang + 2 * k_))
    d2 = ((xx - cx) ** 2 + (yy - cy) ** 2) / rr ** 2
    inn = d2 <= 1
    hh = th * (0.55 + 0.45 * np.sqrt(np.clip(1 - d2, 0, 1)))
    sub = Hobj[i0:i1, j0:j1]; sub[inn] = np.maximum(sub[inn], hh[inn])
    tree_list.append((i0, i1, j0, j1, cx, cy, rr, inn, col))
print('здания', len(roof_layers), 'деревья', len(tree_list), flush=True)

# ---------- 5. тени: солнце 45° с северо-запада ----------
dirx, diry = math.sin(az), -math.cos(az)
shadow = np.zeros((Hd, Wd), bool); tanA = math.tan(alt); step = R * math.hypot(dirx, diry)
sh = np.empty((Hd, Wd), np.float32)
for k_ in range(1, int(10.5 / (step * tanA)) + 2):
    sx, sy = int(round(dirx * k_)), int(round(diry * k_))
    ys0, ys1 = max(0, -sy), min(Hd, Hd - sy); xs0, xs1 = max(0, -sx), min(Wd, Wd - sx)
    sh.fill(0); sh[ys0:ys1, xs0:xs1] = Hobj[ys0 + sy:ys1 + sy, xs0 + sx:xs1 + sx]
    sh -= k_ * step * tanA
    shadow |= sh > Hobj + 0.05
del sh
soft = ndimage.gaussian_filter(shadow.astype(np.float32), 2.2 * PX); del shadow
ao = ndimage.gaussian_filter((Hobj > 0.5).astype(np.float32), 6 * PX) * 0.18
shade = 1 - 0.45 * soft - ao; del ao
img *= shade[..., None]; del shade
img[M_water] = img[M_water] * np.array((0.98, 1.0, 1.04), np.float32)
print('тени', flush=True)

# ---------- 6. кроны (над дорожкой — полупрозрачные, дорожка читается) ----------
leaf = noise(0.8, 2, 0.6, 11)
for i0, i1, j0, j1, cx, cy, rr, inn, col in sorted(tree_list, key=lambda t: t[5]):
    yy, xx = np.mgrid[i0:i1, j0:j1]
    dx, dy = (xx - cx) / rr, (yy - cy) / rr
    nz = np.sqrt(np.clip(1 - dx ** 2 - dy ** 2, 0, 1))
    lit = np.clip((dx * lx + (-dy) * ly + nz * lz) / lz, 0.45, 1.35)
    lv_ = leaf[i0:i1, j0:j1]
    c = col[None, None, :] * (lit * (0.82 + 0.3 * lv_))[..., None]
    c[(lv_ > 0.78) & (lit > 1.05)] *= 1.12
    c[inn & ((dx ** 2 + dy ** 2) > 0.82)] *= 0.8
    a = np.where(M_PATHS[i0:i1, j0:j1], 0.45, 1.0)[..., None]
    sub = img[i0:i1, j0:j1]; sub[inn] = (c * a + sub * (1 - a))[inn]
del leaf
print('кроны', flush=True)

# ---------- 7. ограды и подпорные стенки (без теней) ----------
M_fence = mask(lines(fences, 0.25)) | mask(lines(walls, 0.4))
img[M_fence] = (48, 48, 44); del M_fence

# ---------- 8. крыши (поверх всего; на крышах — тени от более высоких крон) ----------
PAL = {'terracotta': (182, 98, 66), 'pink': (196, 120, 110), 'slate': (104, 112, 120), 'metal': (186, 190, 192), 'green': (96, 132, 100), 'membrane': (150, 150, 146)}
lv = np.array((lx, ly, lz))
for (i0, i1, j0, j1, mm), mat, kind, poly, (e1, e2, L1, L2), h in roof_layers:
    base = np.array(PAL[mat], np.float32)
    ys, xs = np.nonzero(mm); Xm = RX0 + (xs + j0 + 0.5) * R; Ym = RY1 - (ys + i0 + 0.5) * R
    if kind == 'gable':
        ax = e1 / L1 if L1 >= L2 else e2 / L2
        nrm = np.array((-ax[1], ax[0])); c = np.array(poly.minimum_rotated_rectangle.centroid.coords[0])
        s = (Xm - c[0]) * nrm[0] + (Ym - c[1]) * nrm[1]
        n3 = np.c_[np.sign(s) * nrm[0] * 0.6, np.sign(s) * nrm[1] * 0.6, np.ones(len(s))]; n3 /= np.linalg.norm(n3, axis=1)[:, None]
        col = base[None, :] * np.clip(n3 @ lv / lz, 0.6, 1.3)[:, None]
        col *= (0.94 + 0.06 * (np.sin(np.abs(s) / 0.35 * math.pi) > 0))[:, None]
        col[np.abs(s) < 0.22] = np.minimum(base * 1.25, 255)
    elif kind == 'cone':
        c = np.array(poly.centroid.coords[0]); vx, vy = Xm - c[0], Ym - c[1]; rr = np.hypot(vx, vy) + 1e-6
        n3 = np.c_[vx / rr * 0.5, vy / rr * 0.5, np.ones(len(rr))]; n3 /= np.linalg.norm(n3, axis=1)[:, None]
        col = base[None, :] * np.clip(n3 @ lv / lz, 0.65, 1.3)[:, None] * (0.95 + 0.05 * (np.sin(np.arctan2(vy, vx) * 48) > 0))[:, None]
    else:
        ax = e1 / L1 if L1 >= L2 else e2 / L2
        along = (Xm * ax[1] - Ym * ax[0])
        tex = 0.95 + 0.05 * (np.sin(along / 0.6 * math.pi) > 0.6) if mat in ('metal', 'slate', 'green') else 0.93 + 0.07 * rng.random(len(along))
        col = base[None, :] * tex[:, None]
    sub = img[i0:i1, j0:j1]
    sub[ys, xs] = col * (1 - 0.45 * soft[i0:i1, j0:j1][ys, xs])[:, None]
    edge = mm & ~ndimage.binary_erosion(mm, iterations=it(2))
    sub[edge] *= 0.72
    hi = mm & ~ndimage.binary_erosion(mm, iterations=it(3)) & ~edge & ndimage.shift(~mm, (it(2), it(2)), order=0, cval=True)
    sub[hi] = np.minimum(sub[hi] * 1.15, 255)
del soft
print('крыши', flush=True)

# ---------- 9. край по внешней ограде: чёткий, сглаженный на 1 пиксель ----------
M_edge = mask(polys([list(Polygon(zoo_b).buffer(0.5, join_style=2).exterior.coords)]))
sd = ndimage.distance_transform_edt(M_edge) - ndimage.distance_transform_edt(~M_edge)
alpha = (np.clip(sd + 0.5, 0, 1) * 255).astype(np.uint8); del sd
rgba = np.dstack([img.clip(0, 255).astype(np.uint8), alpha]); del img
Image.fromarray(rgba, 'RGBA').save(OUT, compress_level=1)
la0, lo0 = ll(RX0, RY0); la1, lo1 = ll(RX1, RY1)
json.dump({'width': Wd, 'height': Hd, 'metersPerPixel': R, 'center': SRC['center'],
           'frameMeters': [RX0, RY0, RX1, RY1], 'bounds': [[la0, lo0], [la1, lo1]]},
          open(os.path.splitext(OUT)[0] + '.json', 'w'), indent=1)
print('готово:', OUT, flush=True)
