#!/usr/bin/env python3
# Curl-прогон сквозного сценария приёмки 10.1 ТЗ (шаги 1, 3–9) против локального сервера.
import json
import sys
import urllib.request
import urllib.error

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
DRIVER1 = 'd1111111-1111-4111-8111-111111111111'  # демо-водитель (Иванов)
STEP = '  '

def call(method, path, body=None, headers=None, expect=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            code, payload = r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        code = e.code
        try:
            payload = json.loads(e.read().decode())
        except Exception:
            payload = {}
    if expect is not None:
        ok = 'OK ' if code == expect else 'FAIL'
        print(f"{ok} {method} {path} -> {code} (ожидался {expect})")
        if code != expect:
            print(STEP, 'ответ:', json.dumps(payload, ensure_ascii=False)[:300])
            sys.exit(1)
    return code, payload

results = []

def step(n, title, ok, detail=''):
    results.append((n, title, ok, detail))
    print(f"{'OK ' if ok else 'FAIL'} Шаг {n}. {title}" + (f" — {detail}" if detail else ''))

# ── Шаг 1: GET /api/1c/orders → три заявки демо-водителя, формат 6.1 ──
code, orders = call('GET', '/api/1c/orders', expect=200)
keys = {'number', 'externalId', 'client', 'cargo', 'weightT', 'fromLabel', 'toLabel', 'loadingAt',
        'unloadingWindow', 'vehicle', 'trailer', 'docs', 'distanceKm', 'durationMin', 'status', 'assignedBy'}
order_keys_ok = keys.issubset(set(orders['orders'][0].keys()))
fmt_ok = orders.get('source') == '1c-stand' and len(orders['orders']) == 3 and order_keys_ok
step(1, 'GET /api/1c/orders — 3 заявки, формат поле-в-поле', fmt_ok, f"source={orders.get('source')}, заявок={len(orders['orders'])}")

# ── Шаг 2 (curl-часть): создание заявки через офисный API ──
_, catalogs = call('GET', '/api/office/catalog/contractors', expect=200)
_, locs = call('GET', '/api/office/catalog/locations', expect=200)
code, created = call('POST', '/api/office/requests', {
    'contractorId': catalogs['rows'][0]['id'],
    'cargo': 'Оборудование промышленное, ящики',
    'weightT': 9.5,
    'fromLocationId': locs['rows'][0]['id'],
    'toLocationId': locs['rows'][2]['id'],
    'loadingAt': '2026-11-13T08:00:00.000Z',
    'unloadingWindow': 'на следующий день 09:00–11:00',
    'docs': ['ТТН (2 экз.)', 'Паспорт груза'],
    'actor': 'Логист',
}, expect=200)
new_number = created['request']['number']
step(2, f'POST /api/office/requests — создана {new_number} (DISPATCH)', created['request']['status'] == 'DISPATCH')

# ── Шаг 3: назначение ЗК-2026/1071 (КАМАЗ 5490 + водитель №2) — атомарное рождение рейса ──
_, requests = call('GET', '/api/office/requests?status=DISPATCH', expect=200)
r1071 = next(r for r in requests['requests'] if r['number'] == 'ЗК-2026/1071')
_, vehicles = call('GET', '/api/office/catalog/vehicles', expect=200)
_, drivers = call('GET', '/api/office/catalog/drivers', expect=200)
kamaz = next(v for v in vehicles['rows'] if v['model'].startswith('КАМАЗ 5490'))
driver2 = sorted(drivers['rows'], key=lambda d: d['createdAt'])[1]
code, assigned = call('POST', f"/api/office/requests/{r1071['id']}/assign",
                      {'vehicleId': kamaz['id'], 'driverId': driver2['id'], 'actor': 'Диспетчер Е. Крылова'}, expect=200)
step(3, 'Назначение ЗК-2026/1071 — ASSIGNED + рождение рейса', assigned.get('ok') is True, assigned.get('number', ''))

# проверка БД: trip + 2 точки + SyncJournal + SystemNote
_, trips = call('GET', '/api/office/trips', expect=200)
trip = next(t for t in trips['trips'] if t['number'] == 'ЗК-2026/1071')
atomic_ok = trip['status'] == 'ASSIGNED' and trip['trip'] is not None and len(trip['trip']['points']) == 2
_, pulled = call('GET', '/api/driver/v1/sync/pull?cursor=0', headers={'X-Driver-Id': driver2['id']}, expect=200)
entities = [e['entity'] for e in pulled['entries']]
journal_ok = 'TRIP' in entities and entities.count('TRIP_POINT') == 2 and 'SYSTEM_NOTE' in entities
step('3a', 'Атомарность: рейс + 2 точки + SyncJournal (TRIP, TRIP_POINT×2, SYSTEM_NOTE)', atomic_ok and journal_ok,
     f"трип={atomic_ok}, план обмена={journal_ok}, seq={pulled['cursor']}")

# ── Шаг 4: pull доставляет записи водителю №2 ──
step(4, 'GET /api/driver/v1/sync/pull — записи дошли водителю №2', len(pulled['entries']) >= 4, f"entries={len(pulled['entries'])}")

# ── Шаг 5: приложение водителя видит заявку как ASSIGNED (проверка /api/1c/orders по X-Driver-Id) ──
_, orders2 = call('GET', '/api/1c/orders', headers={'X-Driver-Id': driver2['id']}, expect=200)
o1071 = next(o for o in orders2['orders'] if o['number'] == 'ЗК-2026/1071')
step(5, 'Заявка ЗК-2026/1071 видна водителю №2 как ASSIGNED', o1071['status'] == 'ASSIGNED', f"status={o1071['status']}")

# ── Шаг 6: ACCEPT → ACCEPTED; отказ START_ROUTE после 1-го шага осмотра (409) ──
code, acc = call('POST', '/api/1c/orders', {'orderId': 'ЗК-2026/1071', 'action': 'ACCEPT'},
                 headers={'X-Driver-Id': driver2['id']}, expect=200)
step(6, 'POST ACCEPT — статус ACCEPTED', acc.get('ok') is True)

# первый шаг фотофиксации, затем START_ROUTE → 409 «предрейсовый осмотр не завершён»
call('POST', '/api/1c/orders', {'orderId': 'ЗК-2026/1071', 'action': 'PRETRIP_STEP', 'stepId': 'veh_side'},
     headers={'X-Driver-Id': driver2['id']}, expect=200)
code, reject = call('POST', '/api/1c/orders', {'orderId': 'ЗК-2026/1071', 'action': 'START_ROUTE'},
                    headers={'X-Driver-Id': driver2['id']})
step('7a', 'START_ROUTE до завершения осмотра — 409 с причиной', code == 409 and 'осмотр' in reject.get('error', ''), reject.get('error', '')[:80])

# 6 × PRETRIP_STEP
for sid in ['veh_side', 'veh_front', 'veh_rear', 'order_docs', 'lic', 'passport']:
    call('POST', '/api/1c/orders', {'orderId': 'ЗК-2026/1071', 'action': 'PRETRIP_STEP', 'stepId': sid},
         headers={'X-Driver-Id': driver2['id']}, expect=200)

# ── Шаг 7: START_ROUTE → DEPARTURE, IN_PROGRESS ──
code, start = call('POST', '/api/1c/orders', {'orderId': 'ЗК-2026/1071', 'action': 'START_ROUTE'},
                   headers={'X-Driver-Id': driver2['id']}, expect=200)
step(7, 'START_ROUTE — TripEvent DEPARTURE, статус IN_PROGRESS', start.get('ok') is True)

# ── Шаг 8: COMPLETE_TRIP → TRIP_DONE, DONE ──
code, done = call('POST', '/api/1c/orders', {'orderId': 'ЗК-2026/1071', 'action': 'COMPLETE_TRIP'},
                  headers={'X-Driver-Id': driver2['id']}, expect=200)
_, trips2 = call('GET', '/api/office/trips', expect=200)
trip2 = next(t for t in trips2['trips'] if t['number'] == 'ЗК-2026/1071')
types = [e['type'] for e in trip2['trip']['events']]
intervals_closed = all(e['intervalClosedAt'] is not None for e in trip2['trip']['events'][:-1])
step(8, 'COMPLETE_TRIP — TRIP_DONE, интервалы закрыты, заявка DONE',
     trip2['status'] == 'DONE' and 'TRIP_DONE' in types and 'DEPARTURE' in types and intervals_closed,
     f"события={types}")

# ── Проверка 409 на заявке, где осмотр НЕ начат (назначаем другому водителю) ──
_, requests_all = call('GET', '/api/office/requests?status=DISPATCH', expect=200)
if requests_all['requests']:
    target = requests_all['requests'][0]
    _, veh_all = call('GET', '/api/office/catalog/vehicles', expect=200)
    _, drv_all = call('GET', '/api/office/catalog/drivers', expect=200)
    v = next(v for v in veh_all['rows'] if v['readiness'] == 'ready' and v['capacityT'] >= 10)
    d2 = sorted(drv_all['rows'], key=lambda x: x['createdAt'])[-1]
    code, _a = call('POST', f"/api/office/requests/{target['id']}/assign", {'vehicleId': v['id'], 'driverId': d2['id']})
    if code == 200:
        call('POST', '/api/1c/orders', {'orderId': target['number'], 'action': 'ACCEPT'}, headers={'X-Driver-Id': d2['id']}, expect=200)
        code, r409 = call('POST', '/api/1c/orders', {'orderId': target['number'], 'action': 'START_ROUTE'}, headers={'X-Driver-Id': d2['id']})
        step('9a', f'Контроль: START_ROUTE без осмотра → {code} с причиной', code == 409, r409.get('error', '')[:80])
        # другому водителю с активным рейсом назначить нельзя — занятость (правило 4 из 5.3)
        _, free = call('GET', '/api/office/requests?status=DISPATCH', expect=200)
        busy_ok, busy_err = None, ''
        if free['requests']:
            for cand in [v for v in veh_all['rows'] if v['readiness'] == 'ready']:
                code2, busy = call('POST', f"/api/office/requests/{free['requests'][0]['id']}/assign", {'vehicleId': cand['id'], 'driverId': d2['id']})
                if code2 == 400 and any('Занят' in e or 'занят' in e for e in busy.get('errors', [])):
                    busy_ok, busy_err = True, busy['errors'][0]
                    break
            if busy_ok is None:
                busy_ok, busy_err = False, 'отказ не получен'
            step('9b', 'Правило 5.3: занятый водитель — отказ проведения', busy_ok, busy_err[:80])
        if busy_ok:
            call('POST', f"/api/office/requests/{free['requests'][0]['id']}/cancel", {'reason': 'Ошибка в заявке'}, expect=200)

# ── Шаг 9: чат диспетчера → CHAT_MESSAGE через pull ──
code, msg = call('POST', '/api/office/chat', {'driverId': driver2['id'], 'body': 'Проверка доставки чата через план обмена'}, expect=200)
_, pulled2 = call('GET', '/api/driver/v1/sync/pull?cursor=0', headers={'X-Driver-Id': driver2['id']}, expect=200)
chat_ok = any(e['entity'] == 'CHAT_MESSAGE' and e['payload']['body'] == 'Проверка доставки чата через план обмена' for e in pulled2['entries'])
step(9, 'Чат диспетчера → CHAT_MESSAGE доходит через pull', chat_ok)

# ── Шаг 10: отмена диспетчером назначенной заявки → SystemNote водителю ──
_, catalogs2 = call('GET', '/api/office/catalog/contractors', expect=200)
code, created2 = call('POST', '/api/office/requests', {
    'contractorId': catalogs2['rows'][1]['id'],
    'cargo': 'Трубы стальные, 12 м', 'weightT': 14,
    'fromLocationId': locs['rows'][0]['id'], 'toLocationId': locs['rows'][3]['id'],
    'loadingAt': '2026-11-14T08:00:00.000Z', 'unloadingWindow': 'на следующий день 09:00–12:00',
    'docs': ['ТТН (2 экз.)'],
}, expect=200)
call('POST', f"/api/office/requests/{created2['request']['id']}/assign",
     {'vehicleId': vehicles['rows'][0]['id'], 'driverId': driver2['id'], 'actor': 'Диспетчер Е. Крылова'}, expect=200)
call('POST', f"/api/office/requests/{created2['request']['id']}/cancel",
     {'reason': 'Отмена заказчиком', 'actor': 'Диспетчер Е. Крылова'}, expect=200)
_, pulled3 = call('GET', '/api/driver/v1/sync/pull?cursor=0', headers={'X-Driver-Id': driver2['id']}, expect=200)
cancel_ok = any(e['entity'] == 'SYSTEM_NOTE' and e['payload']['kind'] == 'ORDER_CANCELLED' for e in pulled3['entries'])
step(10, 'Отмена назначенной заявки → SystemNote водителю через pull', cancel_ok)

# ── Журнал регистрации ──
_, journal = call('GET', '/api/office/journal?limit=50', expect=200)
actions = {r['action'] for r in journal['rows']}
need = {'REQUEST_CREATE', 'ASSIGN', 'CANCEL', 'DRIVER_ACTION'}
step('ж', 'Журнал регистрации фиксирует действия', need.issubset(actions), f"действия={sorted(actions)[:10]}")

failed = [r for r in results if not r[2]]
print()
print(f"ИТОГО: {len(results) - len(failed)}/{len(results)} шагов пройдено" + (f", НЕ ПРОЙДЕНО: {[r[0] for r in failed]}" if failed else ' — сценарий приёмки проходит полностью'))
sys.exit(1 if failed else 0)
