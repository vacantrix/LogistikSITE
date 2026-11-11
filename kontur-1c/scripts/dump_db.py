#!/usr/bin/env python3
# Дамп реальных данных БД «Контур 1С» для HANDOFF-пакета.
import json
import sqlite3

conn = sqlite3.connect('/home/z/my-project/db/custom.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

print('=== DRIVERS (id | fullName | appId) ===')
for r in cur.execute("SELECT id, fullName, appId, phone, licenseNo, isActive FROM Driver ORDER BY createdAt"):
    print(f"{r['id']} | {r['fullName']} | appId={r['appId']} | {r['phone']} | {r['licenseNo']} | active={r['isActive']}")

print('\n=== VEHICLES (plate | model | kind | bodyType | capacityT | readiness) ===')
for r in cur.execute("SELECT plate, model, kind, bodyType, capacityT, volumeM3, readiness, isActive FROM Vehicle ORDER BY createdAt"):
    print(f"{r['plate']} | {r['model']} | {r['kind']} | {r['bodyType']} | {r['capacityT']} т | {r['readiness']} | active={r['isActive']}")

print('\n=== TRAILERS ===')
for r in cur.execute("SELECT plate, model, type FROM Trailer ORDER BY createdAt"):
    print(f"{r['plate']} | {r['model']} | {r['type']}")

print('\n=== CONTRACTORS ===')
for r in cur.execute("SELECT name, inn, kind FROM Contractor ORDER BY createdAt"):
    print(f"{r['name']} | ИНН {r['inn']} | {r['kind']}")

print('\n=== LOCATIONS ===')
for r in cur.execute("SELECT name, address, lat, lon, geofenceRadiusM FROM Location ORDER BY name"):
    print(f"{r['name']} | {r['address']} | {r['lat']},{r['lon']} | r={r['geofenceRadiusM']}м")

print('\n=== TRANSPORT REQUESTS (number | status | cargo | weightT | vehicle | driver) ===')
q = """
SELECT t.number, t.status, t.cargo, t.weightT, v.plate AS veh, d.fullName AS drv, t.assignedBy, t.closeReason
FROM TransportRequest t
LEFT JOIN Vehicle v ON v.id = t.vehicleId
LEFT JOIN Driver d ON d.id = t.driverId
ORDER BY t.number DESC
"""
for r in cur.execute(q):
    veh = r['veh'] or '—'
    drv = r['drv'] or '—'
    print(f"{r['number']} | {r['status']} | {r['cargo']} | {r['weightT']} т | {veh} | {drv} | назначил: {r['assignedBy'] or '—'} | причина: {r['closeReason'] or '—'}")

print('\n=== TRIPS (tripCode | status | lastEventType) ===')
for r in cur.execute("SELECT tripCode, status, lastEventType FROM Trip ORDER BY tripCode DESC"):
    print(f"{r['tripCode']} | {r['status']} | last={r['lastEventType']}")

print('\n=== COUNTS ===')
for tbl in ['Contractor','Vehicle','Trailer','Driver','Location','TransportRequest','Trip','TripPoint','TripEvent','StatusHistory','RegistrationLog','SyncJournal','SyncOperation','SystemNote','ChatMessage','RoadMark','TrafficSegment','NumberCounter','Waybill','PreTripInspection']:
    n = cur.execute(f"SELECT COUNT(*) c FROM {tbl}").fetchone()['c']
    print(f"{tbl}: {n}")

print('\n=== NUMBERCOUNTER ===')
for r in cur.execute("SELECT year, last FROM NumberCounter"):
    print(f"год {r['year']}: last={r['last']}")

print('\n=== STATUS HISTORY (последние 12) ===')
q2 = """
SELECT s.at, t.number, s.fromStatus, s.toStatus, s.actor, s.comment
FROM StatusHistory s JOIN TransportRequest t ON t.id = s.requestId
ORDER BY s.at DESC LIMIT 12
"""
for r in cur.execute(q2):
    print(f"{r['at']} | {r['number']} | {r['fromStatus']}→{r['toStatus']} | {r['actor']} | {r['comment'] or ''}")

print('\n=== SYNCJOURNAL (по водителям: seq-диапазоны и сущности) ===')
for r in cur.execute("SELECT driverId, COUNT(*) c, MIN(seq) mn, MAX(seq) mx FROM SyncJournal GROUP BY driverId"):
    ents = cur.execute("SELECT entity, COUNT(*) c FROM SyncJournal WHERE driverId=? GROUP BY entity", (r['driverId'],)).fetchall()
    ent_str = ', '.join(f"{e['entity']}×{e['c']}" for e in ents)
    print(f"{r['driverId']} | {r['c']} записей, seq {r['mn']}–{r['mx']} | {ent_str}")

conn.close()
