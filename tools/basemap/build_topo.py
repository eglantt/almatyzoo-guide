"""Топосъёмка внутри зоопарка для своей карты-подложки (0.1.9).

Вход:  src/topo-inside.json — слои топосъёмки 2019 г. (ТОО «Smart GIS», М 1:500), привязанные к GPS:
       здания (bld), водоёмы (water), ограды (fence — штрихами, как на чертеже), подпорные стенки (wall).
       Снесённое сооружение у хищных птиц уже исключено.
       src/osm-area.json — для зон из hide.json вида osmAround.
       hide.json — где убрать ограды.
Выход: ../../map/topo.json — {"v":1, "features":[{"c":"tbld"|"twater"|"tfence"|"twall","t":"p"|"l","g":[[широта,долгота],…]}]}

Ограды и стенки сглаживаются: штрихи сливаются в сплошную линию (растр 0,2 м, утолщение, скелет, трассировка),
двойные линии — в одну; линия выпрямляется (Дуглас — Пекер). Короткие хвостики отбрасываются.

Запуск из корня репозитория: python3 tools/basemap/build_topo.py
"""
import json, os, math, warnings
import numpy as np
from shapely.geometry import shape, mapping, LineString, Point
from shapely.ops import transform, unary_union, linemerge
from skimage.draw import line as dline
from skimage.morphology import skeletonize, dilation, disk

warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
D = json.load(open(os.path.join(HERE, 'src', 'topo-inside.json'), encoding='utf-8'))
OSM = json.load(open(os.path.join(HERE, 'src', 'osm-area.json'), encoding='utf-8'))
HIDE = json.load(open(os.path.join(HERE, 'hide.json'), encoding='utf-8'))
data = json.load(open(os.path.join(ROOT, 'data.json'), encoding='utf-8'))
OUT = os.path.join(ROOT, 'map', 'topo.json')

lat0, lng0 = data['meta']['center']
KX, KY = 111320 * math.cos(math.radians(lat0)), 111320
tom = lambda x, y, z=None: ((x - lng0) * KX, (y - lat0) * KY)              # долгота/широта → метры от центра
pt = lambda lat, lng: Point(*tom(lng, lat))

feats = {'bld': [], 'water': [], 'fence': [], 'wall': []}
for f in D['features']: feats[f['properties']['topo']].append(transform(tom, shape(f['geometry'])))

# --- зоны, где ограды убираются
osm_polys = [transform(tom, shape(f['geometry'])) for f in OSM['features']
             if ('building' in f['properties'] or f['properties'].get('tourism') == 'attraction') and f['geometry']['type'] == 'Polygon']
hide = []
for z in HIDE['zones']:
    if 'osmAround' in z:
        c = pt(*z['osmAround'])
        near = [g for g in osm_polys if g.distance(c) < 45]
        core = min((g for g in near if g.contains(c)), key=lambda g: g.area)
        ring = [g for g in near if g.distance(core) < 3]
        hide.append(unary_union(ring).buffer(z.get('buffer', 2.0)))
    elif 'circle' in z:
        lat, lng, r = z['circle']
        hide.append(pt(lat, lng).buffer(r))
HIDE_ALL = unary_union(hide) if hide else None

RES = 0.2


def vectorize(lines, rad, tol, minlen):
    """Штрихи → сплошные линии: растр, утолщение на rad пикселей, скелет, трассировка, слияние, упрощение."""
    allc = np.array([c for g in lines for c in g.coords])
    x0, y0 = allc.min(0) - 5
    x1, y1 = allc.max(0) + 5
    W, H = int((x1 - x0) / RES) + 1, int((y1 - y0) / RES) + 1
    im = np.zeros((H, W), bool)
    px = lambda c: (int((c[1] - y0) / RES), int((c[0] - x0) / RES))
    for g in lines:
        cs = list(g.coords)
        for a, b in zip(cs, cs[1:]):
            r, c = dline(*px(a), *px(b)); im[r, c] = True
    sk = skeletonize(dilation(im, disk(rad)))
    ys, xs = np.nonzero(sk)
    S = set(zip(ys.tolist(), xs.tolist()))
    nb = lambda p: [(p[0] + dy, p[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (p[0] + dy, p[1] + dx) in S]
    deg = {p: len(nb(p)) for p in S}
    seen, paths = set(), []

    def walk(a, b):
        path = [a, b]; seen.add(frozenset((a, b)))
        while deg[path[-1]] == 2:
            nx = [q for q in nb(path[-1]) if frozenset((path[-1], q)) not in seen]
            if not nx: break
            seen.add(frozenset((path[-1], nx[0]))); path.append(nx[0])
        return path
    for p in S:
        if deg[p] != 2:
            for q in nb(p):
                if frozenset((p, q)) not in seen: paths.append(walk(p, q))
    for p in S:                                                              # замкнутые кольца
        for q in nb(p):
            if frozenset((p, q)) not in seen: paths.append(walk(p, q))
    keep = []
    for pth in paths:
        ls = LineString([(x0 + c * RES, y0 + r * RES) for r, c in pth])
        spur = deg[pth[0]] == 1 or deg[pth[-1]] == 1                         # хвостик скелета или отдельный штрих
        if spur and ls.length < minlen: continue
        keep.append(ls)
    m = linemerge(unary_union(keep))
    return [g.simplify(tol) for g in (m.geoms if hasattr(m, 'geoms') else [m]) if g.length >= 0.6]


fence_src = [g for g in feats['fence'] if HIDE_ALL is None or not HIDE_ALL.contains(g)]
fs = vectorize(fence_src, 4, 0.45, 1.6)          # штрихи до ~0,8 м сливаются, двойные линии — в одну
ws = vectorize(feats['wall'], 2, 0.3, 1.0)
if HIDE_ALL is not None:
    clip = []
    for g in fs:
        d = g.difference(HIDE_ALL)
        for q in (d.geoms if hasattr(d, 'geoms') else [d]):
            if not q.is_empty and q.length >= 3.0: clip.append(q)
    fs = clip

toll = lambda x, y: [round(lat0 + y / KY, 6), round(lng0 + x / KX, 6)]
out = []
for g in feats['water']: out.append({'c': 'twater', 't': 'p', 'g': [[toll(*c) for c in g.exterior.coords]]})
for g in feats['bld']: out.append({'c': 'tbld', 't': 'p', 'g': [[toll(*c) for c in g.exterior.coords]]})
for g in ws: out.append({'c': 'twall', 't': 'l', 'g': [toll(*c) for c in g.coords]})
for g in fs: out.append({'c': 'tfence', 't': 'l', 'g': [toll(*c) for c in g.coords]})
json.dump({'v': 1, 'source': 'Топосъёмка 2019, Алматинский зоопарк', 'features': out},
          open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
import collections
print(OUT, os.path.getsize(OUT), 'байт;', dict(collections.Counter(o['c'] for o in out)))
