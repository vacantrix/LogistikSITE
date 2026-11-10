"""Мосты через разрывы маршрута: локальная Дейкстра по z14-тайлам.

Для каждого прыжка > 300 м в /tmp/route-final.json вырезаем bbox ±700 м,
собираем transportation z14, строим локальный граф и ищем путь a->b.
Найденную геометрию подставляем вместо прямого прыжка.
"""
import json
import math
import sys
from collections import defaultdict

sys.path.insert(0, '/home/z/my-project/scripts')
from stitch_a146 import collect_layer  # noqa: E402
from router import split_at_projections, build_graph, hav, CLASS_PENALTY  # noqa: E402
from build_route import dijkstra_pieces, nearest_piece, simplify_dp  # noqa: E402


def local_graph(bbox):
    tr = collect_layer(14, bbox, 'transportation')
    prep = []
    for f in tr:
        cls = f['props'].get('class')
        if cls in ('rail', 'ferry', 'path', 'footway', 'track'):
            continue
        prep.append({'coords': f['coords'], 'props': f['props'], 'w': CLASS_PENALTY.get(cls, 2.5)})
    if not prep:
        return None, None
    prep = split_at_projections(prep, tol_m=35)
    join = build_graph(prep, tol_m=45)
    adj = defaultdict(list)
    for i, e, j, e2 in join:
        adj[(i, e)].append((j, e2))
        adj[(j, e2)].append((i, e))
    return prep, adj


def bridge_gap(a, b):
    pad = 0.010
    lon1 = min(a[0], b[0]) - pad
    lon2 = max(a[0], b[0]) + pad
    lat1 = min(a[1], b[1]) - pad
    lat2 = max(a[1], b[1]) + pad
    prep, adj = local_graph((lon1, lat1, lon2, lat2))
    if prep is None:
        return None
    si, sd = nearest_piece(prep, a)
    ti, td = nearest_piece(prep, b)
    if sd > 350 or td > 350:
        print(f'    концы далеко от дороги: {sd:.0f}м / {td:.0f}м')
    straight = hav(a, b)
    for e_in in (0, 1):
        seg = dijkstra_pieces(prep, adj, (si, e_in), ti)
        if seg is None:
            continue
        L = sum(hav(seg[k - 1], seg[k]) for k in range(1, len(seg)))
        if L <= max(straight * 2.4, straight + 900):
            return seg
    return None


if __name__ == '__main__':
    route = json.load(open('/tmp/route-final.json'))
    print('исходно точек:', len(route))
    out = [route[0]]
    fixed = attempts = 0
    for i in range(1, len(route)):
        a, b = out[-1], route[i]
        d = hav(a, b)
        if d <= 300:
            out.append(b)
            continue
        attempts += 1
        print(f'прыжок {i}: {d:.0f} м, {a} -> {b}')
        seg = bridge_gap(a, b)
        if seg:
            # ориентация
            if hav(out[-1], seg[0]) > hav(out[-1], seg[-1]):
                seg.reverse()
            L = sum(hav(seg[k - 1], seg[k]) for k in range(1, len(seg)))
            print(f'    мост найден: {len(seg)} точек, {L:.0f} м')
            out.extend(seg[1:])
            fixed += 1
        else:
            print('    мост НЕ найден — оставляю прямой')
            out.append(b)
    print(f'мостов: {fixed}/{attempts}')
    L = sum(hav(out[i - 1], out[i]) for i in range(1, len(out)))
    print('длина: %.1f км, точек: %d' % (L / 1000, len(out)))
    simp = simplify_dp(out, tol_m=3.0)
    L2 = sum(hav(simp[i - 1], simp[i]) for i in range(1, len(simp)))
    print('после упрощения: %.1f км, точек: %d' % (L2 / 1000, len(simp)))
    json.dump(simp, open('/tmp/route-bridged.json', 'w'))
