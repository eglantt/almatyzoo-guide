"""Город вокруг зоопарка для своей карты-подложки (0.1.9).

Вход:  src/osm-area.json — выгрузка OpenStreetMap (overpass-turbo, отфильтрована), © участники OpenStreetMap, ODbL.
Выход: ../../map/base.json — {"v":1, "features":[{"c":класс,"t":"p"|"l","g":координаты}], "labels":[...]}

Каждый объект получает класс отрисовки (resid, grass, park, wood, pitch, play, parking, pool, water, bld,
fenceArea, river, stream, road-<тип>, foot, steps, fence, hedge). Координаты — [широта, долгота], 5 знаков (~1 м),
обрезка по рамке карты (meta.bounds из data.json) с запасом 5 %. Внутри зоопарка здания и вода из OSM не берутся:
там они из топосъёмки (map/topo.json).

Подписи улиц: точка улицы, ближайшая к центру зоопарка (отрезок не короче 40 м), и угол по направлению улицы.
Названия — в data.json (ui.street_<id>) на трёх языках.

Запуск из корня репозитория: python3 tools/basemap/build_base.py
"""
import json, math, os, sys
from shapely.geometry import shape, mapping, box, Point
from shapely.validation import make_valid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(os.path.dirname(__file__), 'src', 'osm-area.json')
OUT = os.path.join(ROOT, 'map', 'base.json')
data = json.load(open(os.path.join(ROOT, 'data.json'), encoding='utf-8'))
osm = json.load(open(SRC, encoding='utf-8'))

(s, w), (n, e) = data['meta']['bounds']
pad_y, pad_x = (n - s) * 0.05, (e - w) * 0.05
CLIP = box(w - pad_x, s - pad_y, e + pad_x, n + pad_y)
ZOO = shape({'type': 'Polygon', 'coordinates': [[[p[1], p[0]] for p in data['meta']['boundary']]]})

ROADS = {'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'residential', 'living_street', 'unclassified', 'service', 'pedestrian'}


def area_class(p):
    if p.get('landuse') in ('residential', 'commercial', 'retail'): return 'resid'
    if p.get('natural') == 'wood' or p.get('landuse') == 'forest': return 'wood'
    if p.get('landuse') in ('grass', 'flowerbed') or p.get('natural') in ('grassland', 'shrub', 'scrub'): return 'grass'
    if p.get('leisure') in ('park', 'garden'): return 'park'
    if p.get('leisure') == 'pitch': return 'pitch'
    if p.get('leisure') == 'playground': return 'play'
    if p.get('amenity') == 'parking': return 'parking'
    if p.get('leisure') == 'swimming_pool': return 'pool'
    if p.get('natural') == 'water' or p.get('water') or p.get('waterway') == 'riverbank': return 'water'
    if p.get('building'): return 'bld'
    if p.get('barrier') in ('fence', 'wall'): return 'fenceArea'
    return None


def line_class(p):
    h = p.get('highway')
    if h in ROADS: return 'road-' + h
    if h == 'steps': return 'steps'
    if h in ('footway', 'path', 'cycleway'): return 'foot'
    if p.get('waterway') == 'river': return 'river'
    if p.get('waterway'): return 'stream'
    if p.get('barrier') == 'hedge': return 'hedge'
    if p.get('barrier') in ('fence', 'wall', 'retaining_wall'): return 'fence'
    return None


def rnd(geom):
    """GeoJSON-координаты (долгота, широта) → [широта, долгота], 5 знаков."""
    t = geom['type']
    if t == 'LineString': return [[round(c[1], 5), round(c[0], 5)] for c in geom['coordinates']]
    if t == 'Polygon': return [[[round(c[1], 5), round(c[0], 5)] for c in ring] for ring in geom['coordinates']]
    raise ValueError(t)


def parts(g):
    return list(g.geoms) if hasattr(g, 'geoms') else [g]


out = []
for f in osm['features']:
    p, gt = f['properties'], f['geometry']['type']
    if gt == 'Point': continue
    if p.get('tourism') == 'zoo': continue                       # граница зоопарка — из data.json
    if 'Polygon' in gt:
        c = area_class(p)
        if not c: continue
        g = make_valid(shape(f['geometry']))
        if c in ('bld', 'water') and ZOO.contains(g.representative_point()): continue
        g = g.intersection(CLIP)
        for q in parts(g):
            if q.geom_type == 'Polygon' and not q.is_empty and q.area > 0:
                out.append({'c': c, 't': 'p', 'g': rnd(mapping(q))})
    elif gt == 'LineString':
        c = line_class(p)
        if not c: continue
        g = shape(f['geometry']).intersection(CLIP)
        for q in parts(g):
            if q.geom_type == 'LineString' and not q.is_empty:
                o = {'c': c, 't': 'l', 'g': rnd(mapping(q))}
                if p.get('name') and c.startswith('road-'): o['n'] = p.get('name:ru') or p['name']
                out.append(o)

# Порядок отрисовки задаёт приложение; здесь — только стабильная сортировка по классу.
ORDER = ['resid', 'grass', 'park', 'wood', 'pitch', 'play', 'parking', 'pool', 'water', 'bld', 'fenceArea', 'river', 'stream']
out.sort(key=lambda o: ORDER.index(o['c']) if o['c'] in ORDER else len(ORDER))

# Подписи трёх улиц вокруг зоопарка
lat0, lng0 = data['meta']['center']
k = math.cos(math.radians(lat0))
STREETS = [('yesenberlin', 'Есенберлин'), ('ormanov', 'Орманов'), ('aport', 'Апорт')]
labels = []
for sid, stem in STREETS:
    best = None
    for o in out:
        if 'n' not in o or stem not in o['n']: continue
        c = o['g']
        for a, b in zip(c, c[1:]):
            ax, ay, bx, by = a[1] * k, a[0], b[1] * k, b[0]
            px, py = lng0 * k, lat0
            dx, dy = bx - ax, by - ay
            l2 = dx * dx + dy * dy
            if math.sqrt(l2) * 111320 < 40: continue                  # короткие отрезки не годятся под подпись
            t = max(0.2, min(0.8, ((px - ax) * dx + (py - ay) * dy) / l2))
            x, y = ax + t * dx, ay + t * dy
            d = math.hypot(px - x, py - y)
            if best is None or d < best[0]: best = (d, y, x / k, math.degrees(math.atan2(-dy, dx)))
    if best is None: sys.exit('нет улицы ' + stem)
    ang = best[3]
    if ang > 90: ang -= 180
    if ang < -90: ang += 180
    labels.append({'id': sid, 'lat': round(best[1], 6), 'lng': round(best[2], 6), 'a': round(ang, 1)})
for o in out: o.pop('n', None)

json.dump({'v': 1, 'source': '© OpenStreetMap contributors, ODbL', 'features': out, 'labels': labels},
          open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
import collections
print(OUT, os.path.getsize(OUT), 'байт;', len(out), 'объектов;', dict(collections.Counter(o['c'] for o in out)))
print('подписи:', labels)
