#!/usr/bin/env python3
"""Привязывает ВСЕ пометки (RoadMark) к дорожной геометрии маршрута из БД:
первая вершина проецируется на ломаную Trip.routeGeoJson, линия пометки
перестраивается вдоль дороги (8..78 м) с обновлением bbox."""
import json
import math
import sqlite3

DB = '/home/z/my-project/db/custom.db'
TRIP_ID = '7e6a1c2d-8a9b-4c3d-9e0f-112233445566'
R = 6371000.0


def hav(a, b):
    dlat = math.radians(b[1] - a[1])
    dlon = math.radians(b[0] - a[0])
    la1 = math.radians(a[1])
    la2 = math.radians(b[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def build_projection(coords):
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
            ax, ay, bx, by = ex[i - 1], ey[i - 1], ex[i], ey[i]
            dx, dy = bx - ax, by - ay
            dd = dx * dx + dy * dy
            t = 0.0 if dd == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / dd))
            cx, cy = ax + dx * t, ay + dy * t
            d = (px - cx) ** 2 + (py - cy) ** 2
            if d < best[0]:
                best = (d, i, t)
        d2, i, t = best
        seg = cum[i] - cum[i - 1]
        return (cum[i - 1] + seg * t) / total, math.sqrt(d2), i, t

    return project, cum, total


def advance_along(coords, cum, idx, t, meters):
    total = cum[-1]
    seg = cum[idx] - cum[idx - 1]
    target = max(0.0, min(total, cum[idx - 1] + seg * t + meters))
    for i in range(1, len(coords)):
        if cum[i] >= target or i == len(coords) - 1:
            seg2 = cum[i] - cum[i - 1]
            tt = 0.0 if seg2 == 0 else min(1.0, (target - cum[i - 1]) / seg2)
            a, b = coords[i - 1], coords[i]
            return [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt]
    return list(coords[-1])


con = sqlite3.connect(DB)
cur = con.cursor()
geo = cur.execute('SELECT routeGeoJson FROM Trip WHERE id=?', (TRIP_ID,)).fetchone()[0]
coords = json.loads(geo)['coordinates']
project, cum, total = build_projection(coords)

rows = cur.execute('SELECT id, polylineGeoJson FROM RoadMark').fetchall()
for mid, gj in rows:
    c0 = json.loads(gj)['coordinates'][0]
    f, off, idx, t = project(c0)
    p1 = advance_along(coords, cum, idx, t, 8)
    p2 = advance_along(coords, cum, idx, t, 78)
    geom = {'type': 'LineString', 'coordinates': [[round(p1[0], 5), round(p1[1], 5)], [round(p2[0], 5), round(p2[1], 5)]]}
    cur.execute(
        'UPDATE RoadMark SET polylineGeoJson=?, minLat=?, minLon=?, maxLat=?, maxLon=? WHERE id=?',
        (
            json.dumps(geom, ensure_ascii=False, separators=(',', ':')),
            min(p1[1], p2[1]), min(p1[0], p2[0]), max(p1[1], p2[1]), max(p1[0], p2[0]), mid,
        ),
    )
    print(f'{mid[:22]}… f={f:.3f} off-road={off:.0f} m -> snapped')
con.commit()
con.close()
print('done, total route', round(total), 'm, marks:', len(rows))
