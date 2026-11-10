#!/usr/bin/env python3
"""
Bake дорожной геометрии для демо АЗМЗ.

Источник: /tmp/osrm_route.json (ответ OSRM /route/v1/driving, steps=true) —
реальный маршрут Абинск -> Новороссийск по дорогам OSM (трасса А-146).

Скрипт:
  1. Округляет и уплотняет геометрию маршрута.
  2. Извлекает манёвры навигации (turn/fork/merge/arrive) с долями f вдоль
     ломаной (проекция точки манёвра на геометрию) и русскими названиями
     улиц в винительном падеже для баннера навигации.
  3. Считает START_F: позицию грузовика за 20 м до первого манёвра после 0.385.
  4. Прокладывает боковые улицы города (ts1..ts3) через OSRM — чтобы
     сегменты пробок тоже шли по дорогам.
  5. Привязывает 4 демо-пометки к ближайшей точке дороги.
  6. Пишет src/lib/demo/route-geometry.ts и /tmp/route_update.json (для БД).
"""

import json
import math
import urllib.request
import urllib.parse

ROUTE_JSON = '/tmp/osrm_route.json'
OUT_TS = '/home/z/my-project/src/lib/demo/route-geometry.ts'
OUT_DB = '/tmp/route_update.json'

R = 6371000.0

# винительный падеж: «поверните направо на ___»
ACCUSATIVE = {
    'Набережная улица': 'Набережную улицу',
    'Колхозная улица': 'Колхозную улицу',
    'Речной переулок': 'Речной переулок',
    'улица Советов': 'улицу Советов',
    'Анапское шоссе': 'Анапское шоссе',
    'Московская улица': 'Московскую улицу',
    'улица Козлова': 'улицу Козлову',
    'трасса А-146': 'трассу А-146',
}

MARKS = {
    'mk1-pothole-4000-8000-00000000000000001': (37.902, 44.795),
    'mk2-roadworks-4000-8000-0000000000000002': (37.975, 44.846),
    'mk3-police-4000-8000-000000000000000003': (37.868, 44.78),
    'mk4-closed-4000-8000-0000000000000000004': (37.825, 44.755),
}

SIDE_STREETS = {
    'ts1': ((37.766, 44.7215), (37.772, 44.726)),      # ул. Ленина · центр
    'ts2': ((37.778, 44.7305), (37.787, 44.7235)),     # ул. Гагарина
    'ts3': ((37.782, 44.7345), (37.7895, 44.7258)),    # ул. Советов · съезд к порту
}


def hav(a, b):
    dlat = math.radians(b[1] - a[1])
    dlon = math.radians(b[0] - a[0])
    la1 = math.radians(a[1])
    la2 = math.radians(b[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def bearing_deg(a, b):
    dlon = math.radians(b[0] - a[0])
    la1 = math.radians(a[1])
    la2 = math.radians(b[1])
    y = math.sin(dlon) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def poly_length(coords):
    return sum(hav(coords[i - 1], coords[i]) for i in range(1, len(coords)))


def build_projection(coords):
    """Кумулятивные длины вершин + проекция точки на ломаную -> (f, dist_m, idx, t)."""
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + hav(coords[i - 1], coords[i]))
    total = cum[-1]
    scale = math.cos(math.radians(coords[0][1]))
    ex = [c[0] * scale for c in coords]
    ey = [c[1] for c in coords]

    def project(pt):
        px, py = pt[0] * scale, pt[1]
        best = (1e18, 0, 0.0)
        for i in range(1, len(coords)):
            ax, ay = ex[i - 1], ey[i - 1]
            bx, by = ex[i], ey[i]
            dx, dy = bx - ax, by - ay
            dd = dx * dx + dy * dy
            t = 0.0 if dd == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / dd))
            cx, cy = ax + dx * t, ay + dy * t
            d = (px - cx) ** 2 + (py - cy) ** 2
            if d < best[0]:
                best = (d, i, t)
        d2, i, t = best
        seg = cum[i] - cum[i - 1]
        f = (cum[i - 1] + seg * t) / total
        return f, math.sqrt(d2), i, t

    return project, total


def bearing_at(coords, idx, t):
    """Азимут дороги в проекции (idx вершины конца сегмента, t внутри сегмента)."""
    a, b = coords[idx - 1], coords[idx]
    if t >= 0.5 and idx + 1 < len(coords):
        a, b = coords[idx], coords[idx + 1]
    return bearing_deg(a, b)


def advance(coords, idx, t, meters):
    """Точка на ломаной на `meters` дальше позиции (idx, t) по направлению дороги."""
    cum = build_projection(coords)[0] if False else None  # placeholder, см. ниже
    raise RuntimeError('unused')


def advance_along(coords, cum, idx, t, meters):
    """Возвращает [lng, lat] на ломаной на `meters` вперёд от (idx, t)."""
    total = cum[-1]
    seg = cum[idx] - cum[idx - 1]
    target = cum[idx - 1] + seg * t + meters
    target = max(0.0, min(total, target))
    for i in range(1, len(coords)):
        if cum[i] >= target or i == len(coords) - 1:
            seg2 = cum[i] - cum[i - 1]
            tt = 0.0 if seg2 == 0 else min(1.0, (target - cum[i - 1]) / seg2)
            a, b = coords[i - 1], coords[i]
            return [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt]
    return list(coords[-1])


def osrm_side(a, b):
    params = urllib.parse.urlencode({
        'overview': 'full',
        'geometries': 'geojson',
    })
    url = f'https://router.project-osrm.org/route/v1/driving/{a[0]},{a[1]};{b[0]},{b[1]}?{params}'
    with urllib.request.urlopen(url, timeout=40) as resp:
        data = json.load(resp)
    return data['routes'][0]['geometry']['coordinates']


def fmt_coords(coords, indent='  '):
    lines = []
    for i in range(0, len(coords), 3):
        chunk = coords[i:i + 3]
        lines.append(indent + ' '.join(f'[{c[0]:.5f}, {c[1]:.5f}],'.replace('[', ' [', 1).replace('  ', ' ') for c in chunk))
    return '\n'.join(lines).replace(' [', '[')


def main():
    data = json.load(open(ROUTE_JSON))
    route = data['routes'][0]
    osrm_total = route['distance']
    raw = [[round(c[0], 5), round(c[1], 5)] for c in route['geometry']['coordinates']]
    print(f'OSRM: {osrm_total:.0f} m, {len(raw)} pts')

    coords = raw
    project, total = build_projection(coords)
    print(f'baked polyline: {total:.0f} m, {len(coords)} pts')

    # --- манёвры из шагов OSRM ------------------------------------------------
    steps = route['legs'][0]['steps']
    maneuvers = []
    for s in steps:
        m = s['maneuver']
        t = m['type']
        mod = m.get('modifier', '') or ''
        f, off_m, idx, tt = project(m['location'])
        name = (s.get('name') or '').strip()
        if t == 'arrive':
            typ, street = 'arrive', 'ул. Дорожная, 15'
        elif t in ('fork', 'merge'):
            typ = 'right' if 'right' in mod else ('left' if 'left' in mod else 'straight')
            street = 'трассу А-146' if typ != 'straight' else 'трасса А-146'
        elif t in ('turn', 'roundabout', 'rotary'):
            typ = 'right' if 'right' in mod else ('left' if 'left' in mod else 'straight')
            street = ACCUSATIVE.get(name, name)
        elif t == 'new name' and name:
            # смена названия дороги: «продолжайте прямо, ___» (именительный)
            typ, street = 'straight', name
        else:
            continue
        maneuvers.append({'f': round(f, 4), 'type': typ, 'street': street, '_off': off_m})

    # контрольные точки вдоль А-146: «продолжайте прямо» — навигационная текстура
    for label, wp in (('Гайдук', (37.975, 44.846)), ('Верхнебаканский', (37.868, 44.78))):
        f, off_m, _, _ = project(wp)
        if off_m < 900:
            maneuvers.append({'f': round(f, 4), 'type': 'straight', 'street': f'трасса А-146 · {label}', '_off': off_m})
    # слить манёвры ближе 250 м (сначала сортируем по f вдоль маршрута)
    maneuvers.sort(key=lambda m: m['f'])
    merged = []
    for m in maneuvers:
        if merged and (m['f'] - merged[-1]['f']) * total < 250:
            merged[-1] = m if m['type'] != 'straight' else merged[-1]
        else:
            merged.append(m)
    for m in merged:
        print(f"  maneuver f={m['f']:.3f} ({m['f'] * total:.0f} m, off-road {m['_off']:.0f} m) {m['type']:8s} {m['street']}")
    maneuvers = [{'f': m['f'], 'type': m['type'], 'street': m['street']} for m in merged if m['f'] > 0.005]

    # --- START_F: 20 м до первого манёвра после 0.385 ------------------------
    start_f = 0.385
    nxt = next((m for m in maneuvers if m['f'] > start_f + 20 / total), None)
    if nxt and nxt['f'] <= 0.5:
        start_f = round(nxt['f'] - 20 / total, 4)
    print(f'START_F = {start_f} (первый манёвр после старта: {nxt["street"] if nxt else "?"})')

    # --- боковые улицы через OSRM ---------------------------------------------
    sides = {}
    for key, (a, b) in SIDE_STREETS.items():
        gc = [[round(c[0], 5), round(c[1], 5)] for c in osrm_side(a, b)]
        sides[key] = gc
        print(f'  {key}: {len(gc)} pts, {poly_length(gc):.0f} m')

    # --- привязка пометок к дороге --------------------------------------------
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + hav(coords[i - 1], coords[i]))
    marks_out = {}
    for mid, pt in MARKS.items():
        f, off_m, idx, tt = project(pt)
        p1 = advance_along(coords, cum, idx, tt, 8)
        p2 = advance_along(coords, cum, idx, tt, 78)
        geom = {'type': 'LineString', 'coordinates': [[round(p1[0], 5), round(p1[1], 5)], [round(p2[0], 5), round(p2[1], 5)]]}
        marks_out[mid] = {
            'geometry': geom,
            'minLon': min(p1[0], p2[0]), 'maxLon': max(p1[0], p2[0]),
            'minLat': min(p1[1], p2[1]), 'maxLat': max(p1[1], p2[1]),
        }
        print(f'  mark {mid[:12]}… snapped f={f:.3f} (off {off_m:.0f} m)')

    # --- trip bbox -------------------------------------------------------------
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    bbox = [min(lats), min(lons), max(lats), max(lons)]

    # --- route_update.json -----------------------------------------------------
    trip_geo = {'type': 'LineString', 'coordinates': coords}
    db_update = {
        'tripGeoJson': json.dumps(trip_geo, ensure_ascii=False, separators=(',', ':')),
        'routeStepsJson': json.dumps(maneuvers, ensure_ascii=False, separators=(',', ':')),
        'bbox': bbox,
        'marks': marks_out,
    }
    json.dump(db_update, open(OUT_DB, 'w'), ensure_ascii=False)
    print(f'db update -> {OUT_DB}')

    # --- route-geometry.ts ------------------------------------------------------
    def ts_coords(cs):
        rows = []
        for i in range(0, len(cs), 3):
            row = ' '.join(f'[{c[0]}, {c[1]}],' for c in cs[i:i + 3])
            rows.append('  ' + row)
        return '\n'.join(rows)

    def ts_maneuvers(ms):
        rows = ['  { f: %s, type: %r, street: %r },' % (m['f'], m['type'], m['street']) for m in ms]
        return '\n'.join(rows)

    def ts_sides():
        rows = []
        for key in ('ts1', 'ts2', 'ts3'):
            rows.append(f'  {key}: [')
            for i in range(0, len(sides[key]), 3):
                row = ' '.join(f'[{c[0]}, {c[1]}],' for c in sides[key][i:i + 3])
                rows.append('    ' + row)
            rows.append('  ],')
        return '\n'.join(rows)

    ts = f"""/**
 * Дорожная геометрия демо-маршрута — СГЕНЕРИРОВАНО скриптом
 * scripts/bake_route.py из ответа OSRM (OSM): Абинск -> Новороссийск,
 * трасса А-146, {total / 1000:.1f} км, {len(coords)} точек. Линия маршрута,
 * манёвры навигации и сегменты пробок идут ПО ДОРОГАМ, а не по прямой.
 * Руками не редактировать — пересобрать скриптом.
 */

export type BakedManeuverType = 'left' | 'right' | 'straight' | 'arrive'

export interface BakedManeuver {{
  f: number
  type: BakedManeuverType
  street: string
}}

/** Ломаная маршрута [lng, lat] (GeoJSON-порядок) — по дорогам ОSM. */
export const ROUTE_LNGLAT: [number, number][] = [
{ts_coords(coords)}
]

/** Реальные манёвры OSRM (f — доля вдоль ломаной). */
export const BAKED_MANEUVERS: BakedManeuver[] = [
{ts_maneuvers(maneuvers)}
]

/** Позиция грузовика на старте демо: за 20 м до первого манёвра. */
export const BAKED_START_F = {start_f}

/** Боковые улицы города для сегментов пробок — тоже по дорогам OSM. */
export const SIDE_STREET_LINES: Record<'ts1' | 'ts2' | 'ts3', [number, number][]> = {{
{ts_sides()}
}}
"""
    open(OUT_TS, 'w', encoding='utf-8').write(ts)
    print(f'route-geometry.ts -> {OUT_TS}')


if __name__ == '__main__':
    main()
