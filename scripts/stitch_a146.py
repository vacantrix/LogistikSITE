"""Сшивка оси А-146 из кусков, вырезанных по границам тайлов.

Строит граф по концам линий с допуском, проходит от Абинска к Новороссийску,
выравнивает направление и сохраняет цепочку. Также тянет z13 для детальности.
"""
import json
import math
import sys

sys.path.insert(0, '/home/z/my-project/scripts')
from extract_a146 import fetch_tile, decode_tile, deg2tile, tile2deg  # noqa: E402


def collect_layer(z, bbox, layer):
    lon1, lat1, lon2, lat2 = bbox
    x1, y1 = deg2tile(lon1, lat2, z)
    x2, y2 = deg2tile(lon2, lat1, z)
    feats = []
    for tx in range(int(x1), int(x2) + 1):
        for ty in range(int(y1), int(y2) + 1):
            data = fetch_tile(z, tx, ty)
            if not data:
                continue
            layers = decode_tile(data)
            ox, _ = tile2deg(tx, ty, z)
            _, top_lat = tile2deg(tx, ty, z)
            _, bot_lat = tile2deg(tx, ty + 1, z)
            n = 2 ** z
            for f in layers.get(layer, []):
                for line in f['coords']:
                    if len(line) < 2:
                        continue
                    coords = []
                    for px, py in line:
                        lat = bot_lat + (1 - py / 4096) * (top_lat - bot_lat)
                        lon = ox + (px / 4096) * (360 / n)
                        coords.append((round(lon, 6), round(lat, 6)))
                    feats.append({'props': f['props'], 'coords': coords})
    return feats


def hav(p, q):
    R = 6371000
    dlat = math.radians(q[1] - p[1])
    dlon = math.radians(q[0] - p[0])
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(p[1])) * math.cos(math.radians(q[1])) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def stitch(feats, start_pt, tol_m=45):
    """Жадная сшивка: идём от линии, ближайшей к start_pt, присоединяя куски по концам."""
    remaining = list(range(len(feats)))
    # стартовая линия — ближайшая к start_pt по любому концу
    def end_dist(i, pt):
        c = feats[i]['coords']
        return min(hav(c[0], pt), hav(c[-1], pt))
    cur_i = min(remaining, key=lambda i: end_dist(i, start_pt))
    chain = list(feats[cur_i]['coords'])
    # нормализуем направление: пусть конец ближе к start_pt был началом
    if hav(feats[cur_i]['coords'][-1], start_pt) < hav(feats[cur_i]['coords'][0], start_pt):
        chain.reverse()
    remaining.remove(cur_i)
    stuck = 0
    while remaining and stuck < 3:
        tail = chain[-1]
        best = None
        for i in remaining:
            c = feats[i]['coords']
            d0 = hav(c[0], tail)
            d1 = hav(c[-1], tail)
            d = min(d0, d1)
            if d <= tol_m and (best is None or d < best[0]):
                best = (d, i, d0 <= d1)
        if best is None:
            stuck += 1
            tol_m *= 2.2
            continue
        _, i, forward = best
        c = feats[i]['coords']
        add = c if forward else list(reversed(c))
        chain.extend(add[1:])
        remaining.remove(i)
        stuck = 0
    return chain


if __name__ == '__main__':
    bbox = (37.60, 44.66, 38.30, 44.95)
    print('сбор z13 transportation_name...')
    tn13 = collect_layer(13, bbox, 'transportation_name')
    a146 = [f for f in tn13 if str(f['props'].get('ref', '')) == 'А-146']
    print('z13 А-146 кусков:', len(a146), 'точек:', sum(len(f['coords']) for f in a146))
    json.dump(a146, open('/tmp/a146-z13.json', 'w'))

    # трасса целиком: от восточного края (Абинск/Краснодар) до Новороссийска
    start = (38.147, 44.847)  # ближайший к Абинску конец А-146 (обход с юго-востока)
    chain = stitch(a146, start)
    print('сшито точек:', len(chain))
    print('начало:', chain[0], 'конец:', chain[-1])
    L = sum(hav(chain[i - 1], chain[i]) for i in range(1, len(chain)))
    print('длина цепочки: %.1f км' % (L / 1000))
    json.dump(chain, open('/tmp/a146-chain.json', 'w'))
    # грубый след для контроля
    print('trace:', ' '.join(f"({c[0]:.3f},{c[1]:.3f})" for c in chain[::40]))
