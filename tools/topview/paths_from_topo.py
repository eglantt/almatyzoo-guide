"""Дорожки «Вида сверху» (0.1.14, вариант 2 заказчика) → tools/topview/src/topview-paths.json.

1. Ось каждой дорожки OSM (data.json → paths + тропинки, лестницы, проезды OSM из map/base.json) сдвигается в просвет
   между оградами: точки через 1 м — по нормали ±7 м туда, где дальше до оград, зданий, воды и края территории
   (не дальше 3 м — на газоне ось остаётся на месте), со штрафом за сдвиг; сдвиги сглажены вдоль дорожки.
2. Полоса 2,8 м по сдвинутой оси, обрезанная по ограде (только в том же «загоне», что и ось).
3. Из топосъёмки — мощёные площадки рядом с дорожками: участки между краями покрытий (слой SIT_L РЕЛЬЕФ) с буквой
   покрытия «А», «Ц», «Пт» … (слой NAD_M РЕЛЬЕФ), не больше 5000 м²; ширина от 4 м, площадь от 150 м².
Нужны слои PDF топосъёмки (извлечение — рабочие скрипты Claude, в репозиторий PDF не входит): paths.pkl, letters.json.
После правки дорожек в полевом режиме (data.json → paths) — пересобрать: этот скрипт → render.py → tiles.py.
"""
import json, math, pickle, sys, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import LineString, Polygon, shape, mapping
from shapely.ops import unary_union
from skimage import measure

S = '/tmp/claude-0/-home-claude/c52bb0e5-0bae-50b7-9f28-3275cbe7e779/scratchpad'
REPO = '/home/claude/almatyzoo-guide'
D = json.load(open(REPO + '/data.json')); SRC = json.load(open(REPO + '/tools/topview/src/topview-src.json'))
TOPO = json.load(open(REPO + '/map/topo.json')); BASE = json.load(open(REPO + '/map/base.json'))
P = pickle.load(open(S + '/dxf3d/paths.pkl', 'rb'))['layers']
lat0, lng0 = SRC['center']; KX = 111320 * math.cos(math.radians(lat0)); KY = 111320
m = lambda la, lo: ((lo - lng0) * KX, (la - lat0) * KY)

ZOO = Polygon(SRC['zooBoundary'])
R = 0.2
x0, y0, x1, y1 = ZOO.bounds; x0 -= 10; y0 -= 10; x1 += 10; y1 += 10
W, H = int((x1 - x0) / R) + 1, int((y1 - y0) / R) + 1
P2 = lambda c: ((c[0] - x0) / R, (y1 - c[1]) / R)
def draw_lines(lst, wm, im=None):
    im = im or Image.new('L', (W, H), 0); d = ImageDraw.Draw(im); wp = max(1, int(round(wm / R)))
    for p in lst:
        if len(p) > 1: d.line([P2(c) for c in p], fill=255, width=wp)
    return im
def draw_polys(lst, outline_only=False):
    im = Image.new('L', (W, H), 0); d = ImageDraw.Draw(im)
    for p in lst:
        if len(p) > 2: d.polygon([P2(c) for c in p], fill=None if outline_only else 255, outline=255)
    return np.array(im) > 0

edges = [q['pts'] for q in P['SIT_LРЕЛЬЕФ'] if len(q['pts']) > 1 and not q.get('fill')]
water = [[m(*c) for c in f['g'][0]] for f in TOPO['features'] if f['c'] == 'twater']
im = draw_lines(edges, 0.2)
draw_lines(SRC['fences'], 0.2, im)
draw_lines([b['g'] + [b['g'][0]] for b in SRC['buildings']], 0.2, im)
draw_lines([w + [w[0]] for w in water], 0.2, im)
BAR = np.array(im) > 0
M_zoo = draw_polys([SRC['zooBoundary']])
M_bld = draw_polys([b['g'] for b in SRC['buildings']]); M_wat = draw_polys(water)
GROW = int(round(0.5 / R))
BARd = ndimage.binary_dilation(BAR, iterations=GROW) | ~M_zoo | M_bld | M_wat
lab, n = ndimage.label(~BARd)
# отрастить участки обратно в зону утолщения (кроме самих линий-преград)
d_, (ii, jj) = ndimage.distance_transform_edt(lab == 0, return_indices=True)
grow = (lab == 0) & (d_ <= GROW + 1) & M_zoo & ~M_bld & ~M_wat
lab2 = lab.copy(); lab2[grow] = lab[ii[grow], jj[grow]]
print('участков', n, flush=True)

# оси дорожек OSM
paths = [[m(*c) for c in p['coords']] for p in D['paths']]
osm = [[m(*c) for c in f['g']] for f in BASE['features'] if f['t'] == 'l' and (f['c'] in ('foot', 'steps') or f['c'].startswith('road-'))]
axes = [LineString(p).intersection(ZOO) for p in paths + osm]
axes = [g for a in axes for g in getattr(a, 'geoms', [a]) if g.geom_type == 'LineString' and g.length > 1]
AX = np.array(draw_lines([list(g.coords) for g in axes], R)) > 0
dax = ndimage.distance_transform_edt(~AX) * R

idx = np.arange(1, n + 1)
area = ndimage.sum(np.ones_like(lab2), lab2, idx) * R * R
near = ndimage.sum(dax <= 5.0, lab2, idx) * R * R
on = ndimage.sum(AX, lab2, idx) * R                         # длина оси внутри участка, м
# полуширина участка: наибольшее расстояние от его точки до края участка
edge = np.zeros_like(lab2, bool)
edge[:-1] |= lab2[:-1] != lab2[1:]; edge[1:] |= lab2[1:] != lab2[:-1]; edge[:, :-1] |= lab2[:, :-1] != lab2[:, 1:]; edge[:, 1:] |= lab2[:, 1:] != lab2[:, :-1]
half = ndimage.maximum(ndimage.distance_transform_edt(~edge) * R, lab2, idx)
isp = np.zeros(n + 1, bool)
for k in idx:
    a, nr, o, h = area[k - 1], near[k - 1], on[k - 1], half[k - 1]
    if a < 3 or o < 2: continue
    if nr / a >= 0.85 and h <= 6 and a <= max(60, o * 12): isp[k] = True
M_face = isp[lab2]
print('участков-дорожек', isp.sum(), 'площадь м²', int(M_face.sum() * R * R), flush=True)

# участки с буквой покрытия (А — асфальт, Ц — бетон, Пт — плитка, Г …) — мощёные; узкие части таких участков
# (уже 11 м — аллеи между оградами и бордюрами) — дорожка целиком, по краям чертежа. Широкие части (газоны,
# в чертеже не отделённые от аллей, и площади) — только полоса 2,8 м по оси OSM, в пределах участка оси.
LET = json.load(open(S + '/dxf3d/letters.json'))
lid = set()
for x, y, *_ in LET:
    i, j = int((y1 - y) / R), int((x - x0) / R)
    if 0 <= i < H and 0 <= j < W:
        sub = lab2[max(0, i - 5):i + 6, max(0, j - 5):j + 6]; v = sub[sub > 0]
        if v.size: lid.add(int(np.bincount(v).argmax()))
paved = np.zeros(n + 1, bool); paved[list(lid)] = True
M_lab = paved[lab2]
from skimage.morphology import disk
op = ndimage.binary_opening(M_lab, structure=disk(int(5.5 / R)))
M_narrow = M_lab & ~op
M_narrow = ndimage.binary_opening(M_narrow, iterations=2)
# обрывки газона (узкие перешейки) — без оси OSM и без буквы рядом — не дорожка
cl, cn = ndimage.label(M_narrow)
keep = np.zeros(cn + 1, bool)
keep[np.unique(cl[(dax <= 3.0) & (cl > 0)])] = True
for x, y, *_ in LET:
    i, j = int((y1 - y) / R), int((x - x0) / R)
    if 0 <= i < H and 0 <= j < W: keep[np.unique(cl[max(0, i - 10):i + 11, max(0, j - 10):j + 11])] = True
keep[np.where(ndimage.sum(np.ones_like(cl), cl, np.arange(cn + 1)) * R * R >= 120)[0]] = True      # длинные аллеи — даже без оси OSM рядом
keep[0] = False
M_narrow = keep[cl]
# ---- вариант 2 (заказчик, 16.11.2026) ----
# 1) ось OSM сдвигается в аллею между оградами: точка (шаг 1 м) по нормали ±7 м туда, где дальше до оград, зданий,
#    воды и края территории (не дальше 3 м — на газоне ось остаётся), штраф 0,35 за метр сдвига; сдвиги сглажены.
# 2) полоса 2,8 м по сдвинутой оси, обрезанная по ограде: только в том же «загоне», что и ось.
# 3) из топосъёмки — только широкие ровные части мощёных аллей и площадей (ширина от 4 м, площадь от 150 м²),
#    примыкающие к полосам.
FB = np.array(draw_lines(SRC['fences'], 0.2)) > 0
FBAR = FB | M_bld | M_wat | ~M_zoo
dF = ndimage.distance_transform_edt(~FBAR) * R
flab, fn = ndimage.label(~ndimage.binary_dilation(FB, iterations=1) & M_zoo & ~M_bld & ~M_wat)
def sample(arr, xs, ys):
    j = np.clip(((np.asarray(xs) - x0) / R).astype(int), 0, W - 1); i = np.clip(((y1 - np.asarray(ys)) / R).astype(int), 0, H - 1)
    return arr[i, j]
offs = np.arange(-7.0, 7.01, 0.2)
strip = np.zeros_like(M_zoo)
snapped = []
for g in axes:
    L = g.length; k = max(2, int(L // 1.0) + 1)
    pts = np.array([g.interpolate(t).coords[0] for t in np.linspace(0, L, k)])
    tg = np.gradient(pts, axis=0); tg /= np.linalg.norm(tg, axis=1)[:, None] + 1e-9
    nr = np.c_[-tg[:, 1], tg[:, 0]]
    best = np.zeros(len(pts))
    for q in range(len(pts)):
        cx = pts[q, 0] + nr[q, 0] * offs; cy = pts[q, 1] + nr[q, 1] * offs
        sc = np.minimum(sample(dF, cx, cy), 3.0) - 0.35 * np.abs(offs)
        best[q] = offs[int(np.argmax(sc))]
    best = ndimage.median_filter(best, size=9, mode='nearest'); best = ndimage.uniform_filter1d(best, 7, mode='nearest')
    sp = pts + nr * best[:, None]
    snapped.append(sp)
    im = Image.new('L', (W, H), 0); d = ImageDraw.Draw(im)
    d.line([P2(c) for c in sp], fill=255, width=int(round(2.8 / R)), joint='curve')
    for c in (sp[0], sp[-1]):
        cx_, cy_ = P2(c); r = 1.4 / R; d.ellipse([cx_ - r, cy_ - r, cx_ + r, cy_ + r], fill=255)
    sm = np.array(im) > 0
    # загоны, в которых лежит сдвинутая ось
    axm = np.array(draw_lines([sp.tolist()], 1.2)) > 0
    pens = np.unique(flab[axm & (flab > 0)])
    strip |= sm & np.isin(flab, pens)
M_strip = strip & M_zoo & ~M_bld & ~M_wat & ~FB
# широкие ровные части мощёных участков
from skimage.morphology import disk as _disk
farea = np.bincount(lab2.ravel()) * R * R
M_lab_mid = M_lab & (farea[lab2] <= 5000)          # огромный участок, где аллеи слиты с газонами, — не берётся
wide = ndimage.binary_opening(M_lab_mid & ~M_bld & ~M_wat, structure=_disk(int(2.0 / R)))
wl, wn = ndimage.label(wide)
wa = ndimage.sum(np.ones_like(wl), wl, np.arange(wn + 1)) * R * R
touch = np.zeros(wn + 1, bool); touch[np.unique(wl[ndimage.binary_dilation(M_strip, iterations=5) & (wl > 0)])] = True
okw = (wa >= 150) & touch; okw[0] = False
M_wide = okw[wl] & (dax <= 9)          # не дальше 9 м от оси OSM — газоны, слитые с аллеей, не заливаются
M_wide = ndimage.binary_opening(M_wide, structure=_disk(int(1.5 / R)))
M_path = (M_strip | M_wide) & M_zoo & ~M_bld & ~M_wat
print('полосы м²', int(M_strip.sum() * R * R), 'аллеи/площади м²', int((M_wide & ~M_strip).sum() * R * R), flush=True)

# сгладить: без дырочек до 6 м² и крошек до 8 м², края — без «лесенки»
from skimage.morphology import remove_small_holes, remove_small_objects
M_path = remove_small_holes(M_path, int(6 / R / R)); M_path = remove_small_objects(M_path, int(8 / R / R))
M_path = ndimage.gaussian_filter(M_path.astype(np.float32), 1.5) > 0.5
M_path &= M_zoo & ~M_bld & ~M_wat

# в многоугольники
cs = measure.find_contours(np.pad(M_path, 1).astype(float), 0.5)
polys = []
for c in cs:
    if len(c) < 4: continue
    pg = Polygon([(x0 + (cc - 1) * R, y1 - (rr - 1) * R) for rr, cc in c])
    if pg.is_valid and pg.area > 0: polys.append(pg)
# внешние контуры и дыры: even-odd через symmetric difference
geom = None
for pg in sorted(polys, key=lambda g: -g.area):
    geom = pg if geom is None else geom.symmetric_difference(pg)
geom = geom.buffer(0).simplify(0.15)
out = [list(map(lambda r: [[round(x, 2), round(y, 2)] for x, y in r.coords], [g.exterior] + list(g.interiors))) for g in getattr(geom, 'geoms', [geom]) if g.area > 1]
json.dump({'note': 'Дорожки «Вида сверху» (0.1.14, вариант 2): полосы OSM 2,8 м, сдвинутые в просветы между оградами и обрезанные по ограде, + мощёные площадки топосъёмки. Метры от center; [внешний контур, дыры…].',
           'center': SRC['center'], 'areas': out}, open(REPO + '/tools/topview/src/topview-paths.json', 'w'), separators=(',', ':'))
print('многоугольников', len(out))
