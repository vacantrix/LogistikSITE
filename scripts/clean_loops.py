"""Финальная чистка маршрута: удаление петель + повторные мосты (z14, затем z15)."""
import json
import math
import sys
from collections import defaultdict

sys.path.insert(0, '/home/z/my-project/scripts')
from router import hav  # noqa: E402
from build_route import nearest_piece, dijkstra_pieces, simplify_dp  # noqa: E402
from stitch_a146 import collect_layer  # noqa: E402
from router import split_at_projections, build_graph, CLASS_PENALTY  # noqa: E402
from bridge_gaps import bridge_gap  # noqa: E402


def remove_loops(route, cell_deg=0.0015):
    """Срезает петли: если путь вернулся в уже пройденную ячейку — вырезаем середину."""
    out = []
    seen = {}
    i = 0
    n = len(route)
    while i < n:
        p = route[i]
        key = (round(p[0] / cell_deg), round(p[1] / cell_deg))
        if key in seen:
            j = seen[key]
            # вырезаем (j..i) если петля длинная и не даёт выигрыша
            if i - j > 8:
                # проверяем: не является ли это нормальным серпантином (далеко по дороге)
                loop_len = sum(hav(route[k - 1], route[k]) for k in range(j + 1, i + 1))
                direct = hav(route[j], route[i])
                if loop_len > max(direct * 2.5, direct + 1500):
                    i = j + 1
                    p = route[i]
                    key = (round(p[0] / cell_deg), round(p[1] / cell_deg))
            # всё равно обновляем индекс ячейки
        seen[key] = i
        out.append(p)
        i += 1
    return out


if __name__ == '__main__':
    route = json.load(open('/tmp/route-bridged.json'))
    print('вход:', len(route), 'точек')
    cleaned = remove_loops(route)
    L = sum(hav(cleaned[i - 1], cleaned[i]) for i in range(1, len(cleaned)))
    print('после чистки петель: %.1f км, %d точек' % (L / 1000, len(cleaned)))

    # повторные мосты (двумя проходами — после чистки могли появиться новые стыки)
    for pass_n in (1, 2):
        out = [cleaned[0]]
        bridged = failed = 0
        for i in range(1, len(cleaned)):
            a, b = out[-1], cleaned[i]
            if hav(a, b) <= 350:
                out.append(b)
                continue
            seg = bridge_gap(a, b)
            if seg:
                if hav(out[-1], seg[0]) > hav(out[-1], seg[-1]):
                    seg.reverse()
                out.extend(seg[1:])
                bridged += 1
            else:
                out.append(b)
                failed += 1
        cleaned = out
        L = sum(hav(cleaned[i - 1], cleaned[i]) for i in range(1, len(cleaned)))
        print(f'проход {pass_n}: мостов {bridged}, не найдено {failed}, длина %.1f км, %d точек' % (L / 1000, len(cleaned)))

    simp = simplify_dp(cleaned, tol_m=3.0)
    L2 = sum(hav(simp[i - 1], simp[i]) for i in range(1, len(simp)))
    print('итог: %.1f км, %d точек' % (L2 / 1000, len(simp)))
    # оставшиеся прыжки
    jumps = [(i, round(hav(simp[i - 1], simp[i]))) for i in range(1, len(simp)) if hav(simp[i - 1], simp[i]) > 500]
    print('прыжки >500 м:', jumps[:12])
    json.dump(simp, open('/tmp/route-clean.json', 'w'))
    print('trace:', ' '.join(f"({c[0]:.3f},{c[1]:.3f})" for c in simp[::35]))
