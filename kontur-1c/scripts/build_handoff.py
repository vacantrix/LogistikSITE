#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка HANDOFF.md для платформы «Контур 1С».
Читает реальные файлы проекта и реальное содержимое db/custom.db,
складывает полный самодостаточный пакет в /home/z/my-project/HANDOFF.md.
"""
import os
import sqlite3
from datetime import datetime

ROOT = '/home/z/my-project'
OUT = os.path.join(ROOT, 'HANDOFF.md')

# ─────────────────────────── утилиты ───────────────────────────

def fence(path, lang=None):
    """Полное содержимое файла в fenced-блоке; первая строка — // путь."""
    ext = path.rsplit('.', 1)[-1].lower()
    lang = lang or {'ts': 'ts', 'tsx': 'tsx', 'py': 'python', 'prisma': 'prisma',
                    'css': 'css', 'md': 'md', 'json': 'json', 'mjs': 'js', 'sh': 'bash'}.get(ext, '')
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        body = f.read().rstrip('\n')
    comment = '//' if ext in ('ts', 'tsx', 'js', 'mjs', 'json') else '#'
    first = f'{comment} {path}'
    if ext in ('css', 'md', 'sh', 'prisma'):
        first = f'/* {path} */' if ext == 'css' else f'# {path}'
    return f'```{lang}\n{first}\n{body}\n```'

def table(headers, rows):
    out = ['| ' + ' | '.join(headers) + ' |', '|' + '|'.join(['---'] * len(headers)) + '|']
    for r in rows:
        out.append('| ' + ' | '.join(str(c) for c in r) + ' |')
    return '\n'.join(out)

# ─────────────────────────── данные БД (текущий канонический сид) ───────────────────────────

conn = sqlite3.connect(os.path.join(ROOT, 'db', 'custom.db'))
conn.row_factory = sqlite3.Row
cur = conn.cursor()

drivers = list(cur.execute("SELECT id, fullName, appId, phone, licenseNo FROM Driver ORDER BY createdAt"))
vehicles = list(cur.execute("SELECT plate, model, kind, bodyType, capacityT, readiness FROM Vehicle ORDER BY createdAt"))
trailers = list(cur.execute("SELECT plate, model, type FROM Trailer ORDER BY createdAt"))
contractors = list(cur.execute("SELECT name, inn, kind FROM Contractor ORDER BY createdAt"))
locations = list(cur.execute("SELECT name, address, lat, lon FROM Location ORDER BY name"))
requests = list(cur.execute("""
    SELECT t.number, t.status, t.cargo, t.weightT, t.unloadingWindow, v.plate veh, d.fullName drv
    FROM TransportRequest t LEFT JOIN Vehicle v ON v.id=t.vehicleId LEFT JOIN Driver d ON d.id=t.driverId
    ORDER BY t.number DESC"""))
trips = list(cur.execute("SELECT tripCode, status, lastEventType FROM Trip ORDER BY tripCode DESC"))
counter = cur.execute("SELECT year, last FROM NumberCounter").fetchone()
sync_stats = cur.execute("SELECT COUNT(*) c, MIN(seq) mn, MAX(seq) mx FROM SyncJournal").fetchone()

conn.close()

KIND = {'tractor': 'тягач', 'tipper': 'самосвал', 'van': 'фургон'}
BODY = {'tarp': 'штора', 'fridge': 'реф', 'flatbed': 'борт', 'tank': 'цистерна'}
READY = {'ready': 'готов', 'maintenance': 'обслуживание', 'repair': 'ремонт'}

demo_data_md = (
    '### Демо-данные после сида (фактическое содержимое db/custom.db)\n\n'
    '**Нумератор:** год ' + counter['year'] + ', last=' + str(counter['last']) +
    ' → следующая заявка получит **ЗК-2026/1075**.\n\n'
    '**SyncJournal (план обмена):** ' + str(sync_stats['c']) + ' записей, seq ' + str(sync_stats['mn']) + '–' + str(sync_stats['mx']) +
    ' (TRIP×1, TRIP_POINT×2, SYSTEM_NOTE×1 — демо-водитель; CHAT_MESSAGE×2).\n\n'
    '**Водители (12) — id записи и appId (заголовок X-Driver-Id):**\n\n' +
    table(['ФИО', 'id записи (регенерируется сидом)', 'appId = X-Driver-Id'],
          [[d['fullName'], '`' + d['id'] + '`', d['appId'] or '—'] for d in drivers]) + '\n\n'
    '**ТС (15):**\n\n' +
    table(['Госномер', 'Модель', 'Тип', 'Кузов', 'Грузоподъёмность', 'Готовность'],
          [[v['plate'], v['model'], KIND.get(v['kind'], v['kind']), BODY.get(v['bodyType'], v['bodyType']),
            f"{v['capacityT']} т", READY.get(v['readiness'], v['readiness'])] for v in vehicles]) + '\n\n'
    '**Прицепы (8):** ' + '; '.join(f"{t['plate']} ({t['model']}, {BODY.get(t['type'], t['type'])})" for t in trailers) + '.\n\n'
    '**Контрагенты (4):** ' + '; '.join(f"{c['name']} (ИНН {c['inn']}, {c['kind']})" for c in contractors) + '.\n\n'
    '**Пункты (5):** ' + '; '.join(f"{l['name']} ({l['lat']}, {l['lon']})" for l in locations) + '.\n\n'
    '**Заявки (6):**\n\n' +
    table(['Номер', 'Статус', 'Груз', 'Вес', 'ТС', 'Водитель'],
          [[r['number'], r['status'], r['cargo'], f"{r['weightT']} т", r['veh'] or '—', r['drv'] or '—'] for r in requests]) + '\n\n'
    '**Рейсы (4):** ' + '; '.join(f"{t['tripCode']} ({t['status']}" + (f", last={t['lastEventType']}" if t['lastEventType'] else '') + ')' for t in trips) + '.\n\n'
    '> UUID-ы записей регенерируются при каждом `bun run db:seed`; постоянный ключ водителя — `appId`. '
    'Номера заявок, справочники и статусы после сида всегда одинаковы.\n'
)

# ─────────────────────────── дерево файлов ───────────────────────────

NEW = {
    'HANDOFF.md', 'README.md', 'prisma/schema.prisma', 'prisma/seed.ts', 'src/lib/seedAll.ts',
    'src/lib/cors.ts', 'src/lib/db.ts', 'src/lib/epoch.ts', 'src/lib/photos.ts', 'src/lib/office/serialize.ts',
    'src/app/page.tsx', 'db/custom.db',
    'scripts/acceptance.py', 'scripts/dump_db.py', 'scripts/handoff_curl.py', 'scripts/handoff_curl2.py',
    'src/components/1c/OneCShell.tsx', 'src/components/1c/kit.tsx',
}
NEW_PREFIX = ('src/lib/1c/', 'src/lib/bus/', 'src/app/api/1c/', 'src/app/api/driver/',
              'src/app/api/office/', 'src/components/workspace/')
EDIT = {'src/app/layout.tsx', 'src/app/globals.css', 'next.config.ts', 'package.json', '.env.example'}
SKIP_PREFIX = ('src/components/ui/', 'src/hooks/', 'examples/', 'tests/', 'mini-services/', 'public/',
               'tool-results/', 'upload/', '.zscripts/', '.git/', 'download/')
SKIP = {'.env', 'components.json', 'eslint.config.mjs', 'postcss.config.mjs', 'tailwind.config.ts',
        'tsconfig.json', 'tsconfig.tsbuildinfo', 'next-env.d.ts', 'bun.lock', '.gitignore',
        'Caddyfile', 'src/app/api/route.ts', 'src/lib/utils.ts'}

def mark(p):
    if p in NEW or any(p.startswith(x) for x in NEW_PREFIX):
        return '[NEW]'
    if p in EDIT:
        return '[EDIT]'
    if p in SKIP or any(p.startswith(x) for x in SKIP_PREFIX):
        return '[SKIP]'
    return '[SKIP]'

tree_lines = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = sorted(d for d in dirnames if d not in ('node_modules', '.next', '.git', 'skills'))
    rel = os.path.relpath(dirpath, ROOT)
    depth = 0 if rel == '.' else rel.count(os.sep) + 1
    if rel != '.':
        tree_lines.append('  ' * (depth - 1) + '- ' + os.path.basename(dirpath) + '/')
    for fn in sorted(filenames):
        p = os.path.normpath(os.path.join(rel, fn)) if rel != '.' else fn
        if p == 'HANDOFF.md':
            continue
        tree_lines.append('  ' * depth + '- ' + fn + ' ' + mark(p))
tree_md = '\n'.join(tree_lines)
dir_notes = (
    '- `node_modules/`, `.next/` — присутствуют, в пакет не включены\n'
    '- `uploads/` — присутствует (фото предрейсовых осмотров; после сида пуста)\n'
    '- `skills/`, `tool-results/`, `.zscripts/`, `tests/`, `examples/`, `mini-services/` — служебные папки песочницы (не платформа)\n'
    '- `.zscripts/verify-*.png` — 18 скриншотов UI-прогонов предыдущей сессии (визуальная проверка экранов)'
)

# ─────────────────────────── живые примеры (захвачены в этой сессии) ───────────────────────────

EX = {}

EX['orders_get'] = """$ curl -H 'X-Driver-Id: d1111111-1111-4111-8111-111111111111' http://localhost:3000/api/1c/orders
→ 200
{"source":"1c-stand","note":"Эмулятор 1С: список заявок водителя","orders":[{ "number":"ЗК-2026/1067",
"externalId":"71e4f16f-2ca6-484f-8dd6-62540f21b0d6","client":"ООО «Новороссийский терминал»",
"cargo":"Металлоконструкции (фермы), штучные","weightT":18.5,"fromLabel":"Абинск, пл. АЗМЗ",
"toLabel":"Новороссийск, причал 27","loadingAt":"2026-11-12T06:30:00.000Z","unloadingWindow":"сегодня 14:00–16:00",
"vehicle":"МАЗ 5440 · А 123 БС 23","trailer":"НЕФАЗ 93341 · АВ 456 23",
"docs":["ТТН (2 экз.)","Паспорт груза","Пропуск на терминал","Акт допуска ТС"],
"distanceKm":115,"durationMin":150,"status":"ASSIGNED","assignedBy":"Диспетчер Е. Крылова"}, …],
"eventLog":[]} // всего orders=3 на чистом сиде"""

EX['orders_post_reject'] = """$ curl -X POST http://localhost:3000/api/1c/orders -H 'Content-Type: application/json' \\
  -H 'X-Driver-Id: d1111111-1111-4111-8111-111111111111' -d '{"orderId":"ЗК-2026/1071","action":"ASSIGN"}'
→ 400 {"ok":false,"error":"Действие ASSIGN в обратном канале запрещено — назначение выполняет только диспетчер"}"""

EX['orders_post_start409'] = """$ curl -X POST … -d '{"orderId":"ЗК-2026/1071","action":"START_ROUTE"}'  (после 1-го шага осмотра)
→ 409 {"ok":false,"error":"Предрейсовый осмотр не завершён. Не хватает шагов: veh_front, veh_rear, order_docs, lic, passport"}"""

EX['pull'] = """$ curl -H 'X-Driver-Id: <id-Иванова>' 'http://localhost:3000/api/driver/v1/sync/pull?cursor=0'
→ 200
{"entries":[
 {"seq":262,"entity":"TRIP","op":"UPSERT","payload":{"id":"5f5c38cc-…","tripCode":"ЗК-2026/1067","status":"assigned",
  "driverId":"4f64a559-…","vehicleId":"e9728a1b-…","plannedStartAt":1794465000000,"plannedFinishAt":1794474000000,
  "routeGeoJson":"{\\"type\\":\\"LineString\\",\\"coordinates\\":[[38.158,44.868],…]}","routeStepsJson":null,
  "routeDistanceM":115000,"routeDurationS":9000,…}},
 {"seq":263,"entity":"TRIP_POINT","op":"UPSERT","payload":{…seqNo:1, kind:"loading", lat:44.868, lon:38.158,…}},
 {"seq":264,"entity":"TRIP_POINT","op":"UPSERT","payload":{…seqNo:2, kind:"unloading", lat:44.685, lon:37.775,…}},
 {"seq":265,"entity":"SYSTEM_NOTE","op":"UPSERT","payload":{…kind:"ORDER_ASSIGNED", body:"Вам назначена заявка ЗК-2026/1067…"}},
 {"seq":266,"entity":"CHAT_MESSAGE","op":"UPSERT","payload":{…sender:"DISPATCHER","body":"Добрый день, Сергей!…"}},
 {"seq":267,"entity":"CHAT_MESSAGE","op":"UPSERT","payload":{…sender:"DRIVER","body":"Принял, добрый день.…"}}],
"cursor":267,"hasMore":false}"""

EX['push'] = """$ curl -X POST http://localhost:3000/api/driver/v1/sync/push -H 'Content-Type: application/json' \\
  -H 'X-Driver-Id: d1111111-1111-4111-8111-111111111111' -d '{"deviceId":"handoff-device","operations":[
    {"opId":"handoff-demo-op-0001","type":"MARK_PUBLISH","payload":{"category":"POTHOLE",
     "geometry":{"type":"LineString","coordinates":[[37.78,44.7],[37.8,44.71],[37.82,44.72]]},
     "comment":"Яма у поворота (проверка handoff)","ttlHours":6}}]}'
→ 200 {"results":[{"opId":"handoff-demo-op-0001","status":"APPLIED"}]}
// повтор того же opId → 200 {"results":[{"opId":"handoff-demo-op-0001","status":"APPLIED"}]} (идемпотентно)
// далее GET /api/driver/v1/sync/marks → marks=1 (пометка видна в снимке)"""

EX['marks'] = """$ curl 'http://localhost:3000/api/driver/v1/sync/marks'   (после публикации из примера push)
→ 200 {"snapshotAt":1794402408368,"marks":[{"id":"f9086a4b-…","category":"POTHOLE",
"geometry":"{\\"type\\":\\"LineString\\",…}","comment":"Яма у поворота (проверка handoff)",
"ttlHours":6,"confirmCount":0,"outdatedCount":0,"createdAt":1794402408…,"expiresAt":1794424008…}]}
// на чистом сиде marks=0"""

EX['traffic'] = """$ curl 'http://localhost:3000/api/driver/v1/traffic'
→ 200 {"snapshotAt":1794402408276,"segments":[{"id":"osm:way:1000:3","title":"А-146 · Гайдук — Крымск",
"geometry":"{\\"type\\":\\"LineString\\",…}","level":7,"speedKmh":34,"onRoute":true,"updatedAt":…}, …]}
// сегментов 5–8, демо-генератор перегенерирует при снимке старше 60 с"""

EX['dashboard'] = """$ curl http://localhost:3000/api/office/dashboard
→ 200 {"counts":{"NEW":0,"DISPATCH":2,"ASSIGNED":1,"ACCEPTED":0,"PRETRIP":0,"IN_PROGRESS":0,"DONE":3,"CANCELLED":0},
"total":6,"statusOrder":["NEW","DISPATCH","ASSIGNED","ACCEPTED","PRETRIP","IN_PROGRESS","DONE","CANCELLED"],
"activeTrips":[{"tripCode":"ЗК-2026/1067","status":"assigned","lastEventType":null,"lastEventAt":null,
"driver":"Иванов Сергей Петрович","vehicle":"МАЗ 5440 · А 123 БС 23","from":"Абинск, пл. АЗМЗ",
"to":"Новороссийск, причал 27"}],"feed":[…12 записей журнала…]}}"""

EX['requests_get'] = """$ curl 'http://localhost:3000/api/office/requests'
→ 200 {"requests":[{"id":"…","number":"ЗК-2026/1074","externalId":"…","createdAt":"…","status":"DISPATCH",
"statusLabel":"DISPATCH","contractor":{"id":"…","name":"ООО «Донсталь»"},"cargo":"Металлопрокат листовой, 2 шт.",
"weightT":20.2,"from":{…},"to":{…},"loadingAt":"…","unloadingWindow":"послезавтра 09:00–11:00",
"docs":["ТТН (2 экз.)","Паспорт груза"],"vehicle":null,"trailer":null,"driver":null,"assignedBy":null,
"assignedAt":null,"closeReason":null,"trip":null,"pretrip":{"done":0,"total":6,"steps":[]}}, …],
"counts":{…}} // 6 заявок на чистом сиде"""

EX['requests_post'] = """$ curl -X POST http://localhost:3000/api/office/requests -H 'Content-Type: application/json' \\
  -d '{"contractorId":"<id>","cargo":"Оборудование промышленное, ящики","weightT":9.5,
       "fromLocationId":"<id>","toLocationId":"<id>","loadingAt":"2026-11-13T08:00:00.000Z",
       "unloadingWindow":"на следующий день 09:00–11:00","docs":["ТТН (2 экз.)","Паспорт груза"],"actor":"Логист"}'
→ 200 {"ok":true,"request":{…,"number":"ЗК-2026/1075","status":"DISPATCH",…}}"""

EX['assign'] = """$ curl -X POST http://localhost:3000/api/office/requests/<requestId>/assign -H 'Content-Type: application/json' \\
  -d '{"vehicleId":"<id-МАЗ 6312>","driverId":"<id-Петрова>","actor":"Диспетчер Е. Крылова"}'
→ 200 {"ok":true,"requestId":"be2de5d9-…","tripId":"0fa6c117-…","number":"ЗК-2026/1074"}
// отказ проведения (занятый водитель) → 400
// {"ok":false,"errors":["Занят в незавершённом рейсе ЗК-2026/1076"]}"""

EX['cancel'] = """$ curl -X POST http://localhost:3000/api/office/requests/<requestId>/cancel -H 'Content-Type: application/json' \\
  -d '{"reason":"Отмена заказчиком","actor":"Диспетчер Е. Крылова"}'
→ 200 {"ok":true,"number":"ЗК-2026/1074"}"""

EX['trips'] = """$ curl http://localhost:3000/api/office/trips   (после назначения из примера assign)
→ 200 {"trips":[{…,"number":"ЗК-2026/1074","status":"ASSIGNED","lastEventLabel":null,
"openIntervals":[],"trip":{"points":2,"routeDistanceM":346638,"routeDurationS":…}}, …]}"""

EX['chat'] = """$ curl -X POST http://localhost:3000/api/office/chat -H 'Content-Type: application/json' \\
  -d '{"driverId":"<id-водителя>","body":"Проверка доставки чата через план обмена"}'
→ 200 {"ok":true,"message":{"id":"…","sender":"DISPATCHER","body":"Проверка доставки чата через план обмена","at":"…"}}
// далее GET /api/driver/v1/sync/pull?cursor=0 (X-Driver-Id водителя) → в entries есть CHAT_MESSAGE с этим телом
// (проверено шагом 9 сценария приёмки)"""

EX['catalog'] = """$ curl http://localhost:3000/api/office/catalog/drivers
→ 200 {"rows":[{"id":"4f64a559-…","fullName":"Иванов Сергей Петрович","phone":"+7 (918) 201-15-32",
"licenseNo":"5412 889012","isActive":true,"appId":"d1111111-1111-4111-8111-111111111111","createdAt":"…"}, …]} // rows=12"""

EX['journal'] = """$ curl 'http://localhost:3000/api/office/journal?limit=3'   (после действий примеров assign/cancel)
→ 200 {"rows":[
 {"id":…,"user":"Диспетчер Е. Крылова","action":"CANCEL","entity":"TransportRequest","entityId":"ЗК-2026/1074","level":"info","at":"2026-11-11T13:10:59.279Z"},
 {"id":…,"user":"Диспетчер Е. Крылова","action":"ASSIGN","entity":"TransportRequest","entityId":"ЗК-2026/1074","level":"info","at":"2026-11-11T13:10:59.146Z"},
 {"id":…,"user":"Логист","action":"REQUEST_CREATE","entity":"TransportRequest","entityId":"ЗК-2026/1063","level":"info","at":"…"}]}"""

EX['demo'] = """$ curl -X POST http://localhost:3000/api/office/demo -H 'Content-Type: application/json' -d '{"action":"autoflow"}'
→ 200 {"ok":true,"log":[
 {"step":"Заявка","ok":true,"detail":"ЗК-2026/1071 в статусе DISPATCH"},
 {"step":"Назначение","ok":true,"detail":"ЗК-2026/1071 → КАМАЗ 5490 · К 456 МН 23, Петров Андрей Николаевич"},
 {"step":"Водитель: ACCEPT","ok":true,"detail":"статус ACCEPTED"},
 {"step":"Фотофиксация","ok":true,"detail":"6 из 6 шагов записаны"},
 {"step":"Старт маршрута","ok":true,"detail":"TripEvent DEPARTURE, статус IN_PROGRESS"},
 {"step":"Завершение рейса","ok":true,"detail":"TripEvent TRIP_DONE, интервалы закрыты, заявка DONE"},
 {"step":"Чат","ok":true,"detail":"Сообщение диспетчера в плане обмена (seq SyncJournal обновлён, id b567e974…)"}]}"""

EX['files'] = """$ curl -I http://localhost:3000/api/office/files/<uuid>.png
→ 200, Content-Type: image/png   (файл из uploads/; каждый просмотр пишется в журнал как PHOTO_VIEW)"""

# ─────────────────────────── ЧАСТЬ 1 ───────────────────────────

part1 = f"""## ЧАСТЬ 1 — МАНИФЕСТ ПРОЕКТА

### Фазы (по таблице 13 ТЗ) — все реализованы

| Фаза | Содержание по ТЗ | Что достигнуто | Свидетельство |
|---|---|---|---|
| 0. Каркас | Next.js + TS + Prisma; схема БД целиком; сид | dev-сервер поднимается; сид создаёт справочники и 6 заявок | `bun run db:seed` — «Сид готов: 6 заявок…» (выполнено в этой сессии) |
| 1. Ядро «1С» | Нумератор ЗК-ГГГГ/NNNN; журнал регистрации; CRUD справочников; TransportRequest + StatusHistory | Нумератор атомарный (upsert счётчика в транзакции + мьютекс записи); журнал пишется из каждого сервиса; CRUD `/api/office/catalog/*` | создание ЗК-2026/1075 → 200; журнал REQUEST_CREATE; приёмка шаг «ж» |
| 2. Диспетчеризация | Правила 5.2/5.3; assign = рождение рейса одной транзакцией; cancel с причиной | assign: валидации → ASSIGNED + StatusHistory + Trip + 2 TripPoint + SyncJournal + SystemNote в одной транзакции; отказ с человеческой причиной | приёмка шаги 3, 3а, 9b; живой пример assign/cancel |
| 3. Шина | pull/push с appliers, marks, traffic; /api/1c/orders GET/POST | Все 5 типов push-операций, авто-закрытие интервалов, автостатусы, идемпотентность opId | приёмка 15/15; живые curl-примеры pull/push/marks/traffic |
| 4. UI офиса | Дашборд, Заявки, Диспетчерская, Рейсы, Чат, Справочники, Журнал, Демо-панель | 8 рабочих мест в оболочке «1С:Предприятие 8.3 (Такси)», поллинг 5 с, демо-панель с автопрогоном | `POST /api/office/demo autoflow` → 7/7 шагов OK; скриншоты `.zscripts/verify-*.png` |
| 5. Проверка и документация | 10.2 подключение приложения водителя; README; .env.example | README с curl-примерами; .env.example целиком; инструкция интеграции — Часть 5 этого пакета | сборка `bun run build` проходит (12 с, 19 маршрутов); приёмка 15/15 |

Критерий фазы 5 «приложение водителя проходит поток без правок кода» — на стороне принимающей сессии (см. «Интеграция» в Части 5).

### Стек (фактические версии)

- Next.js **16.1.3** (App Router, Route Handlers, `output: standalone`), React **19.2.3**, TypeScript 5
- Prisma **6.19.2** (`@prisma/client ^6.11.1`); провайдер БД: **SQLite** `file:./db/custom.db` (демо), PostgreSQL переключается в `DATABASE_URL` без правок кода (схема provider="sqlite" — для Postgres сменить на "postgresql" и `db:push`)
- Tailwind CSS **4** + shadcn/ui (каркасные компоненты `src/components/ui/*`), оболочка 1С — собственные `src/components/1c/*`
- Рантайм: Bun **1.3.14**, Node v24.22.2; песочница Linux
- Порт: в песочнице dev работает на **3000** (`next dev -p 3000`); переменная `PORT=3001` в `.env` — для отдельного деплоя согласно ТЗ

### Команды

```bash
bun install                 # установка зависимостей (bun.lock зафиксирован)
bun run db:generate         # prisma generate
bun run db:push             # схема Prisma -> SQLite (db/custom.db), --accept-data-loss
bun run db:seed             # демо-сид (bun prisma/seed.ts): 15 ТС, 8 прицепов, 12 водителей, 6 заявок
bun run dev                 # next dev -p 3000, лог в dev.log
bun run build               # next build (standalone) + копирование static/public — проверено, 12 с
bun run start               # NODE_ENV=production bun .next/standalone/server.js
python3 scripts/acceptance.py http://localhost:3000   # сценарий приёмки 10.1 (шаги 1, 3–9 + контроли)
```

### Переменные окружения — .env.example целиком

{fence('.env.example')}

Фактический `.env` песочницы: `DATABASE_URL=file:/home/z/my-project/db/custom.db?connection_limit=1` (остальные значения как в .env.example; `GIS2_API_KEY` пуст — работает заглушка роутинга).

### Дерево файлов

{tree_md}

{dir_notes}

Пометки: `[NEW]` — написан сессиями платформы «Контур 1С»; `[EDIT]` — изменён относительно каркаса песочницы; `[SKIP]` — каркас песочницы / shadcn-ui / входные материалы, содержимое не менялось. Пометки относительно каркаса песочницы (git-история проекта нечувствительна к этому различию — первый коммит пуст).
"""

# ─────────────────────────── ЧАСТЬ 2 ───────────────────────────

core_files = [
    'prisma/seed.ts', 'src/lib/seedAll.ts',
    'src/lib/1c/numbering.ts', 'src/lib/1c/journal.ts', 'src/lib/1c/statuses.ts',
    'src/lib/1c/requests.ts', 'src/lib/1c/assign.ts', 'src/lib/1c/cancel.ts',
    'src/lib/1c/eligibility.ts', 'src/lib/1c/route.ts', 'src/lib/1c/tripEvents.ts',
    'src/lib/1c/driverActions.ts', 'src/lib/1c/statusCounts.ts', 'src/lib/1c/dblike.ts',
    'src/lib/1c/demos.ts',
    'src/lib/db.ts', 'src/lib/epoch.ts', 'src/lib/cors.ts', 'src/lib/photos.ts',
    'src/lib/office/serialize.ts',
    'src/lib/bus/syncWriter.ts', 'src/lib/bus/snapshots.ts', 'src/lib/bus/appliers.ts', 'src/lib/bus/traffic.ts',
]

part2 = f"""## ЧАСТЬ 2 — ДАННЫЕ И ЯДРО

### prisma/schema.prisma — целиком

{fence('prisma/schema.prisma')}

### Сид и фактические демо-данные

Скрипт сида: `prisma/seed.ts` (обёртка) → общий модуль `src/lib/seedAll.ts` (используется и кнопкой «Сброс и пересев» демо-панели). Запуск: `bun run db:seed`.

{demo_data_md}

### Хелперы ядра — файлы целиком

Порядок: сид → нумератор → журнал регистрации → статусная модель → документ заявки → правила назначения → рождение рейса (проведение) → отмена → роутинг → события рейса → обратный канал водителя → счётчики → план обмена (писатель, снимки, appliers, пробки) → инфраструктура (БД/время/CORS/фото/сериализация) → демо-сервисы.

{chr(10).join(fence(p) for p in core_files)}
"""

# ─────────────────────────── ЧАСТЬ 3 ───────────────────────────

office_files = [
    'src/app/api/office/requests/route.ts',
    'src/app/api/office/requests/[id]/assign/route.ts',
    'src/app/api/office/requests/[id]/cancel/route.ts',
    'src/app/api/office/dashboard/route.ts',
    'src/app/api/office/trips/route.ts',
    'src/app/api/office/chat/route.ts',
    'src/app/api/office/journal/route.ts',
    'src/app/api/office/catalog/[entity]/route.ts',
    'src/app/api/office/catalog/[entity]/[id]/route.ts',
    'src/app/api/office/demo/route.ts',
    'src/app/api/office/files/[name]/route.ts',
]

part3 = f"""## ЧАСТЬ 3 — API-КОНТРАКТЫ (все маршруты, файлы целиком + живые примеры)

Все примеры ниже — реальные запросы/ответы, захваченные curl-прогонами 2026-11-11 в этой сессии против `http://localhost:3000` на свежем сиде. Служебное: CORS-заголовки на `/api/1c/*` и `/api/driver/v1/*` — `Access-Control-Allow-Origin: $DRIVER_APP_ORIGIN` (демо `*`), `Access-Control-Allow-Headers: Content-Type, X-Driver-Id`, `OPTIONS` → 204.

### 3.1 HTTP-сервис «1С»: /api/1c/orders (GET/POST)

{fence('src/app/api/1c/orders/route.ts')}

Живой пример GET:

```
{EX['orders_get']}
```

Живой пример POST (запрещённое действие — контроль обратного канала):

```
{EX['orders_post_reject']}
```

Живой пример POST (отказ старта до осмотра — 409, шаг 7а приёмки):

```
{EX['orders_post_start409']}
```

### 3.2 Шина: /api/driver/v1/sync/pull (GET)

{fence('src/app/api/driver/v1/sync/pull/route.ts')}

Живой пример (демо-водитель, свежий сид):

```
{EX['pull']}
```

### 3.3 Шина: /api/driver/v1/sync/push (POST)

{fence('src/app/api/driver/v1/sync/push/route.ts')}

Живой пример (MARK_PUBLISH + повтор того же opId):

```
{EX['push']}
```

Семантика apply — `src/lib/bus/appliers.ts` (целиком в Части 2): `APPLIED` — применено; повтор `opId` возвращает сохранённый результат (для MARK_PUBLISH это снова `APPLIED` — «тот же результат»; для CHAT_SEND с существующим id и NOTE_READ — `DUPLICATE`); `REJECTED` — финален, `rejectReason` из множества: BAD_OPERATION, TRIP_NOT_FOUND, TRIP_NOT_OWNED, TRIP_CLOSED, RATE_LIMIT, BAD_CATEGORY, BAD_GEOMETRY, BAD_VOTE, MARK_NOT_FOUND, MARK_EXPIRED, EMPTY_BODY, NOTE_NOT_FOUND, UNKNOWN_TYPE.

### 3.4 Шина: /api/driver/v1/sync/marks (GET)

{fence('src/app/api/driver/v1/sync/marks/route.ts')}

Живой пример:

```
{EX['marks']}
```

### 3.5 Шина: /api/driver/v1/traffic (GET)

{fence('src/app/api/driver/v1/traffic/route.ts')}

Живой пример:

```
{EX['traffic']}
```

### 3.6 Офис: /api/office/requests (GET/POST)

{fence(office_files[0])}

Живые примеры:

```
{EX['requests_get']}
```

```
{EX['requests_post']}
```

### 3.7 Офис: /api/office/requests/[id]/assign (POST)

{fence(office_files[1])}

Живой пример (и отказ по правилу занятости):

```
{EX['assign']}
```

### 3.8 Офис: /api/office/requests/[id]/cancel (POST)

{fence(office_files[2])}

Живой пример:

```
{EX['cancel']}
```

### 3.9 Офис: /api/office/dashboard (GET)

{fence(office_files[3])}

Живой пример:

```
{EX['dashboard']}
```

### 3.10 Офис: /api/office/trips (GET)

{fence(office_files[4])}

Живой пример:

```
{EX['trips']}
```

### 3.11 Офис: /api/office/chat (GET/POST)

{fence(office_files[5])}

Живой пример:

```
{EX['chat']}
```

### 3.12 Офис: /api/office/journal (GET)

{fence(office_files[6])}

Живой пример:

```
{EX['journal']}
```

### 3.13 Офис: /api/office/catalog/[entity] (GET/POST) и /[id] (PATCH/DELETE)

{fence(office_files[7])}

{fence(office_files[8])}

Живой пример GET:

```
{EX['catalog']}
```

### 3.14 Офис: /api/office/demo (POST)

{fence(office_files[9])}

Живой пример автопрогона (выполнен в этой сессии):

```
{EX['demo']}
```

### 3.15 Офис: /api/office/files/[name] (GET)

{fence(office_files[10])}

Живой пример:

```
{EX['files']}
```

### 3.16 Прочее

`src/app/api/route.ts` — заглушка каркаса песочницы (`{{"message":"Hello, world!"}}`), к платформе не относится.
"""

# ─────────────────────────── ЧАСТЬ 4 ───────────────────────────

ui_list = """| Экран/компонент | Путь | Что делает (одна строка) |
|---|---|---|
| Оболочка «1С:Такси» | `src/components/1c/OneCShell.tsx` | Заголовок приложения, панель разделов, панель открытых окон, строка состояния |
| Примитивы 1С | `src/components/1c/kit.tsx` | Логотип, кнопки, поля, шапки форм, таблицы в стиле 1С (жёлто-красная тема) |
| Композитор рабочих мест | `src/components/workspace/Workspace.tsx` | Панель разделов с правами ролей (Логист/Диспетчер/Админ), открытые окна как формы 1С, роль в localStorage |
| Главная страница | `src/components/workspace/DashboardScreen.tsx` | Плитки счётчиков по статусам, активные рейсы, лента журнала регистрации |
| Заказы грузоотправителей | `src/components/workspace/RequestsScreen.tsx` | Рабочее место сбыта: дерево заказов + создание заявки (нумератор), нижняя панель «Путевые листы» |
| Маршрутные листы | `src/components/workspace/DispatchScreen.tsx` | Рабочее место диспетчерской: пул DISPATCH, подбор ТС по правилам 5.2 с бейджами причин негодности, назначение/отмена |
| Рейсы | `src/components/workspace/TripsScreen.tsx` | Реестр рейсов: статусы из событий, открытые интервалы, прогресс предрейсового осмотра |
| Обсуждение | `src/components/workspace/ChatScreen.tsx` | Чат диспетчера с водителями, отправка через SyncJournal |
| Справочники (НСИ) | `src/components/workspace/CatalogsScreen.tsx` | Вкладки справочников, создание/правка/пометка удаления записей |
| Журнал регистрации | `src/components/workspace/JournalScreen.tsx` | Лента «кто/что/когда/уровень» с фильтрами |
| Демо-панель | `src/components/workspace/DemoScreen.tsx` | Случайная заявка, автопрогон сценария 10.1, сброс и пересев, имитатор приложения водителя (ACCEPT/осмотр/старт/завершение) |
| Точки статусов | `src/components/workspace/badges.tsx` | Цветные маркеры статусов в стиле 1С |
| Поллинг | `src/components/workspace/usePoll.ts` | Опрос экрана раз в 5 с (SSE — вторая очередь по ТЗ) |
| API-клиент | `src/components/workspace/api.ts` | fetch-обёртки apiGet/apiPost + форматирование даты/интервалов |

Страница-вход: `src/app/page.tsx` рендерит `<Workspace/>`; тема 1С — блок `.c1-*` в `src/app/globals.css`; метаданные и `lang="ru"` — в `src/app/layout.tsx`."""

part4 = f"""## ЧАСТЬ 4 — UI (сжато)

{ui_list}

### Файлы с бизнес-логикой — целиком

{fence('src/components/workspace/Workspace.tsx')}

{fence('src/components/workspace/DispatchScreen.tsx')}

{fence('src/components/workspace/RequestsScreen.tsx')}

Остальные экраны (Dashboard/Trips/Chat/Catalogs/Journal/Demo, OneCShell, kit, badges, usePoll, api) — чистая презентация + fetch-вызовы к контрактам Части 3; тела в архиве `kontur-1c-handoff.zip`.
"""

# ─────────────────────────── ЧАСТЬ 5 ───────────────────────────

part5 = """## ЧАСТЬ 5 — ПРОВЕРЕНО / НЕ ПРОВЕРЕНО / ПРОБЕЛЫ

### Проверено (реально выполнено в этой сессии, 2026-11-11)

1. `bun run db:seed` — пересев БД, «Сид готов: 6 заявок (1067 ASSIGNED, 1071/1074 DISPATCH, 3 DONE), нумератор на ЗК-2026/1075».
2. Живые curl-проверки контрактов (скрипт `scripts/handoff_curl.py`): GET /api/1c/orders (3 заявки, формат 6.1 поле-в-поле), GET /api/driver/v1/sync/pull (6 записей: TRIP, TRIP_POINT×2, SYSTEM_NOTE, CHAT_MESSAGE×2), GET /api/office/dashboard, /api/office/requests, /api/office/catalog/drivers, /api/driver/v1/traffic (8 сегментов), /api/driver/v1/sync/marks (0), POST /api/office/requests (создана ЗК-2026/1075), POST /api/1c/orders action=ASSIGN → 400, POST /api/driver/v1/sync/push MARK_PUBLISH → APPLIED и повтор того же opId → APPLIED (идемпотентно), GET marks → 1 пометка.
3. Живые примеры офисных операций (`scripts/handoff_curl2.py`): assign ЗК-2026/1074 → 200 {ok, requestId, tripId, number}; GET /api/office/trips → рейс с 2 точками и маршрутом 346638 м (заглушка роутинга); cancel → 200; GET /api/office/journal → ASSIGN и CANCEL зафиксированы.
4. **Сценарий приёмки 10.1** (`scripts/acceptance.py`): на чистом сиде — **15/15 шагов пройдено**, включая: формат 6.1, создание заявки, атомарное назначение (trip + 2 точки + SyncJournal в одной транзакции), доставку pull водителю №2, ACCEPT, отказ START_ROUTE до осмотра (409 с перечнем недостающих шагов), 6×PRETRIP_STEP, START_ROUTE → DEPARTURE/IN_PROGRESS, COMPLETE_TRIP → TRIP_DONE/закрытые интервалы/DONE, контроль 409 без осмотра, отказ проведения занятому водителю (правило 5.3), чат через план обмена, отмена назначенной заявки → SystemNote, полнота журнала регистрации.
   - Первый прогон дал 14/15: шаг 1 «упал» из-за лишней заявки, созданной моим же curl-тестом перед прогоном (скрипт ожидает свежий сид). После пересева — 15/15. Это ограничение теста, не платформы.
5. `POST /api/office/demo {"action":"autoflow"}` → ok=true, 7/7 шагов (заявка → назначение → ACCEPT → 6 шагов осмотра → старт → завершение → чат).
6. `GET /api/office/files/<uuid>.png` → 200 image/png, в журнале появилась запись PHOTO_VIEW.
7. `bun run build` — production-сборка проходит за ~12 с, все 19 маршрутов собираются (standalone).
8. Предыдущая сессия оставила 18 скриншотов UI-прогонов (`.zscripts/verify-*.png`) — визуальная проверка оболочки 1С и всех экранов.

### Не проверено

- Подключение **реального** приложения водителя (критерий фазы 5 / раздел 10.2 ТЗ) — выполняется принимающей сессией; контрактно поток проверен curl-ами и приёмкой.
- PostgreSQL-контур стенда (работал только SQLite; смена провайдера требует правки `provider` в schema.prisma).
- 2ГИС Routing с реальным ключом `GIS2_API_KEY` (всегда работал stub: прямая ×1.2, 55 км/ч); код вызова реализован и не блокирует транзакцию.
- SSE/WebSocket для офиса (вторая очередь ТЗ) — работает поллинг 5 с.
- Multipart-upload фото (выбран base64 в JSON); хранение в `uploads/` работает.
- Долговременная работа под нагрузкой, конкурентные записи из нескольких процессов Node (мьютекс записи гарантирует порядок только в одном процессе).

### Пробелы / TODO / допущения

- **План обмена и seq**: `SyncJournal.seq` — autoincrement SQLite и не сбрасывается при пересеве (после пересева seq продолжается с ~260–330). Курсор клиента хранить у себя; после осознанного пересева базы сбрасывать локальный курсор на 0.
- **Мьютекс записи** (`withWriteLock`) — очередь промисов в одном процессе: атомарность гарантируется для одного инстанса Node. Для горизонтального масштабирования нужен PostgreSQL + его блокировки.
- **Демо-фолбэк водителя**: без заголовка `X-Driver-Id` контракты отдают демо-водителя Иванова (удобно для стенда, небезопасно для боевого контура — на стенде держать `DRIVER_APP_ORIGIN` ограниченным).
- **CHAT_SEND идемпотентность** опирается на клиентский `id` сообщения (UUID); push без `id` создаёт новое сообщение при каждом повторе.
- **MARK_PUBLISH повтор** того же opId возвращает `APPLIED` (сохранённый результат), а не отдельный статус `DUPLICATE` — семантика «повторная доставка даёт тот же результат».
- **Office API без авторизации** (роли — только фильтр разделов в UI, без паролей — демо-режим по ТЗ).
- **`Waybill`** — каркас таблицы без логики (путевые листы — вторая очередь).
- **`next.config.ts`**: `typescript.ignoreBuildErrors: true` — унаследовано от каркаса песочницы (сборка не падает на TS-ошибках; на момент выгрузки их нет).
- Нумератор при первом создании счётчика года стартует с 1001 (`create: {last: 1001}`), сид задаёт 1074 — поведение согласовано с ТЗ (ЗК-ГГГГ/NNNN, без пропусков).
- UI-тексты и статусы на кнопках живут в экранах `src/components/workspace/*` (тела — в архиве); доменные запреты продублированы на сервере (источник истины — серверные коды ответов).

### Интеграция (точные инструкции для приложения водителя)

1. **Базовый URL**: переменная `KONTUR_1C_URL` (или что использует приложение вместо захардкоженного origin «1С») → `http://<хост-песочницы>:3000` (в песочнице сервер уже слушает 3000; для отдельного деплоя — порт из `PORT`, по ТЗ 3001). Смена base URL — единственная требуемая правка по ТЗ (раздел 10.2).
2. **Какие каналы переключить**:
   - `GET/POST /api/1c/orders` — список заявок (формат 6.1, поле-в-поле) и обратный канал действий (ACCEPT, PRETRIP_STEP, START_ROUTE, COMPLETE_TRIP; action=ASSIGN запрещён — 400);
   - `GET /api/driver/v1/sync/pull?cursor=<seq>&limit=<n>` — дельта личного журнала (TRIP, TRIP_POINT, TRIP_EVENT, CHAT_MESSAGE, SYSTEM_NOTE; время — epoch millis);
   - `POST /api/driver/v1/sync/push` — операции водителя (TRIP_EVENT_CREATE, MARK_PUBLISH, MARK_VOTE, CHAT_SEND, NOTE_READ) с `opId` (UUID) на каждую операцию;
   - `GET /api/driver/v1/sync/marks?minLat&minLon&maxLat&maxLon` — снимок пометок «водители для водителей»;
   - `GET /api/driver/v1/traffic?bbox` — снимок пробок (демо-генератор).
3. **Заголовок идентификации водителя**: `X-Driver-Id`. Платформа ищет по `Driver.appId`, затем по `id` записи. Годные значения из сида: `d1111111-1111-4111-8111-111111111111` (Иванов С.П., демо-водитель приложения) — постоянный ключ; либо `id` записи любого из 12 водителей (uuid-ы регенерируются сидом — сверяйтесь через `GET /api/office/catalog/drivers`). Без заголовка платформа подставляет демо-водителя.
4. **CORS/origin**: платформа отвечает `Access-Control-Allow-Origin: $DRIVER_APP_ORIGIN` (в демо `*`), `Access-Control-Allow-Headers: Content-Type, X-Driver-Id`, `OPTIONS` → 204 на всех интеграционных маршрутах. Для ограничения — задать `DRIVER_APP_ORIGIN=https://<origin приложения>` и перезапустить.
5. **Как поднять всё вместе для сквозного теста**:
   ```bash
   cd /home/z/my-project   # или куда распакован kontur-1c-handoff.zip
   bun install && bun run db:generate && bun run db:push && bun run db:seed
   bun run dev             # http://localhost:3000
   python3 scripts/acceptance.py http://localhost:3000   # ожидание: ИТОГО 15/15
   ```
   Затем в приложении водителя указать base URL `http://localhost:3000` и заголовок `X-Driver-Id: d1111111-1111-4111-8111-111111111111`: на чистом сиде драйвер сразу увидит ЗК-2026/1067 (ASSIGNED, МАЗ 5440 · А 123 БС 23 + НЕФАЗ 93341 · АВ 456 23, 115 км/150 мин, 4 документа) в pull и в /api/1c/orders.
6. **Порядок статусов заявки** (внутренний → в контракте водителя через `mapOrderStatus`): NEW/DISPATCH→`DISPATCH`, ASSIGNED/ACCEPTED/PRETRIP/IN_PROGRESS→`ASSIGNED`, DONE→`DONE`, CANCELLED — не отдаётся (водитель получает SystemNote ORDER_CANCELLED через pull). Отмена диспетчером доступна для любых статусов, кроме DONE/CANCELLED, и всегда доставляет SystemNote.
"""

# ─────────────────────────── ЧАСТЬ 6 + шапка ───────────────────────────

now = datetime.now().strftime('%Y-%m-%d %H:%M:%S (UTC+3, Europe/Moscow)')

part6 = """## ЧАСТЬ 6 — ФАЙЛЫ

Этот пакет сохранён в корень проекта: `/home/z/my-project/HANDOFF.md`.
Архив со всем проектом (без `node_modules` и `.next`, с HANDOFF.md внутри): `/home/z/my-project/download/kontur-1c-handoff.zip`.
Копия пакета для прямой отдачи: `/home/z/my-project/download/HANDOFF.md`.

Восстановление: распаковать архив → `bun install && bun run db:generate && bun run db:push && bun run db:seed` → `bun run dev` (порт 3000) → приёмка `python3 scripts/acceptance.py` (15/15).
"""

header = f"""# HANDOFF: веб-платформа «Контур 1С»
Эмулятор учётного контура 1С для приложения водителя «АЗМЗ Логистика» (Next.js + TypeScript + Tailwind + shadcn/ui + Prisma, SQLite; песочница: порт 3000, целевой origin по ТЗ — 3001).
Выгрузка состояния на {now}. Все примеры запросов/ответов — реальные (curl-прогоны этой сессии). UUID-ы демо-данных — от последнего `bun run db:seed` и регенерируются при каждом сиде; постоянный ключ водителя — appId `d1111111-1111-4111-8111-111111111111`.

"""

doc = header + part1 + '\n' + part2 + '\n' + part3 + '\n' + part4 + '\n' + part5 + '\n' + part6

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(doc)

print(f'HANDOFF.md записан: {OUT}, {len(doc)} символов, {doc.count(chr(10))} строк')
print(f'fenced-блоков: {doc.count("```") // 2}')
