#!/usr/bin/env python3
# Живые примеры назначение/отмена/реестры (мутирующие — выполняются до финального пересева).
import json
import urllib.request
import urllib.error

BASE = 'http://localhost:3000'

def call(method, path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}

_, reqs = call('GET', '/api/office/requests?status=DISPATCH')
r1074 = next(r for r in reqs['requests'] if r['number'] == 'ЗК-2026/1074')
_, veh = call('GET', '/api/office/catalog/vehicles')
_, drv = call('GET', '/api/office/catalog/drivers')
maz = next(v for v in veh['rows'] if v['plate'] == 'В 789 СА 23')
petrov = next(d for d in drv['rows'] if d['fullName'].startswith('Петров'))

print('### POST /api/office/requests/{id}/assign (ЗК-2026/1074 → МАЗ 6312 + Петров)')
code, p = call('POST', f"/api/office/requests/{r1074['id']}/assign",
               {'vehicleId': maz['id'], 'driverId': petrov['id'], 'actor': 'Диспетчер Е. Крылова'})
print(f'→ {code} {json.dumps(p, ensure_ascii=False)}')
print()
print('### GET /api/office/trips (после назначения)')
code, p = call('GET', '/api/office/trips')
t = next(x for x in p['trips'] if x['number'] == 'ЗК-2026/1074')
print(f'→ {code} number={t["number"]} status={t["status"]} lastEventLabel={t.get("lastEventLabel")} points={len(t["trip"]["points"])} routeDistanceM={t["trip"]["routeDistanceM"]}')
print()
print('### POST /api/office/requests/{id}/cancel (ЗК-2026/1074)')
code, p = call('POST', f"/api/office/requests/{r1074['id']}/cancel",
               {'reason': 'Отмена заказчиком', 'actor': 'Диспетчер Е. Крылова'})
print(f'→ {code} {json.dumps(p, ensure_ascii=False)}')
print()
print('### GET /api/office/journal?limit=3 (после действий)')
code, p = call('GET', '/api/office/journal?limit=3')
for r in p['rows']:
    print(f'→ {code} row: user={r["user"]} action={r["action"]} entity={r["entity"]}/{r["entityId"]} level={r["level"]} at={r["at"]}')
