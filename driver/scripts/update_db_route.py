#!/usr/bin/env python3
"""Обновляет Trip (геометрия маршрута, манёвры, bbox) и RoadMark (привязка
пометок к дороге) в SQLite db/custom.db из /tmp/route_update.json."""
import json
import sqlite3

DB = '/home/z/my-project/db/custom.db'
SRC = '/tmp/route_update.json'
TRIP_ID = '7e6a1c2d-8a9b-4c3d-9e0f-112233445566'

u = json.load(open(SRC))
minLat, minLon, maxLat, maxLon = u['bbox']

con = sqlite3.connect(DB)
cur = con.cursor()

cur.execute(
    'UPDATE Trip SET routeGeoJson=?, routeStepsJson=?, routeMinLat=?, routeMinLon=?, routeMaxLat=?, routeMaxLon=? WHERE id=?',
    (u['tripGeoJson'], u['routeStepsJson'], minLat, minLon, maxLat, maxLon, TRIP_ID),
)
print('trip rows updated:', cur.rowcount)

for mid, m in u['marks'].items():
    cur.execute(
        'UPDATE RoadMark SET polylineGeoJson=?, minLat=?, minLon=?, maxLat=?, maxLon=? WHERE id=?',
        (
            json.dumps(m['geometry'], ensure_ascii=False, separators=(',', ':')),
            m['minLat'], m['minLon'], m['maxLat'], m['maxLon'], mid,
        ),
    )
    print(f'mark {mid[:18]}… updated:', cur.rowcount)

con.commit()

# контроль
row = cur.execute('SELECT length(routeGeoJson), routeMinLat, routeMinLon, routeMaxLat, routeMaxLon FROM Trip WHERE id=?', (TRIP_ID,)).fetchone()
print('trip geo length:', row[0], 'bbox:', row[1:])
for mid, m in u['marks'].items():
    n = cur.execute('SELECT length(polylineGeoJson) FROM RoadMark WHERE id=?', (mid,)).fetchone()[0]
    print('mark len:', n)
con.close()
