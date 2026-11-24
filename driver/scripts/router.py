"""Графовый маршрутизатор по векторным тайлам OpenFreeMap.

1. Собирает слой transportation (z13) по коридору Абинск—Новороссийск.
2. Строит геометрический граф: концы линий склеиваются с допуском,
   Т-пересечения — проецированием конца на чужой сегмент (виртуальный сплит).
3. Дейкстра с ценой = длина × штраф класса дороги (minor дороже).
4. Возвращает геометрию пути АБЗ «Абинск» -> ул. Дорожная, 15.
"""
import json
import math
import heapq
import sys

sys.path.insert(0, '/home/z/my-project/scripts')
from stitch_a146 import collect_layer  # noqa: E402


def hav(p, q):
    R = 6371000
    dlat = math.radians(q[1] - p[1])
    dlon = math.radians(q[0] - p[0])
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(p[1])) * math.cos(math.radians(q[1])) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


CLASS_PENALTY = {'trunk': 0.9, 'primary': 1.0, 'secondary': 1.2, 'tertiary': 1.5,
                 'minor': 3.5, 'service': 6.0, 'residential': 3.5, 'unclassified': 2.5}


def split_at_projections(pieces, tol_m=28):
    """Разрезает куски в точках, где чужие концы ложатся на их сегменты
    (типичный случай на границах тайлов из-за буферной обрезки)."""
    cell = tol_m / 111320.0
    seg_grid = {}
    for i, pc in enumerate(pieces):
        c = pc['coords']
        for k in range(len(c) - 1):
            a, b = c[k], c[k + 1]
            kx0, kx1 = round(min(a[0], b[0]) / cell), round(max(a[0], b[0]) / cell)
            ky0, ky1 = round(min(a[1], b[1]) / cell), round(max(a[1], b[1]) / cell)
            for kx in range(kx0, kx1 + 1):
                for ky in range(ky0, ky1 + 1):
                    seg_grid.setdefault((kx, ky), []).append((i, k))
    # проекции: конец куска -> (кусок-владелец, точка вдоль)
    cuts = {}  # piece_idx -> set of (seg_k, t)
    for i, pc in enumerate(pieces):
        c = pc['coords']
        for e, pt in ((0, c[0]), (1, c[-1])):
            kx, ky = round(pt[0] / cell), round(pt[1] / cell)
            best = None
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j, k in seg_grid.get((kx + dx, ky + dy), []):
                        if j == i:
                            continue
                        a, b = pieces[j]['coords'][k], pieces[j]['coords'][k + 1]
                        # проекция pt на отрезок ab
                        ax, ay = a[0], a[1]
                        bx, by = b[0] - a[0], b[1] - a[1]
                        L2 = bx * bx + by * by
                        if L2 == 0:
                            continue
                        t = max(0.0, min(1.0, ((pt[0] - ax) * bx + (pt[1] - ay) * by) / L2))
                        px, py = ax + bx * t, ay + by * t
                        d = hav(pt, (px, py))
                        if d <= tol_m and (best is None or d < best[0]):
                            best = (d, j, k, t)
            if best:
                _, j, k, t = best
                cuts.setdefault(j, set()).add((k, t))
    # разрезы
    out = []
    for i, pc in enumerate(pieces):
        c = pc['coords']
        cs = cuts.get(i)
        if not cs:
            out.append(pc)
            continue
        # позиции разреза: (глобальный индекс вершины, доля)
        positions = []
        for k, t in cs:
            positions.append((k + t, k, t))
        positions.sort()
        prev_k = 0
        prev_t = 0.0
        parts = []
        for pos, k, t in positions:
            if pos <= prev_k + 1e-9:
                continue
            cut = [c[prev_k]]
            cut.extend(c[prev_k + 1:k + 1])
            if t > 1e-9:
                a, b = c[k], c[k + 1]
                cut.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
            if len(cut) >= 2:
                parts.append(cut)
            prev_k = k
            prev_t = t
        tail = list(c[prev_k:])
        if len(tail) >= 2:
            parts.append(tail)
        if not parts:
            parts = [c]
        for pt in parts:
            out.append({'coords': pt, 'props': pc['props'], 'w': pc.get('w') or 1.0})
    return out


def build_graph(pieces, tol_m=28):
    """Узлы: ('p', i, end) и ('v', i, k) — вершины сплита. Рёбра внутри линий + стыки."""
    # 1) квантование концов в ячейки
    cell = tol_m / 111320.0  # ~градусы по долготе
    grid = {}
    for i, pc in enumerate(pieces):
        c = pc['coords']
        for e, pt in ((0, c[0]), (1, c[-1])):
            key = (round(pt[0] / cell), round(pt[1] / cell))
            grid.setdefault(key, []).append((i, e))
    # 2) стыки конец-конец
    join = []  # (i, e, j, e2)
    for i, pc in enumerate(pieces):
        c = pc['coords']
        for e, pt in ((0, c[0]), (1, c[-1])):
            kx, ky = round(pt[0] / cell), round(pt[1] / cell)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j, e2 in grid.get((kx + dx, ky + dy), []):
                        if j <= i:
                            continue
                        pt2 = pieces[j]['coords'][-1] if e2 == 1 else pieces[j]['coords'][0]
                        if hav(pt, pt2) <= tol_m:
                            join.append((i, e, j, e2))
    return join


def dijkstra_from_ends(pieces, join, si, ti):
    """Дейкстра по состояниям (кусок, направление). join — стыки концов.
    Возвращает координаты пути от конца куска si до конца куска ti."""
    n = len(pieces)
    adj = {}
    for i, e, j, e2 in join:
        # конец e куска i соединён с концом e2 куска j
        adj.setdefault((i, e), []).append((j, e2))
        adj.setdefault((j, e2), []).append((i, e))
    INF = float('inf')
    # длины кусков
    L = []
    for pc in pieces:
        c = pc['coords']
        L.append(sum(hav(c[k - 1], c[k]) for k in range(1, len(c))))
    # состояние: (piece, dir) dir=0: 0->last, dir=1: last->0
    # cost входа через конец e_in: exit_end = 1-e_in
    dist = {}
    prev = {}
    pq = []
    for d in (0, 1):
        e_in = d  # вход через конец d, выход через 1-d
        dist[(si, e_in)] = L[si] * pieces[si]['w']
        prev[(si, e_in)] = None
        heapq.heappush(pq, (dist[(si, e_in)], si, e_in))
    final = None
    while pq:
        c, i, e_in = heapq.heappop(pq)
        if c > dist.get((i, e_in), INF) + 1e-9:
            continue
        out_end = 1 - e_in
        if i == ti and out_end == (0 if ti == si else 0):
            pass
        if i == ti:
            # дошли до целевого куска: любой выход ок, но лучше ближайший к DEST — берём как есть
            final = (i, e_in)
            break
        for j, e2 in adj.get((i, out_end), []):
            e_in2 = e2  # вход в j через тот же конец
            nc = c + L[j] * pieces[j]['w']
            if nc < dist.get((j, e_in2), INF):
                dist[(j, e_in2)] = nc
                prev[(j, e_in2)] = (i, e_in)
                heapq.heappush(pq, (nc, j, e_in2))
    if final is None:
        return None
    # восстановление
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
        coords.extend(add)
    return coords


if __name__ == '__main__':
    bbox = (37.70, 44.68, 38.22, 44.92)
    print('сбор z13 transportation...')
    tr = collect_layer(13, bbox, 'transportation')
    print('кусков:', len(tr))
    prep = []
    skipped = 0
    for f in tr:
        cls = f['props'].get('class')
        if cls in ('rail', 'ferry', 'path', 'footway', 'track'):
            skipped += 1
            continue
        pc = {'coords': f['coords'], 'props': f['props'], 'w': CLASS_PENALTY.get(cls, 2.5)}
        prep.append(pc)
    print('после фильтра:', len(prep), '(скипнуто', skipped, ')')
    prep = split_at_projections(prep, tol_m=30)
    print('после сплитов:', len(prep))

    # компоненты связности -> ведём путь по самой большой (в OSM у Абинска разрыв данных)
    join = build_graph(prep, tol_m=30)
    parent = list(range(len(prep)))
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for i, e, j, e2 in join:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj
    from collections import defaultdict
    comp = defaultdict(list)
    for i in range(len(prep)):
        comp[find(i)].append(i)
    main = max(comp.values(), key=len)
    main_set = set(main)
    print('главная компонента:', len(main), 'из', len(prep))

    ABZ = (38.157, 44.8682)
    DEST = (37.760, 44.7255)
    def nearest_in(pt, subset):
        b, bd = None, 1e18
        for i in subset:
            c = prep[i]['coords']
            for p2 in (c[0], c[-1]):
                d = hav(p2, pt)
                if d < bd:
                    b, bd = i, d
        return b, bd
    si, sd = nearest_in(ABZ, main_set)
    ti, td = nearest_in(DEST, main_set)
    print(f'старт: кусок #{si} ({sd:.0f} м от АБЗ), финиш: #{ti} ({td:.0f} м от Дорожной 15)')
    path = dijkstra_from_ends(prep, join, si, ti)
    if path is None:
        print('ПУТЬ НЕ НАЙДЕН')
        sys.exit(1)
    L = sum(hav(path[i - 1], path[i]) for i in range(1, len(path)))
    print('путь найден: точек', len(path), 'длина %.1f км' % (L / 1000))
    json.dump(path, open('/tmp/path-full.json', 'w'))
    print('trace:', ' '.join(f"({c[0]:.3f},{c[1]:.3f})" for c in path[::60]))
