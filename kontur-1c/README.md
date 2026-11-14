# «Контур 1С» — эмулятор учётного контура 1С для приложения водителя «АЗМЗ Логистика»

Промежуточная веб-платформа (интеграционный стенд), которая архитектурно повторяет механику 1С —
справочники, документы с нумерацией и проведением, статусы, регистры, журнал регистрации, план обмена —
и публикует **те же контракты, которые уже потребляет приложение водителя**.
Через неё проверяется сквозной поток «заявка → диспетчер → водитель» без доступа к рабочей конфигурации 1С.
При подключении реальной 1С слой эмуляции подменяется коннектором к её HTTP-сервисам; контракты и клиент не меняются.

ТЗ: `upload/ТЗ_Веб-платформа_Контур_1С.docx` (алгоритм, модель данных, контракты, критерии приёмки).

## Стек

- Next.js 16 (App Router, Route Handlers) + TypeScript
- Prisma ORM: **SQLite** в демо-режиме (по умолчанию), PostgreSQL через `DATABASE_URL`
- Tailwind CSS + shadcn/ui — рабочие места офиса
- Отдельный origin (в ТЗ — порт 3001, переменная `PORT`); CORS для источника приложения водителя (`DRIVER_APP_ORIGIN`, в демо `*`)

## Запуск

```bash
bun install
bun run db:push      # схема Prisma -> SQLite (db/custom.db)
bun run db:seed      # демо-сид: 15 ТС, 8 прицепов, 12 водителей, 6 заявок (1067 ASSIGNED, 1071/1074 DISPATCH, 3 DONE)
bun run dev          # http://localhost:3001/kontur (basePath; через роутер стенда — http://localhost:3000/kontur)
```

Сценарий приёмки: `python3 scripts/acceptance.py` (шаги 1, 3–9 раздела 10.1 ТЗ + контроль 409 и правил 5.3).

## Структура

```
prisma/schema.prisma            вся модель: справочники, документы, регистры, план обмена
prisma/seed.ts                  сид (обёртка над src/lib/seedAll.ts)
src/app/api/1c/orders/          HTTP-сервис «1С»: GET (список заявок) / POST (обратный канал)
src/app/api/driver/v1/sync/     шина: pull / push / marks
src/app/api/driver/v1/traffic/  снимок пробок по bbox (демо-генератор)
src/app/api/office/             API рабочих мест: requests, trips, catalog, chat, journal, demo, files, route (вставка маршрута)
src/lib/1c/                     доменные сервисы: нумератор, заявка, назначение (проведение), отмена, действия водителя, маршрут из Яндекс.Карт (разбор rtext)
src/lib/bus/                    appliers push-операций, SyncJournalWriter, снимки, traffic-генератор
src/components/workspace/       UI офиса: 8 экранов, поллинг 5 с
uploads/                        фото предрейсового осмотра (PHOTO_VIEW фиксируется в журнале)
```

## Демо-данные

Демо-водитель приложения: заголовок `X-Driver-Id: 06c075d1-3088-45f2-a7ae-090e8c355447` (Иванов С.П.).
На стенде заголовок необязателен — подставляется демо-водитель; также допускается id записи водителя.

## Контракты (curl-примеры)

### HTTP-сервис «1С»

```bash
# список заявок водителя (формат Order1C, поле-в-поле как в ТЗ 6.1)
curl -H 'X-Driver-Id: 06c075d1-3088-45f2-a7ae-090e8c355447' http://localhost:3000/api/1c/orders
# с фазы 1.1 в каждом orders[] есть routeLink и routeWaypoints — маршрут из Яндекс.Карт,
# который вставил диспетчер: routeWaypoints — [{lat,lng}], по ним приложение водителя
# строит рейс (геометрию дорог считает OSRM на стороне приложения)

# обратный канал: взять заявку / шаг фотофиксации / начать маршрут / завершить рейс
curl -X POST http://localhost:3000/api/1c/orders -H 'Content-Type: application/json' \
  -d '{"orderId": "ЗК-2026/1071", "action": "ACCEPT"}'
curl -X POST http://localhost:3000/api/1c/orders -H 'Content-Type: application/json' \
  -d '{"orderId": "ЗК-2026/1071", "action": "PRETRIP_STEP", "stepId": "veh_side"}'
# START_ROUTE до 6 шагов осмотра -> 409 {"ok":false,"error":"Предрейсовый осмотр не завершён..."}
curl -X POST http://localhost:3000/api/1c/orders -H 'Content-Type: application/json' \
  -d '{"orderId": "ЗК-2026/1071", "action": "START_ROUTE"}'
curl -X POST http://localhost:3000/api/1c/orders -H 'Content-Type: application/json' \
  -d '{"orderId": "ЗК-2026/1071", "action": "COMPLETE_TRIP"}'
```

### Протокол синхронизации (шина каркаса)

```bash
# дельта личного журнала (план обмена): entries(seq, entity, op, payload), cursor, hasMore
curl -H 'X-Driver-Id: 06c075d1-3088-45f2-a7ae-090e8c355447' \
  'http://localhost:3000/api/driver/v1/sync/pull?cursor=0&limit=500'

# push-операции: TRIP_EVENT_CREATE | MARK_PUBLISH | MARK_VOTE | CHAT_SEND | NOTE_READ
# статусы: APPLIED | DUPLICATE | REJECTED (финален, rejectReason показывается водителю)
curl -X POST http://localhost:3000/api/driver/v1/sync/push -H 'Content-Type: application/json' \
  -d '{"deviceId":"demo","operations":[{"opId":"<uuid>","type":"CHAT_SEND","payload":{"body":"Проверка связи"}}]}'

# активные пометки «водители для водителей» и снимок пробок по bbox
curl 'http://localhost:3000/api/driver/v1/sync/marks?minLat=44.5&minLon=37.5&maxLat=45.7&maxLon=39.8'
curl 'http://localhost:3000/api/driver/v1/traffic?minLat=44.5&minLon=37.5&maxLat=45.7&maxLon=39.8'
```

### API рабочих мест

```bash
# офисные API живут на платформе (:3001, basePath /kontur); через роутер стенда — http://localhost:3000/kontur/…
curl 'http://localhost:3001/kontur/api/office/requests?status=DISPATCH'   # список заявок
curl -X POST http://localhost:3001/kontur/api/office/requests -H 'Content-Type: application/json' \
  -d '{"contractorId":"<uuid>","cargo":"Сахар-песок в мешках","weightT":17,
       "fromLocationId":"<uuid>","toLocationId":"<uuid>",
       "loadingAt":"2026-11-13T08:00:00.000Z","unloadingWindow":"завтра 12:00–14:00",
       "docs":["ТТН","Качественное удостоверение"]}'
# назначение: проведение + рождение рейса одной транзакцией (ASSIGNED + Trip + 2 точки + SyncJournal + SystemNote)
curl -X POST http://localhost:3001/kontur/api/office/requests/<id>/assign -H 'Content-Type: application/json' \
  -d '{"vehicleId":"<uuid>","trailerId":null,"driverId":"<uuid>","actor":"Диспетчер Е. Крылова"}'
# нарушение правил 5.3 -> 400 {"ok":false,"errors":["..."]} и запись warning в журнал регистрации
# вставка маршрута из Яндекс.Карт: кнопка «Построить маршрут» открывает
# https://yandex.ru/maps/?rtext=<lat1>%2C<lon1>~<lat2>%2C<lon2>&rtt=auto, диспетчер правит маршрут
# в Яндекс.Картах, «Поделиться» → «Ссылка», вставляет и жмёт «Разобрать ссылку».
# Разбор: rtext=([^&\s]+) — мусор вокруг ссылки не мешает; um= (карта, не маршрут) → 400
# «Постройте маршрут и нажмите "Поделиться" → "Ссылка"»; кривая ссылка заявку не блокирует;
# приём и отказ пишутся в журнал регистрации (ROUTE_ATTACH / ROUTE_ATTACH_REJECTED)
curl -X POST http://localhost:3001/kontur/api/office/requests/<id>/route -H 'Content-Type: application/json' \
  -d '{"link":"https://yandex.ru/maps/?rtext=55.753930%2C37.620795~59.931123%2C30.360932&rtt=auto&z=7","actor":"Диспетчер Е. Крылова"}'
# -> {"ok":true,"number":"ЗК-2026/1071","points":2,"routeLink":"…","waypoints":[[55.75393,37.620795],[59.931123,30.360932]]}
curl -X POST http://localhost:3001/kontur/api/office/requests/<id>/cancel -H 'Content-Type: application/json' \
  -d '{"reason":"Ошибка в заявке"}'
curl http://localhost:3001/kontur/api/office/trips       # реестр рейсов: last_event, открытые интервалы, осмотр
curl http://localhost:3001/kontur/api/office/journal     # журнал регистрации (фильтры user/action/level)
curl http://localhost:3001/kontur/api/office/catalog/vehicles
curl -X POST http://localhost:3001/kontur/api/office/chat -H 'Content-Type: application/json' \
  -d '{"driverId":"<uuid>","body":"Сообщение водителю"}'   # уходит через SyncJournal
curl -X POST http://localhost:3001/kontur/api/office/demo -H 'Content-Type: application/json' \
  -d '{"action":"autoflow"}'   # random-request | autoflow | reset
```

## Маршрут через Яндекс.Карты (диспетчер)

В «Маршрутных листах» под сводкой заявки — панель маршрута. Сценарий: выбрать заявку →
«Построить маршрут» (Яндекс.Карты открываются с точками заявки; сохранённый маршрут — со всеми
своими точками, чтобы править дальше) → поправить маршрут и точки в Яндекс.Картах →
«Поделиться» → «Ссылка» → вставить в поле «Ссылка на маршрут (Яндекс.Карты)» → «Разобрать ссылку».
Точки сохраняются в заявку (`routeLink` + `routeWaypoints`), событие пишется в журнал регистрации
(`ROUTE_ATTACH` / `ROUTE_ATTACH_REJECTED`). После назначения водитель получает точки в
`/api/1c/orders`, и приложение строит по ним рейс через OSRM. Яндекс-API платформа не вызывает:
маршрут строится руками в Яндекс.Картах, платформа только разбирает ссылку.

## Подключение приложения водителя (10.2 ТЗ)

В приложении водителя собственный `/api/1c/orders` превращается в тонкий прокси — единственная правка:

```ts
// src/app/api/1c/orders/route.ts (приложение водителя)
const BASE = process.env.KONTUR_1C_URL ?? 'http://localhost:3001'

export async function GET(req: Request) {
  const r = await fetch(`${BASE}/api/1c/orders`, {
    headers: { 'X-Driver-Id': req.headers.get('x-driver-id') ?? '' },
    cache: 'no-store',
  })
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json' } })
}
// POST — аналогично, проксирует тело как есть.
```

Синхро-каналы переключаются на `BASE` тем же способом. Больше в клиенте ничего не меняется.

## Мост план обмена → драйверский сервер (телефон)

Записи `SyncJournal` для водителей с заполненным `appId` автоматически реплицируются
на драйверский сервер приложения (`:3002`) — телефон видит назначения, чат диспетчера
и события рейса своим `sync/pull`. Репликатор стартует лениво при первой записи
в журнал, опрашивает новые записи каждые 2 с; сбой доставки ничего не валит —
запись останется в журнале 1С и уйдёт следующим циклом (точные дубли отсеиваются).

```bash
# env (значения по умолчанию для стенда):
DRIVER_BRIDGE_URL=http://127.0.0.1:3002/api/driver/v1/ingest
DRIVER_BRIDGE_TOKEN=azmz-stand-bridge-2026
DRIVER_BRIDGE_DISABLED=1   # выключить мост
# на стороне драйверского сервера токен: DRIVER_INGEST_TOKEN (тот же по умолчанию)

# приём работает и напрямую:
curl -X POST http://localhost:3002/api/driver/v1/ingest \
  -H 'Content-Type: application/json' -H 'x-ingest-token: azmz-stand-bridge-2026' \
  -d '{"driverId":"06c075d1-3088-45f2-a7ae-090e8c355447","entries":[
       {"entity":"SYSTEM_NOTE","op":"UPSERT","payload":{"id":"<uuid>","driverId":"06c075d1-3088-45f2-a7ae-090e8c355447","kind":"ORDER_ASSIGNED","body":"...","createdAt":1731400000000}}]}'
```

## Переключение демо/контур

| Режим | DATABASE_URL | Примечание |
|---|---|---|
| Демо (по умолчанию) | `file:./db/custom.db?connection_limit=1` | SQLite, сид демо-данных |
| Контур стенда | `postgresql://user:pass@host:5432/kontur1c` | та же схема Prisma;写入-сервисы не меняются |

Маршруты считаются через 2ГИС Routing API (ключ `GIS2_API_KEY`, `transport: truck`, `traffic_mode: jam`);
при отсутствии ключа или недоступности — заглушка (прямая между пунктами, оценка времени по средней скорости).
Роутинг не блокирует транзакцию назначения.

## Что сознательно не сделано (первая очередь, по ТЗ)

Бухгалтерия, зарплата, ГСМ, ЭДО/ЭТрН, тахограф, TSP-оптимизация, полный путевой лист с одометром,
RBAC с паролями (роль выбирается на входе), SSE/WebSocket (поллинг 5 с), вынос фото в S3/MinIO.

## 152-ФЗ

Фото паспорта и ВУ — доступ только роли «диспетчер», retention 90 дней (демо-значение), просмотр каждого фото
фиксируется в журнале регистрации (`PHOTO_VIEW`), содержимое фото в журналы не пишется; пометки на карте анонимны.
