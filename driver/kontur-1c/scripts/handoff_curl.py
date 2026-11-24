#!/usr/bin/env python3
# Живые curl-примеры контрактов «Контур 1С» для HANDOFF (реальные запросы/ответы).
import json
import sys
import urllib.request
import urllib.error

BASE = 'http://localhost:3000'
DEMO = 'd1111111-1111-4111-8111-111111111111'

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

def show(title, method, path, status, payload, lines=8):
    print(f'### {title}')
    print(f'$ curl {method} {path}')
    out = json.dumps(payload, ensure_ascii=False)
    if len(out) > 900:
        out = out[:900] + ' …'
    print(f'→ {status}')
    print(out)
    print()

print('===== 1. GET /api/1c/orders (демо-водитель) =====')
code, p = call('GET', '/api/1c/orders', headers={'X-Driver-Id': DEMO})
first = p['orders'][0] if p.get('orders') else None
print(f'→ {code}; source={p.get("source")}; orders={len(p.get("orders", []))}')
print(json.dumps({'source': p.get('source'), 'note': p.get('note'), 'first_order': first}, ensure_ascii=False)[:1200])
print()

print('===== 2. GET /api/driver/v1/sync/pull?cursor=0 (демо-водитель) =====')
code, p = call('GET', '/api/driver/v1/sync/pull?cursor=0', headers={'X-Driver-Id': DEMO})
ents = p.get('entries', [])
print(f'→ {code}; entries={len(ents)}; cursor={p.get("cursor")}; hasMore={p.get("hasMore")}')
print('entities:', [(e['seq'], e['entity'], e['op']) for e in ents])
if ents:
    print('payload[0] (TRIP):', json.dumps(ents[0]['payload'], ensure_ascii=False)[:500])
print()

print('===== 3. GET /api/office/dashboard =====')
code, p = call('GET', '/api/office/dashboard')
print(f'→ {code}; counts={p.get("counts")}; total={p.get("total")}; activeTrips={len(p.get("activeTrips", []))}; feed={len(p.get("feed", []))}')
print()

print('===== 4. GET /api/office/requests =====')
code, p = call('GET', '/api/office/requests')
print(f'→ {code}; requests={len(p.get("requests", []))}; counts={p.get("counts")}')
if p.get('requests'):
    r0 = p['requests'][0]
    print('first:', json.dumps({k: r0[k] for k in ['number','status','cargo','weightT','driver']}, ensure_ascii=False))
print()

print('===== 5. GET /api/office/catalog/drivers =====')
code, p = call('GET', '/api/office/catalog/drivers')
print(f'→ {code}; rows={len(p.get("rows", []))}; first={json.dumps(p["rows"][0], ensure_ascii=False)[:200] if p.get("rows") else None}')
print()

print('===== 6. GET /api/driver/v1/traffic =====')
code, p = call('GET', '/api/driver/v1/traffic')
print(f'→ {code}; segments={len(p.get("segments", []))}; snapshotAt={p.get("snapshotAt")}')
print()

print('===== 7. GET /api/driver/v1/sync/marks (пусто после сида) =====')
code, p = call('GET', '/api/driver/v1/sync/marks')
print(f'→ {code}; marks={len(p.get("marks", []))}; snapshotAt={p.get("snapshotAt")}')
print()

print('===== 8. POST /api/office/requests (создание заявки сбытом) =====')
code, cats = call('GET', '/api/office/catalog/contractors')
code, locs = call('GET', '/api/office/catalog/locations')
code, p = call('POST', '/api/office/requests', {
    'contractorId': cats['rows'][0]['id'],
    'cargo': 'Оборудование промышленное, ящики',
    'weightT': 9.5,
    'fromLocationId': locs['rows'][0]['id'],
    'toLocationId': locs['rows'][2]['id'],
    'loadingAt': '2026-11-13T08:00:00.000Z',
    'unloadingWindow': 'на следующий день 09:00–11:00',
    'docs': ['ТТН (2 экз.)', 'Паспорт груза'],
    'actor': 'Логист',
})
print(f'→ {code}; ok={p.get("ok")}; number={p.get("request", {}).get("number")}; status={p.get("request", {}).get("status")}')
print()

print('===== 9. POST /api/1c/orders — запрещённое действие ASSIGN (400) =====')
code, p = call('POST', '/api/1c/orders', {'orderId': 'ЗК-2026/1071', 'action': 'ASSIGN'}, headers={'X-Driver-Id': DEMO})
print(f'→ {code}; body={json.dumps(p, ensure_ascii=False)}')
print()

print('===== 10. POST /api/driver/v1/sync/push — MARK_PUBLISH + повтор того же opId =====')
op_id = 'handoff-demo-op-0001'
code, p = call('POST', '/api/driver/v1/sync/push', {
    'deviceId': 'handoff-device',
    'operations': [{'opId': op_id, 'type': 'MARK_PUBLISH', 'payload': {
        'category': 'POTHOLE',
        'geometry': {'type': 'LineString', 'coordinates': [[37.78, 44.70], [37.80, 44.71], [37.82, 44.72]]},
        'comment': 'Яма у поворота (проверка handoff)',
        'ttlHours': 6,
    }}]
}, headers={'X-Driver-Id': DEMO})
print(f'→ {code}; results={json.dumps(p.get("results"), ensure_ascii=False)}')
code, p2 = call('POST', '/api/driver/v1/sync/push', {
    'deviceId': 'handoff-device',
    'operations': [{'opId': op_id, 'type': 'MARK_PUBLISH', 'payload': {
        'category': 'POTHOLE',
        'geometry': {'type': 'LineString', 'coordinates': [[37.78, 44.70], [37.80, 44.71], [37.82, 44.72]]},
        'comment': 'Яма у поворота (проверка handoff)',
        'ttlHours': 6,
    }}]
}, headers={'X-Driver-Id': DEMO})
print(f'повтор того же opId → {code}; results={json.dumps(p2.get("results"), ensure_ascii=False)}')
code, p3 = call('GET', '/api/driver/v1/sync/marks')
print(f'GET marks после публикации → {code}; marks={len(p3.get("marks", []))}; первая: {json.dumps(p3["marks"][0], ensure_ascii=False)[:220] if p3.get("marks") else None}')
print()

print('===== 11. POST /api/office/chat (диспетчер → водителю) =====')
code, p = call('POST', '/api/office/chat', {'driverId': '8061cbfd-fead-4a11-b1f5-83baf60b7b58', 'body': 'Проверка handoff: сообщение диспетчера'})
print(f'→ {code}; ok={p.get("ok")}; message={json.dumps(p.get("message"), ensure_ascii=False)[:200]}')
code, p2 = call('GET', '/api/driver/v1/sync/pull?cursor=0', headers={'X-Driver-Id': DEMO})
last = p2['entries'][-1] if p2.get('entries') else None
print(f'pull: entries={len(p2.get("entries", []))}, последняя запись: seq={last["seq"] if last else None} entity={last["entity"] if last else None} body={last["payload"].get("body") if last else None}')
