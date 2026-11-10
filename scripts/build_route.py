"""Финальная сборка геометрии маршрута АБЗ «Абинск» -> ул. Дорожная 15 (Новороссийск).

Стратегия: ось А-146 из слоя transportation_name задаёт цепочку waypoint'ов;
между соседними waypoint'ами путь ищется Дейкстрой по графу слоя transportation;
если граф разорван — мостится BFS по реальным кускам дорог, в крайнем случае прямой.
Результат: /tmp/route-final.json
"""
import json
import math
import heapq
import sys
from collections import defaultdict

sys.path.insert(0, '/home/z/my-project/scripts')
from stitch_a146 import collect_layer  # noqa: E402
from router import split_at_projections, build_graph, hav, CLASS_PENALTY  # noqa: E402

ABZ = (38.157, 44.8682)
DEST = (37.760, 44.7255)


def piece_len(pc):
    c = pc['coords']
    return sum(hav(c[k - 1], c[k]) for k in range(1, len(c)))


def dijkstra_pieces(pieces, adj, src_state, dst_piece):
    """src_state=(piece, e_in) — вход через конец e_in. Возвращает [(piece, e_in)...]."""
    INF = float('inf')
    L = [piece_len(p) for p in pieces]
    dist = {(src_state[0], src_state[1]): L[src_state[0]] * pieces[src_state[0]]['w']}
    prev = {(src_state[0], src_state[1]): None}
    pq = [(dist[(src_state[0], src_state[1])], src_state[0], src_state[1])]
    final = None
    while pq:
        c, i, e_in = heapq.heappop(pq)
        if c > dist.get((i, e_in), INF) + 1e-9:
            continue
        if i == dst_piece:
            final = (i, e_in)
            break
        out_end = 1 - e_in
        for j, e2 in adj.get((i, out_end), []):
            nc = c + L[j] * pieces[j]['w']
            if nc < dist.get((j, e2), INF):
                dist[(j, e2)] = nc
                prev[(j, e2)] = (i, e_in)
                heapq.heappush(pq, (nc, j, e2))
    if final is None:
        return None
    seq = []
    cur = final
    while cur is not None:
        seq.append(cur)
        cur = prev[cur]
    seq.reverse()
    coords = []
    for i, e_in in seq:
        c = pieces[i]['coords']
        add = c if e_in == 0 else list(reversed(c))
        if coords:
            add = add[1:]
        coords.extend([list(p) for p in add])
    return coords


def nearest_piece(pieces, pt, subset=None):
    b, bd = None, 1e18
    idx = subset if subset is not None else range(len(pieces))
    for i in idx:
        c = pieces[i]['coords']
        for p2 in (c[0], c[-1]):
            d = hav(p2, pt)
            if d < bd:
                b, bd = i, d
    return b, bd


def bfs_bridge(pieces, adj, src_i, dst_i, max_depth=10):
    """BFS по графу от куска src_i к dst_i — возвращает геометрию или None.
    Игнорирует веса (классы) — только топологическая связность."""
    from collections import deque
    q = deque([(src_i, None if src_i == src_i else 0)])
    # состояние (piece, вход-конец); начальный вход — любой
    seen = {(src_i, 0), (src_i, 1)}
    prev = {}
    q = deque()
    q.append((src_i, 0))
    q.append((src_i, 1))
    final = None
    depth_guard = 0
    while q:
        i, e_in = q.popleft()
        depth_guard += 1
        if depth_guard > 60000:
            break
        if i == dst_i:
            final = (i, e_in)
            break
        out_end = 1 - e_in
        for j, e2 in adj.get((i, out_end), []):
            if (j, e2) not in seen:
                seen.add((j, e2))
                prev[(j, e2)] = (i, e_in)
                q.append((j, e2))
    if final is None:
        return None
    seq = []
    cur = final
    while cur is not None:
        seq.append(cur)
        cur = prev.get(cur)
    seq.reverse()
    coords = []
    for i, e_in in seq:
        c = pieces[i]['coords']
        add = c if e_in == 0 else list(reversed(c))
        if coords:
            add = add[1:]
        coords.extend([list(p) for p in add])
    return coords


def simplify_dp(coords, tol_m=2.5):
    """Дуглас-Пекер."""
    if len(coords) < 3:
        return coords
    def seg_dist(p, a, b):
        ax, ay = a[0], a[1]
        bx, by = b[0] - a[0], b[1] - a[1]
        L2 = bx * bx + by * by
        if L2 == 0:
            return hav(p, a)
        t = max(0.0, min(1.0, ((p[0] - ax) * bx + (p[1] - ay) * by) / L2))
        return hav(p, (ax + bx * t, ay + by * t))
    keep = [0, len(coords) - 1]
    stack = [(0, len(coords) - 1)]
    while stack:
        i0, i1 = stack.pop()
        if i1 <= i0 + 1:
            continue
        dmax, imax = -1, -1
        for k in range(i0 + 1, i1):
            d = seg_dist(coords[k], coords[i0], coords[i1])
            if d > dmax:
                dmax, imax = d, k
        if dmax > tol_m:
            keep.append(imax)
            stack.append((i0, imax))
            stack.append((imax, i1))
    keep.sort()
    return [coords[i] for i in keep]


if __name__ == '__main__':
    bbox = (37.60, 44.66, 38.30, 44.95)
    print('сбор z13...')
    tr = collect_layer(13, bbox, 'transportation')
    prep = []
    for f in tr:
        cls = f['props'].get('class')
        if cls in ('rail', 'ferry', 'path', 'footway', 'track'):
            continue
        prep.append({'coords': f['coords'], 'props': f['props'], 'w': CLASS_PENALTY.get(cls, 2.5)})
    print('кусков:', len(prep))
    prep = split_at_projections(prep, tol_m=30)
    print('после сплитов:', len(prep))
    join = build_graph(prep, tol_m=50)
    adj = defaultdict(list)
    for i, e, j, e2 in join:
        adj[(i, e)].append((j, e2))
        adj[(j, e2)].append((i, e))
    print('стыков:', len(join))

    # waypoint'ы вдоль оси А-146 (с Абинска на запад, к Новороссийску;
    # восточная ветка на Краснодар — исключена)
    a146 = json.load(open('/tmp/a146-z13.json'))
    a146 = [f for f in a146 if f['coords'][0][0] <= 38.16]
    wp_pts = [ABZ]
    for f in sorted(a146, key=lambda f: -f['coords'][0][0]):
        c = f['coords']
        mid = c[len(c) // 2]
        wp_pts.append((mid[0], mid[1]))
    wp_pts.append(DEST)
    # прореживаем: оставляем точки на расстоянии >= 1.2 км друг от друга
    thin = [wp_pts[0]]
    for p in wp_pts[1:]:
        if hav(thin[-1], p) >= 1200:
            thin.append(p)
    if hav(thin[-1], DEST) > 300:
        thin.append(DEST)
    print('waypoint\'ов:', len(thin))

    full = []
    stats = {'dij': 0, 'bfs': 0, 'straight': 0}
    for n in range(len(thin) - 1):
        a, b = thin[n], thin[n + 1]
        si, _ = nearest_piece(prep, a)
        ti, _ = nearest_piece(prep, b)
        # Дейкстра по графу
        seg = dijkstra_pieces(prep, adj, (si, 0), ti)
        if seg is None:
            seg = dijkstra_pieces(prep, adj, (si, 1), ti)
        straight = hav(a, b)
        mode = '?'
        if seg is not None:
            L = sum(hav(seg[k - 1], seg[k]) for k in range(1, len(seg)))
            if L <= max(straight * 2.5, straight + 800):
                mode = 'Dij'
            else:
                seg = None
        if seg is None:
            # BFS без весов
            seg = bfs_bridge(prep, adj, si, ti)
            if seg is not None:
                L = sum(hav(seg[k - 1], seg[k]) for k in range(1, len(seg)))
                if L <= max(straight * 3, straight + 1200):
                    mode = 'BFS'
                else:
                    seg = None
        if seg is None:
            seg = [[a[0], a[1]], [b[0], b[1]]]
            mode = 'STRAIGHT'
        print(f'  seg {n}: {mode}, прямая {straight:.0f} м')
        if full:
            # стыковка: ближайший конец сегмента к хвосту
            if hav(full[-1], seg[0]) > hav(full[-1], seg[-1]):
                seg.reverse()
            full.extend(seg[1:])
        else:
            full.extend(seg)
    L = sum(hav(full[i - 1], full[i]) for i in range(1, len(full)))
    print('полная длина: %.1f км, точек: %d' % (L / 1000, len(full)))
    simp = simplify_dp(full, tol_m=3.0)
    L2 = sum(hav(simp[i - 1], simp[i]) for i in range(1, len(simp)))
    print('после упрощения: точек %d, длина %.1f км' % (len(simp), L2 / 1000))
    json.dump(simp, open('/tmp/route-final.json', 'w'))
    print('trace:', ' '.join(f"({c[0]:.3f},{c[1]:.3f})" for c in simp[::40]))
