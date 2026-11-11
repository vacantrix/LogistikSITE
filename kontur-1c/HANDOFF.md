# HANDOFF: веб-платформа «Контур 1С»
Эмулятор учётного контура 1С для приложения водителя «АЗМЗ Логистика» (Next.js + TypeScript + Tailwind + shadcn/ui + Prisma, SQLite; песочница: порт 3000, целевой origin по ТЗ — 3001).
Выгрузка состояния на 2026-11-11 13:16:56 (UTC+3, Europe/Moscow). Все примеры запросов/ответов — реальные (curl-прогоны этой сессии). UUID-ы демо-данных — от последнего `bun run db:seed` и регенерируются при каждом сиде; постоянный ключ водителя — appId `d1111111-1111-4111-8111-111111111111`.

## ЧАСТЬ 1 — МАНИФЕСТ ПРОЕКТА

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

```
# .env.example
# «Контур 1С» — переменные окружения

# База данных: SQLite в демо-режиме; для контура стенда — PostgreSQL
DATABASE_URL=file:./db/custom.db?connection_limit=1
# DATABASE_URL=postgresql://user:password@localhost:5432/kontur1c

# Порт HTTP-сервиса платформы (в ТЗ отдельный origin — 3001; в песочнице стенд работает на 3000)
PORT=3001

# Ключ 2ГИС Routing API (transport: truck, traffic_mode: jam).
# Без ключа — заглушка: прямая между пунктами, время по средней скорости.
GIS2_API_KEY=

# Разрешённый источник приложения водителя для CORS на /api/1c/* и /api/driver/v1/*
# (в демо — *)
DRIVER_APP_ORIGIN=*
```

Фактический `.env` песочницы: `DATABASE_URL=file:/home/z/my-project/db/custom.db?connection_limit=1` (остальные значения как в .env.example; `GIS2_API_KEY` пуст — работает заглушка роутинга).

### Дерево файлов

- .env [SKIP]
- .env.example [EDIT]
- .gitignore [SKIP]
- Caddyfile [SKIP]
- README.md [NEW]
- bun.lock [SKIP]
- components.json [SKIP]
- dev.log [SKIP]
- eslint.config.mjs [SKIP]
- next-env.d.ts [SKIP]
- next.config.ts [EDIT]
- package.json [EDIT]
- postcss.config.mjs [SKIP]
- tailwind.config.ts [SKIP]
- tsconfig.json [SKIP]
- tsconfig.tsbuildinfo [SKIP]
- .zscripts/
  - build.sh [SKIP]
  - database-runtime-build.sh [SKIP]
  - dev-runtime.log [SKIP]
  - dev.log [SKIP]
  - dev.pid [SKIP]
  - dev.sh [SKIP]
  - mini-services-build.sh [SKIP]
  - mini-services-install.sh [SKIP]
  - mini-services-start.sh [SKIP]
  - python-runtime-build.sh [SKIP]
  - shot-home.png [SKIP]
  - start.sh [SKIP]
  - verify-02-dispatch.png [SKIP]
  - verify-03-trips.png [SKIP]
  - verify-05-candidates.png [SKIP]
  - verify-06-driver.png [SKIP]
  - verify-07-assigned.png [SKIP]
  - verify-08-chat.png [SKIP]
  - verify-09-chat-sent.png [SKIP]
  - verify-09b-chat.png [SKIP]
  - verify-10-demo.png [SKIP]
  - verify-11-orders.png [SKIP]
  - verify-12-admin.png [SKIP]
  - verify-13-admin2.png [SKIP]
  - verify-14-catalogs.png [SKIP]
  - verify-15-menu.png [SKIP]
  - verify-15b.png [SKIP]
  - verify-16-journal.png [SKIP]
  - verify-17-final.png [SKIP]
  - verify-18-role.png [SKIP]
- db/
  - custom.db [NEW]
- download/
  - README.md [SKIP]
- examples/
  - websocket/
    - frontend.tsx [SKIP]
    - server.ts [SKIP]
- mini-services/
  - .gitkeep [SKIP]
- prisma/
  - schema.prisma [NEW]
  - seed.ts [NEW]
- public/
  - logo.svg [SKIP]
  - robots.txt [SKIP]
- scripts/
  - acceptance.py [NEW]
  - build_handoff.py [SKIP]
  - dump_db.py [NEW]
  - handoff_curl.py [NEW]
  - handoff_curl2.py [NEW]
- src/
  - app/
    - globals.css [EDIT]
    - layout.tsx [EDIT]
    - page.tsx [NEW]
    - api/
      - route.ts [SKIP]
      - 1c/
        - orders/
          - route.ts [NEW]
      - driver/
        - v1/
          - sync/
            - marks/
              - route.ts [NEW]
            - pull/
              - route.ts [NEW]
            - push/
              - route.ts [NEW]
          - traffic/
            - route.ts [NEW]
      - office/
        - catalog/
          - [entity]/
            - route.ts [NEW]
            - [id]/
              - route.ts [NEW]
        - chat/
          - route.ts [NEW]
        - dashboard/
          - route.ts [NEW]
        - demo/
          - route.ts [NEW]
        - files/
          - [name]/
            - route.ts [NEW]
        - journal/
          - route.ts [NEW]
        - requests/
          - route.ts [NEW]
          - [id]/
            - assign/
              - route.ts [NEW]
            - cancel/
              - route.ts [NEW]
        - trips/
          - route.ts [NEW]
  - components/
    - 1c/
      - OneCShell.tsx [NEW]
      - kit.tsx [NEW]
    - ui/
      - accordion.tsx [SKIP]
      - alert-dialog.tsx [SKIP]
      - alert.tsx [SKIP]
      - aspect-ratio.tsx [SKIP]
      - avatar.tsx [SKIP]
      - badge.tsx [SKIP]
      - breadcrumb.tsx [SKIP]
      - button.tsx [SKIP]
      - calendar.tsx [SKIP]
      - card.tsx [SKIP]
      - carousel.tsx [SKIP]
      - chart.tsx [SKIP]
      - checkbox.tsx [SKIP]
      - collapsible.tsx [SKIP]
      - command.tsx [SKIP]
      - context-menu.tsx [SKIP]
      - dialog.tsx [SKIP]
      - drawer.tsx [SKIP]
      - dropdown-menu.tsx [SKIP]
      - form.tsx [SKIP]
      - hover-card.tsx [SKIP]
      - input-otp.tsx [SKIP]
      - input.tsx [SKIP]
      - label.tsx [SKIP]
      - menubar.tsx [SKIP]
      - navigation-menu.tsx [SKIP]
      - pagination.tsx [SKIP]
      - popover.tsx [SKIP]
      - progress.tsx [SKIP]
      - radio-group.tsx [SKIP]
      - resizable.tsx [SKIP]
      - scroll-area.tsx [SKIP]
      - select.tsx [SKIP]
      - separator.tsx [SKIP]
      - sheet.tsx [SKIP]
      - sidebar.tsx [SKIP]
      - skeleton.tsx [SKIP]
      - slider.tsx [SKIP]
      - sonner.tsx [SKIP]
      - switch.tsx [SKIP]
      - table.tsx [SKIP]
      - tabs.tsx [SKIP]
      - textarea.tsx [SKIP]
      - toast.tsx [SKIP]
      - toaster.tsx [SKIP]
      - toggle-group.tsx [SKIP]
      - toggle.tsx [SKIP]
      - tooltip.tsx [SKIP]
    - workspace/
      - CatalogsScreen.tsx [NEW]
      - ChatScreen.tsx [NEW]
      - DashboardScreen.tsx [NEW]
      - DemoScreen.tsx [NEW]
      - DispatchScreen.tsx [NEW]
      - JournalScreen.tsx [NEW]
      - RequestsScreen.tsx [NEW]
      - TripsScreen.tsx [NEW]
      - Workspace.tsx [NEW]
      - api.ts [NEW]
      - badges.tsx [NEW]
      - usePoll.ts [NEW]
  - hooks/
    - use-mobile.ts [SKIP]
    - use-toast.ts [SKIP]
  - lib/
    - cors.ts [NEW]
    - db.ts [NEW]
    - epoch.ts [NEW]
    - photos.ts [NEW]
    - seedAll.ts [NEW]
    - utils.ts [SKIP]
    - 1c/
      - assign.ts [NEW]
      - cancel.ts [NEW]
      - dblike.ts [NEW]
      - demos.ts [NEW]
      - driverActions.ts [NEW]
      - eligibility.ts [NEW]
      - journal.ts [NEW]
      - numbering.ts [NEW]
      - requests.ts [NEW]
      - route.ts [NEW]
      - statusCounts.ts [NEW]
      - statuses.ts [NEW]
      - tripEvents.ts [NEW]
    - bus/
      - appliers.ts [NEW]
      - snapshots.ts [NEW]
      - syncWriter.ts [NEW]
      - traffic.ts [NEW]
    - office/
      - serialize.ts [NEW]
- tests/
  - database-runtime-build.sh [SKIP]
  - python-runtime-build.sh [SKIP]
  - python-runtime-container.sh [SKIP]
- tool-results/
  - read_1794397402580_78d4effb72d3.txt [SKIP]
  - read_1794397405660_7c7de240ee48.txt [SKIP]
  - read_1794399432484_78d4effb72d3.txt [SKIP]
  - read_1794399467148_7c7de240ee48.txt [SKIP]
- upload/
  - pasted_image_1794397230647.png [SKIP]
  - pasted_image_1794397248505.png [SKIP]
  - ПРОМТ_Веб-платформа_Контур_1С.md [SKIP]
  - ТЗ_Веб-платформа_Контур_1С.docx [SKIP]
  - ТЗ_Веб-платформа_Контур_1С.pdf [SKIP]
- uploads/

- `node_modules/`, `.next/` — присутствуют, в пакет не включены
- `uploads/` — присутствует (фото предрейсовых осмотров; после сида пуста)
- `skills/`, `tool-results/`, `.zscripts/`, `tests/`, `examples/`, `mini-services/` — служебные папки песочницы (не платформа)
- `.zscripts/verify-*.png` — 18 скриншотов UI-прогонов предыдущей сессии (визуальная проверка экранов)

Пометки: `[NEW]` — написан сессиями платформы «Контур 1С»; `[EDIT]` — изменён относительно каркаса песочницы; `[SKIP]` — каркас песочницы / shadcn-ui / входные материалы, содержимое не менялось. Пометки относительно каркаса песочницы (git-история проекта нечувствительна к этому различию — первый коммит пуст).

## ЧАСТЬ 2 — ДАННЫЕ И ЯДРО

### prisma/schema.prisma — целиком

```prisma
# prisma/schema.prisma
// «Контур 1С» — эмулятор учётного контура 1С для приложения водителя «АЗМЗ Логистика»
// Схема повторяет механику 1С: справочники (НСИ), документы, регистры, журнал регистрации,
// план обмена (SyncJournal), идемпотентность push (SyncOperation).

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite" // демо; для стенда — postgresql в DATABASE_URL
  url      = env("DATABASE_URL")
}

// ─── Нумератор документов («1С»: префикс организации, периодичность, счётчик) ──

model NumberCounter {
  year  String @id // "2026"
  last  Int    @default(1000)
}

// ─── Справочники («1С»: НСИ) ───────────────────────────────────────────────

model Contractor {                           // Контрагенты
  id        String   @id @default(uuid())
  name      String
  inn       String?
  kind      String                            // customer | shipper | consignee
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  requests  TransportRequest[]
}

model Vehicle {                              // Транспортные средства
  id         String   @id @default(uuid())
  plate      String   @unique                // госномер
  model      String                            // «МАЗ 5440»
  kind       String                            // tractor | tipper | van
  bodyType   String                            // tarp | fridge | flatbed | tank
  capacityT  Float                             // грузоподъёмность, т
  volumeM3   Float?
  readiness  String   @default("ready")        // ready | maintenance | repair
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  requests   TransportRequest[]
}

model Trailer {                              // Прицепы
  id        String   @id @default(uuid())
  plate     String   @unique
  model     String
  type      String                            // tarp | fridge | flatbed
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  requests  TransportRequest[]
}

model Driver {                               // Водители (сотрудники)
  id        String   @id @default(uuid())
  fullName  String
  phone     String?
  licenseNo String?                           // номер ВУ
  isActive  Boolean  @default(true)
  appId     String?  @unique                  // значение заголовка X-Driver-Id
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  requests  TransportRequest[]
}

model Location {                             // Пункты погрузки/выгрузки
  id               String @id @default(uuid())
  name             String
  address          String
  lat              Float
  lon              Float
  geofenceRadiusM  Int    @default(300)
  outgoingRequests TransportRequest[] @relation("fromLoc")
  incomingRequests TransportRequest[] @relation("toLoc")
}

// ─── Документы ─────────────────────────────────────────────────────────────

model TransportRequest {                     // «Заказ на ТС»
  id              String    @id @default(uuid())
  number          String    @unique          // ЗК-2026/0001 (нумератор)
  externalId      String    @unique @default(uuid()) // GUID «объекта 1С»
  createdAt       DateTime  @default(now())
  status          String                     // NEW | DISPATCH | ASSIGNED | ACCEPTED | PRETRIP | IN_PROGRESS | DONE | CANCELLED
  contractorId    String
  cargo           String                     // наименование груза
  weightT         Float
  fromLocationId  String
  toLocationId    String
  loadingAt       DateTime                   // плановая погрузка
  unloadingWindow String                     // «сегодня 14:00–16:00»
  docs            String                     // JSON-массив строк (для фотофиксации)
  vehicleId       String?
  trailerId       String?
  driverId        String?
  assignedBy      String?                    // «Диспетчер Е. Крылова»
  assignedAt      DateTime?
  closeReason     String?                    // причина закрытия/отмены
  tripId          String?   @unique
  contractor      Contractor @relation(fields: [contractorId], references: [id])
  fromLocation    Location   @relation("fromLoc", fields: [fromLocationId], references: [id])
  toLocation      Location   @relation("toLoc", fields: [toLocationId], references: [id])
  vehicle         Vehicle?   @relation(fields: [vehicleId], references: [id])
  trailer         Trailer?   @relation(fields: [trailerId], references: [id])
  driver          Driver?    @relation(fields: [driverId], references: [id])
  trip            Trip?      @relation(fields: [tripId], references: [id])
  statusHistory   StatusHistory[]
  preTripInspection PreTripInspection?

  @@index([status])
}

model Trip {                                 // Рейс — поля 1:1 с каркасом
  id              String    @id @default(uuid())
  tripCode        String    @unique          // = number заявки
  status          String                     // assigned | in_progress | completed | cancelled
  driverId        String?
  vehicleId       String?
  plannedStartAt  DateTime?
  plannedFinishAt DateTime?
  routeGeoJson    String?                    // GeoJSON LineString
  routeStepsJson  String?                    // манёвры
  routeDistanceM  Int?
  routeDurationS  Int?
  routeMinLat     Float?
  routeMinLon     Float?
  routeMaxLat     Float?
  routeMaxLon     Float?
  lastEventType   String?                    // автостатус из событий
  lastEventAt     DateTime?
  updatedAt       DateTime  @updatedAt
  points          TripPoint[]
  events          TripEvent[]
  request         TransportRequest?
}

model TripPoint {
  id                 String   @id @default(uuid())
  tripId             String
  seqNo              Int
  kind               String   // loading | unloading | waypoint
  name               String?
  address            String?
  lat                Float
  lon                Float
  geofenceRadiusM    Int      @default(300)
  plannedArrivalAt   DateTime?
  plannedDepartureAt DateTime?
  trip               Trip     @relation(fields: [tripId], references: [id])

  @@index([tripId])
}

model Waybill {                              // Путевой лист — 2-я очередь (каркас)
  id        String   @id @default(uuid())
  number    String   @unique
  tripId    String   @unique
  createdAt DateTime @default(now())
}

model PreTripInspection {                    // Предрейсовый осмотр (фотофиксация)
  id         String   @id @default(uuid())
  requestId  String   @unique
  driverId   String
  vehicleId  String?
  createdAt  DateTime @default(now())
  steps      PreTripStep[]
  request    TransportRequest @relation(fields: [requestId], references: [id])
}

model PreTripStep {
  id           String   @id @default(uuid())
  inspectionId String
  stepId       String   // veh_side | veh_front | veh_rear | order_docs | lic | passport
  photoUrl     String?  // если photoDataUrl был передан
  at           DateTime @default(now())
  inspection   PreTripInspection @relation(fields: [inspectionId], references: [id])

  @@unique([inspectionId, stepId])
}

// ─── Регистры ──────────────────────────────────────────────────────────────

model StatusHistory {                        // «Регистр сведений: статусы»
  id          Int      @id @default(autoincrement())
  requestId   String
  fromStatus  String?
  toStatus    String
  actor       String   // «Логист», «Диспетчер Е. Крылова», «driver:<uuid>»
  comment     String?
  at          DateTime @default(now())
  request     TransportRequest @relation(fields: [requestId], references: [id])

  @@index([requestId])
}

model RegistrationLog {                      // «Журнал регистрации» 1С
  id        Int      @id @default(autoincrement())
  user      String
  action    String   // REQUEST_CREATE | ASSIGN | CANCEL | DRIVER_ACTION | PHOTO_VIEW | …
  entity    String
  entityId  String?
  level     String   @default("info") // info | warning | error
  at        DateTime @default(now())
}

// ─── Каркас приложения водителя (1:1 с миграциями V2–V7 каркаса) ───────────

model TripEvent {
  id                 String    @id @default(uuid())
  tripId             String
  tripPointId        String?
  driverId           String
  vehicleId          String
  deviceId           String?
  type               String    // DEPARTURE | ARRIVAL_LOADING | LOADING_DONE | REST_START | REST_END | ARRIVAL_UNLOADING | UNLOADING_DONE | TRIP_DONE
  occurredAt         DateTime
  source             String    // GEOFENCE | MANUAL | MANUAL_BACKDATED
  lat                Float?
  lon                Float?
  note               String?
  intervalClosedAt   DateTime?
  intervalClosedBy   String?
  intervalAutoClosed Boolean?
  correctionOf       String?
  editedAt           DateTime?
  createdAt          DateTime  @default(now())
  trip               Trip      @relation(fields: [tripId], references: [id])

  @@index([tripId])
}

model RoadMark {
  id              String   @id @default(uuid())
  category        String   // POTHOLE | ROADWORKS | POLICE | ACCIDENT | CLOSED
  polylineGeoJson String
  comment         String?
  ttlHours        Int      // 6 | 12 | 720
  confirmCount    Int      @default(0)
  outdatedCount   Int      @default(0)
  createdAt       DateTime @default(now())
  expiresAt       DateTime
  minLat          Float
  minLon          Float
  maxLat          Float
  maxLon          Float

  @@index([expiresAt])
}

model MarkVote {
  id            Int      @id @default(autoincrement())
  markId        String
  voterDriverId String
  vote          Int      // 1 | -1
  createdAt     DateTime @default(now())

  @@unique([markId, voterDriverId])
}

model MarkPublicationLog {
  id          Int      @id @default(autoincrement())
  driverId    String
  publishedAt DateTime @default(now())

  @@index([driverId, publishedAt])
}

model ChatMessage {
  id        String   @id @default(uuid())
  driverId  String
  tripId    String?
  sender    String   // DRIVER | DISPATCHER
  body      String
  createdAt DateTime @default(now())

  @@index([driverId])
}

model SystemNote {
  id        String    @id @default(uuid())
  driverId  String
  kind      String    // ORDER_ASSIGNED | ORDER_CANCELLED | …
  body      String
  ref       String?   // JSON (id заявки/рейса)
  createdAt DateTime  @default(now())
  readAt    DateTime?

  @@index([driverId])
}

model SyncJournal {                          // «План обмена»: личный журнал водителя
  seq       Int      @id @default(autoincrement())
  driverId  String
  entity    String   // TRIP | TRIP_POINT | TRIP_EVENT | CHAT_MESSAGE | SYSTEM_NOTE
  op        String   // UPSERT | DELETE
  payload   String   // JSON-снимок строки, camelCase, epoch millis
  createdAt DateTime @default(now())

  @@index([driverId, seq])
}

model SyncOperation {                        // Идемпотентность push
  opId         String    @id
  driverId     String
  type         String    // TRIP_EVENT_CREATE | MARK_PUBLISH | MARK_VOTE | CHAT_SEND | NOTE_READ
  payload      String
  state        String    @default("PENDING") // APPLIED | DUPLICATE | REJECTED
  rejectReason String?
  attempts     Int       @default(0)
  createdAt    DateTime  @default(now())
  syncedAt     DateTime?
}

model TrafficSegment {                       // Канал 3: демо-генератор пробок
  id        String   @id
  title     String
  geometry  String   // GeoJSON LineString
  level     Int      // 1..10
  speedKmh  Int
  onRoute   Boolean  @default(false)
  updatedAt DateTime @updatedAt
}
```

### Сид и фактические демо-данные

Скрипт сида: `prisma/seed.ts` (обёртка) → общий модуль `src/lib/seedAll.ts` (используется и кнопкой «Сброс и пересев» демо-панели). Запуск: `bun run db:seed`.

### Демо-данные после сида (фактическое содержимое db/custom.db)

**Нумератор:** год 2026, last=1074 → следующая заявка получит **ЗК-2026/1075**.

**SyncJournal (план обмена):** 6 записей, seq 337–342 (TRIP×1, TRIP_POINT×2, SYSTEM_NOTE×1 — демо-водитель; CHAT_MESSAGE×2).

**Водители (12) — id записи и appId (заголовок X-Driver-Id):**

| ФИО | id записи (регенерируется сидом) | appId = X-Driver-Id |
|---|---|---|
| Иванов Сергей Петрович | `e46388b4-805b-4036-a2a3-00eb139065a0` | d1111111-1111-4111-8111-111111111111 |
| Петров Андрей Николаевич | `bc5cd0b3-980d-497d-baa1-867632580644` | — |
| Сидоров Алексей Викторович | `4c3a95db-0c94-4488-bb2f-1c7def2d55e0` | — |
| Кузнецов Дмитрий Олегович | `94ef6f98-d7e0-49b1-88b7-4144e9ce4165` | — |
| Смирнов Игорь Валерьевич | `9417a6a2-dced-4730-9c17-00b4f7c7169a` | — |
| Волков Максим Сергеевич | `8adcec82-741e-485d-a34e-5b2195ae891c` | — |
| Морозов Павел Андреевич | `3bced53e-cf1a-4286-a2d0-ba93f6cc0d5f` | — |
| Егоров Станислав Львович | `8f4ca7df-1e75-4e9b-bf2b-ae6b39674ba4` | — |
| Захаров Виктор Иванович | `8eabd451-d47e-4c7c-bbac-329f4e53fd4a` | — |
| Орлов Геннадий Павлович | `d4ac90e3-eb5e-4910-9dfb-2ae17fb3efd3` | — |
| Богданов Роман Юрьевич | `1e9e798e-af63-464a-a3ce-c26f5ce18015` | — |
| Фёдоров Артём Владимирович | `2f4f64b4-13ab-46b9-b7f1-5f7ab8900008` | — |

**ТС (15):**

| Госномер | Модель | Тип | Кузов | Грузоподъёмность | Готовность |
|---|---|---|---|---|---|
| А 123 БС 23 | МАЗ 5440 | тягач | штора | 20.0 т | готов |
| К 456 МН 23 | КАМАЗ 5490 | тягач | штора | 19.0 т | готов |
| В 789 СА 23 | МАЗ 6312 | самосвал | борт | 21.0 т | готов |
| О 345 РТ 23 | Volvo FH 460 | тягач | штора | 21.0 т | готов |
| Е 901 ХК 23 | Scania R450 | тягач | штора | 20.5 т | обслуживание |
| М 234 УК 23 | МАЗ 4371 | фургон | штора | 10.0 т | готов |
| Т 567 ОР 23 | КАМАЗ 6520 | самосвал | борт | 20.0 т | ремонт |
| Н 678 ВЕ 23 | ГАЗ Валдай | фургон | штора | 4.0 т | готов |
| С 890 НМ 23 | MAN TGX | тягач | реф | 19.0 т | готов |
| Р 012 АС 23 | КАМАЗ 54115 | тягач | штора | 18.0 т | готов |
| У 123 КЛ 23 | Volvo FM 13 | тягач | реф | 20.0 т | готов |
| К 234 МН 23 | Scania P410 | тягач | борт | 19.5 т | готов |
| А 567 БВ 23 | МАЗ 5440 Е5 | тягач | штора | 20.0 т | готов |
| Х 890 ЕК 23 | КАМАЗ 65117 | фургон | штора | 15.0 т | обслуживание |
| В 345 ТА 23 | ГАЗель NEXT | фургон | штора | 1.5 т | готов |

**Прицепы (8):** АВ 456 23 (НЕФАЗ 93341, штора); МЕ 789 23 (Schmitz SCS 24, штора); РУ 012 23 (Schmitz SKO 24 (реф), реф); СН 345 23 (Коггел СК-3 (реф), реф); ВК 678 23 (НЕФАЗ 8560 (борт), борт); АХ 901 23 (ТСМ 9384 (штора), штора); ЕТ 234 23 (Krone Profi Liner, штора); УМ 567 23 (НЕФАЗ 93342 (борт), борт).

**Контрагенты (4):** ООО «Новороссийский терминал» (ИНН 2315066431, customer); ООО «Кубань Агро» (ИНН 2366001023, customer); ООО «Донсталь» (ИНН 6163120045, customer); АО «Абинский электрометаллургический завод» (ИНН 2301003210, shipper).

**Пункты (5):** Абинск, пл. АЗМЗ (44.868, 38.158); Краснодар, РЦ «Прогресс» (45.035, 38.975); Новороссийск, причал 27 (44.685, 37.775); Ростов-на-Дону, склад №4 (47.235, 39.701); Тимашевск, элеватор (45.617, 38.936).

**Заявки (6):**

| Номер | Статус | Груз | Вес | ТС | Водитель |
|---|---|---|---|---|---|
| ЗК-2026/1074 | DISPATCH | Металлопрокат листовой, 2 шт. | 20.2 т | — | — |
| ЗК-2026/1071 | DISPATCH | Сахар-песок в мешках, 40 паллет | 17.0 т | — | — |
| ЗК-2026/1067 | ASSIGNED | Металлоконструкции (фермы), штучные | 18.5 т | А 123 БС 23 | Иванов Сергей Петрович |
| ЗК-2026/1063 | DONE | Трубы стальные, 12 м | 15.0 т | О 345 РТ 23 | Кузнецов Дмитрий Олегович |
| ЗК-2026/1059 | DONE | Мука пшеничная в мешках | 16.0 т | Р 012 АС 23 | Смирнов Игорь Валерьевич |
| ЗК-2026/1052 | DONE | Пиломатериалы обрезные | 12.0 т | К 234 МН 23 | Волков Максим Сергеевич |

**Рейсы (4):** ЗК-2026/1067 (assigned); ЗК-2026/1063 (completed, last=TRIP_DONE); ЗК-2026/1059 (completed, last=TRIP_DONE); ЗК-2026/1052 (completed, last=TRIP_DONE).

> UUID-ы записей регенерируются при каждом `bun run db:seed`; постоянный ключ водителя — `appId`. Номера заявок, справочники и статусы после сида всегда одинаковы.


### Хелперы ядра — файлы целиком

Порядок: сид → нумератор → журнал регистрации → статусная модель → документ заявки → правила назначения → рождение рейса (проведение) → отмена → роутинг → события рейса → обратный канал водителя → счётчики → план обмена (писатель, снимки, appliers, пробки) → инфраструктура (БД/время/CORS/фото/сериализация) → демо-сервисы.

```ts
// prisma/seed.ts
/**
 * Сид демо-данных «Контур 1С» (раздел 8 ТЗ).
 * Запуск: bun prisma/seed.ts  (или bun run db:seed)
 */
import { PrismaClient } from '@prisma/client'
import { seedAll } from '../src/lib/seedAll'

const db = new PrismaClient()

seedAll(db)
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
```
```ts
// src/lib/seedAll.ts
/**
 * Сид демо-данных «Контур 1С» (раздел 8 ТЗ). Общий модуль:
 * используется и при запуске prisma/seed.ts, и демо-панелью («Сброс и пересев»).
 */
import type { PrismaClient } from '@prisma/client'

const toMillis = (d: Date | null | undefined): number | null => (d ? d.getTime() : null)

function tripSnapshot(t: {
  id: string; tripCode: string; status: string; driverId: string | null; vehicleId: string | null
  plannedStartAt: Date | null; plannedFinishAt: Date | null
  routeGeoJson: string | null; routeStepsJson: string | null
  routeDistanceM: number | null; routeDurationS: number | null
  routeMinLat: number | null; routeMinLon: number | null
  routeMaxLat: number | null; routeMaxLon: number | null
  lastEventType: string | null; lastEventAt: Date | null
}) {
  return {
    id: t.id, tripCode: t.tripCode, status: t.status,
    driverId: t.driverId, vehicleId: t.vehicleId,
    plannedStartAt: toMillis(t.plannedStartAt), plannedFinishAt: toMillis(t.plannedFinishAt),
    routeGeoJson: t.routeGeoJson, routeStepsJson: t.routeStepsJson,
    routeDistanceM: t.routeDistanceM, routeDurationS: t.routeDurationS,
    routeMinLat: t.routeMinLat, routeMinLon: t.routeMinLon,
    routeMaxLat: t.routeMaxLat, routeMaxLon: t.routeMaxLon,
    lastEventType: t.lastEventType, lastEventAt: toMillis(t.lastEventAt),
  }
}

function tripPointSnapshot(p: {
  id: string; tripId: string; seqNo: number; kind: string; name: string | null; address: string | null
  lat: number; lon: number; geofenceRadiusM: number
  plannedArrivalAt: Date | null; plannedDepartureAt: Date | null
}) {
  return {
    id: p.id, tripId: p.tripId, seqNo: p.seqNo, kind: p.kind, name: p.name, address: p.address,
    lat: p.lat, lon: p.lon, geofenceRadiusM: p.geofenceRadiusM,
    plannedArrivalAt: toMillis(p.plannedArrivalAt), plannedDepartureAt: toMillis(p.plannedDepartureAt),
  }
}

function systemNoteSnapshot(n: {
  id: string; driverId: string; kind: string; body: string; ref: string | null
  createdAt: Date; readAt: Date | null
}) {
  return { id: n.id, driverId: n.driverId, kind: n.kind, body: n.body, ref: n.ref, createdAt: n.createdAt.getTime(), readAt: toMillis(n.readAt) }
}

function chatMessageSnapshot(m: { id: string; driverId: string; tripId: string | null; sender: string; body: string; createdAt: Date }) {
  return { id: m.id, driverId: m.driverId, tripId: m.tripId, sender: m.sender, body: m.body, createdAt: m.createdAt.getTime() }
}

function stubRoute(a: { lat: number; lon: number }, b: { lat: number; lon: number }, distanceM: number, durationMin: number) {
  const line = {
    type: 'LineString',
    coordinates: [0, 1, 2, 3, 4, 5].map((i) => {
      const k = i / 5
      return [+(a.lon + (b.lon - a.lon) * k).toFixed(6), +(a.lat + (b.lat - a.lat) * k).toFixed(6)]
    }),
  }
  return {
    routeGeoJson: JSON.stringify(line),
    routeDistanceM: distanceM,
    routeDurationS: durationMin * 60,
    routeMinLat: Math.min(a.lat, b.lat), routeMinLon: Math.min(a.lon, b.lon),
    routeMaxLat: Math.max(a.lat, b.lat), routeMaxLon: Math.max(a.lon, b.lon),
  }
}

export async function seedAll(db: PrismaClient) {
  console.log('Сид «Контур 1С»: очистка…')
  await db.$transaction([
    db.syncJournal.deleteMany(), db.syncOperation.deleteMany(), db.registrationLog.deleteMany(),
    db.statusHistory.deleteMany(), db.preTripStep.deleteMany(), db.preTripInspection.deleteMany(),
    db.tripEvent.deleteMany(), db.tripPoint.deleteMany(), db.waybill.deleteMany(), db.trip.deleteMany(),
    db.chatMessage.deleteMany(), db.systemNote.deleteMany(),
    db.roadMark.deleteMany(), db.markVote.deleteMany(), db.markPublicationLog.deleteMany(),
    db.trafficSegment.deleteMany(), db.transportRequest.deleteMany(),
    db.vehicle.deleteMany(), db.trailer.deleteMany(), db.driver.deleteMany(),
    db.contractor.deleteMany(), db.location.deleteMany(), db.numberCounter.deleteMany(),
  ])

  // ─── Нумератор: год закрыт на 1074, следующая — ЗК-2026/1075 ───
  await db.numberCounter.create({ data: { year: '2026', last: 1074 } })

  // ─── Контрагенты ───
  const contractorRows = [
    { name: 'ООО «Новороссийский терминал»', inn: '2315066431', kind: 'customer' },
    { name: 'ООО «Кубань Агро»', inn: '2366001023', kind: 'customer' },
    { name: 'ООО «Донсталь»', inn: '6163120045', kind: 'customer' },
    { name: 'АО «Абинский электрометаллургический завод»', inn: '2301003210', kind: 'shipper' },
  ]
  const contractors: Record<string, { id: string }> = {}
  for (const c of contractorRows) contractors[c.name] = await db.contractor.create({ data: c })

  // ─── Пункты погрузки и выгрузки ───
  const locRows = [
    { key: 'abinsk', name: 'Абинск, пл. АЗМЗ', address: 'г. Абинск, промплощадка АЭМЗ', lat: 44.868, lon: 38.158 },
    { key: 'timashevsk', name: 'Тимашевск, элеватор', address: 'г. Тимашевск, ул. Гибридная, 2', lat: 45.617, lon: 38.936 },
    { key: 'krasnodar', name: 'Краснодар, РЦ «Прогресс»', address: 'г. Краснодар, ул. Тополиная, 12', lat: 45.035, lon: 38.975 },
    { key: 'novoross', name: 'Новороссийск, причал 27', address: 'г. Новороссийск, грузовой терминал, причал 27', lat: 44.685, lon: 37.775 },
    { key: 'rostov', name: 'Ростов-на-Дону, склад №4', address: 'г. Ростов-на-Дону, ул. Доватора, 150', lat: 47.235, lon: 39.701 },
  ]
  const loc: Record<string, { id: string; lat: number; lon: number; name: string; address: string }> = {}
  for (const l of locRows) loc[l.key] = await db.location.create({ data: { name: l.name, address: l.address, lat: l.lat, lon: l.lon } })

  // ─── ТС (15, часть в maintenance/repair — для проверки правил назначения) ───
  const vehRows = [
    { plate: 'А 123 БС 23', model: 'МАЗ 5440', kind: 'tractor', bodyType: 'tarp', capacityT: 20, volumeM3: 90, readiness: 'ready' },
    { plate: 'К 456 МН 23', model: 'КАМАЗ 5490', kind: 'tractor', bodyType: 'tarp', capacityT: 19, volumeM3: 88, readiness: 'ready' },
    { plate: 'В 789 СА 23', model: 'МАЗ 6312', kind: 'tipper', bodyType: 'flatbed', capacityT: 21, volumeM3: 60, readiness: 'ready' },
    { plate: 'О 345 РТ 23', model: 'Volvo FH 460', kind: 'tractor', bodyType: 'tarp', capacityT: 21, volumeM3: 92, readiness: 'ready' },
    { plate: 'Е 901 ХК 23', model: 'Scania R450', kind: 'tractor', bodyType: 'tarp', capacityT: 20.5, volumeM3: 90, readiness: 'maintenance' },
    { plate: 'М 234 УК 23', model: 'МАЗ 4371', kind: 'van', bodyType: 'tarp', capacityT: 10, volumeM3: 45, readiness: 'ready' },
    { plate: 'Т 567 ОР 23', model: 'КАМАЗ 6520', kind: 'tipper', bodyType: 'flatbed', capacityT: 20, volumeM3: 40, readiness: 'repair' },
    { plate: 'Н 678 ВЕ 23', model: 'ГАЗ Валдай', kind: 'van', bodyType: 'tarp', capacityT: 4, volumeM3: 20, readiness: 'ready' },
    { plate: 'С 890 НМ 23', model: 'MAN TGX', kind: 'tractor', bodyType: 'fridge', capacityT: 19, volumeM3: 85, readiness: 'ready' },
    { plate: 'Р 012 АС 23', model: 'КАМАЗ 54115', kind: 'tractor', bodyType: 'tarp', capacityT: 18, volumeM3: 82, readiness: 'ready' },
    { plate: 'У 123 КЛ 23', model: 'Volvo FM 13', kind: 'tractor', bodyType: 'fridge', capacityT: 20, volumeM3: 86, readiness: 'ready' },
    { plate: 'К 234 МН 23', model: 'Scania P410', kind: 'tractor', bodyType: 'flatbed', capacityT: 19.5, volumeM3: 70, readiness: 'ready' },
    { plate: 'А 567 БВ 23', model: 'МАЗ 5440 Е5', kind: 'tractor', bodyType: 'tarp', capacityT: 20, volumeM3: 90, readiness: 'ready' },
    { plate: 'Х 890 ЕК 23', model: 'КАМАЗ 65117', kind: 'van', bodyType: 'tarp', capacityT: 15, volumeM3: 70, readiness: 'maintenance' },
    { plate: 'В 345 ТА 23', model: 'ГАЗель NEXT', kind: 'van', bodyType: 'tarp', capacityT: 1.5, volumeM3: 9, readiness: 'ready' },
  ]
  const veh: Record<string, { id: string }> = {}
  for (const v of vehRows) veh[v.plate] = await db.vehicle.create({ data: v })

  // ─── Прицепы (8) ───
  const trailerRows = [
    { plate: 'АВ 456 23', model: 'НЕФАЗ 93341', type: 'tarp' },
    { plate: 'МЕ 789 23', model: 'Schmitz SCS 24', type: 'tarp' },
    { plate: 'РУ 012 23', model: 'Schmitz SKO 24 (реф)', type: 'fridge' },
    { plate: 'СН 345 23', model: 'Коггел СК-3 (реф)', type: 'fridge' },
    { plate: 'ВК 678 23', model: 'НЕФАЗ 8560 (борт)', type: 'flatbed' },
    { plate: 'АХ 901 23', model: 'ТСМ 9384 (штора)', type: 'tarp' },
    { plate: 'ЕТ 234 23', model: 'Krone Profi Liner', type: 'tarp' },
    { plate: 'УМ 567 23', model: 'НЕФАЗ 93342 (борт)', type: 'flatbed' },
  ]
  const tr: Record<string, { id: string }> = {}
  for (const t of trailerRows) tr[t.plate] = await db.trailer.create({ data: t })

  // ─── Водители (12, у первого — appId демо-водителя приложения) ───
  const driverRows = [
    { fullName: 'Иванов Сергей Петрович', phone: '+7 (918) 201-15-32', licenseNo: '5412 889012', appId: 'd1111111-1111-4111-8111-111111111111' },
    { fullName: 'Петров Андрей Николаевич', phone: '+7 (918) 345-67-89', licenseNo: '5413 124578' },
    { fullName: 'Сидоров Алексей Викторович', phone: '+7 (903) 442-11-08', licenseNo: '5414 552310' },
    { fullName: 'Кузнецов Дмитрий Олегович', phone: '+7 (918) 677-23-41', licenseNo: '5415 781204' },
    { fullName: 'Смирнов Игорь Валерьевич', phone: '+7 (961) 118-90-76', licenseNo: '5416 330459' },
    { fullName: 'Волков Максим Сергеевич', phone: '+7 (918) 552-88-10', licenseNo: '5417 905613' },
    { fullName: 'Морозов Павел Андреевич', phone: '+7 (909) 701-45-23', licenseNo: '5418 217860' },
    { fullName: 'Егоров Станислав Львович', phone: '+7 (918) 099-31-64', licenseNo: '5419 664108' },
    { fullName: 'Захаров Виктор Иванович', phone: '+7 (961) 234-77-05', licenseNo: '5420 110925' },
    { fullName: 'Орлов Геннадий Павлович', phone: '+7 (918) 466-52-90', licenseNo: '5421 883741' },
    { fullName: 'Богданов Роман Юрьевич', phone: '+7 (903) 590-18-47', licenseNo: '5422 557602' },
    { fullName: 'Фёдоров Артём Владимирович', phone: '+7 (961) 808-26-39', licenseNo: '5423 309184' },
  ]
  const drv: { id: string; fullName: string }[] = []
  for (const d of driverRows) drv.push(await db.driver.create({ data: d }))

  console.log('Сид: справочники созданы (15 ТС, 8 прицепов, 12 водителей, 4 контрагента, 5 пунктов)')

  const now = new Date()
  const dayMs = 24 * 3600 * 1000
  const journal: { driverId: string; entity: string; op: string; payload: string }[] = []
  const regLog: { user: string; action: string; entity: string; entityId: string | null; level?: string }[] = []

  // ─── Выполненные заявки (история): ЗК-2026/1063, /1059, /1052 ───
  const doneDefs = [
    { number: 'ЗК-2026/1063', cargo: 'Трубы стальные, 12 м', weightT: 15, contractor: 'ООО «Донсталь»', from: 'abinsk', to: 'krasnodar', vehicle: 'О 345 РТ 23', trailer: 'АВ 456 23', driverIdx: 3, km: 210, min: 240, daysAgo: 3, docs: ['ТТН (2 экз.)', 'Паспорт груза'] },
    { number: 'ЗК-2026/1059', cargo: 'Мука пшеничная в мешках', weightT: 16, contractor: 'ООО «Кубань Агро»', from: 'timashevsk', to: 'rostov', vehicle: 'Р 012 АС 23', trailer: 'МЕ 789 23', driverIdx: 4, km: 380, min: 420, daysAgo: 5, docs: ['ТТН', 'Качественное удостоверение'] },
    { number: 'ЗК-2026/1052', cargo: 'Пиломатериалы обрезные', weightT: 12, contractor: 'ООО «Новороссийский терминал»', from: 'abinsk', to: 'novoross', vehicle: 'К 234 МН 23', trailer: 'ВК 678 23', driverIdx: 5, km: 118, min: 155, daysAgo: 7, docs: ['ТТН (2 экз.)'] },
  ]
  for (const d of doneDefs) {
    const daysAgo = (n: number) => new Date(now.getTime() - n * dayMs)
    const req = await db.transportRequest.create({
      data: {
        number: d.number, status: 'DONE', contractorId: contractors[d.contractor].id,
        cargo: d.cargo, weightT: d.weightT, fromLocationId: loc[d.from].id, toLocationId: loc[d.to].id,
        loadingAt: daysAgo(d.daysAgo), unloadingWindow: '—', docs: JSON.stringify(d.docs),
        vehicleId: veh[d.vehicle].id, trailerId: tr[d.trailer].id, driverId: drv[d.driverIdx].id,
        assignedBy: 'Диспетчер Е. Крылова', assignedAt: daysAgo(d.daysAgo),
        createdAt: daysAgo(d.daysAgo + 1),
      },
    })
    const route = stubRoute(loc[d.from], loc[d.to], d.km * 1000, d.min)
    const trip = await db.trip.create({
      data: {
        tripCode: d.number, status: 'completed', driverId: drv[d.driverIdx].id, vehicleId: veh[d.vehicle].id,
        plannedStartAt: daysAgo(d.daysAgo), plannedFinishAt: new Date(daysAgo(d.daysAgo).getTime() + d.min * 60000),
        ...route, lastEventType: 'TRIP_DONE', lastEventAt: new Date(daysAgo(d.daysAgo).getTime() + d.min * 60000),
      },
    })
    await db.tripPoint.createMany({
      data: [
        { tripId: trip.id, seqNo: 1, kind: 'loading', name: loc[d.from].name, address: loc[d.from].address, lat: loc[d.from].lat, lon: loc[d.from].lon, plannedArrivalAt: daysAgo(d.daysAgo), plannedDepartureAt: new Date(daysAgo(d.daysAgo).getTime() + 40 * 60000) },
        { tripId: trip.id, seqNo: 2, kind: 'unloading', name: loc[d.to].name, address: loc[d.to].address, lat: loc[d.to].lat, lon: loc[d.to].lon, plannedArrivalAt: new Date(daysAgo(d.daysAgo).getTime() + d.min * 60000) },
      ],
    })
    await db.tripEvent.createMany({
      data: [
        { tripId: trip.id, driverId: drv[d.driverIdx].id, vehicleId: veh[d.vehicle].id, type: 'DEPARTURE', occurredAt: daysAgo(d.daysAgo), source: 'MANUAL' },
        { tripId: trip.id, driverId: drv[d.driverIdx].id, vehicleId: veh[d.vehicle].id, type: 'TRIP_DONE', occurredAt: new Date(daysAgo(d.daysAgo).getTime() + d.min * 60000), source: 'MANUAL' },
      ],
    })
    await db.transportRequest.update({ where: { id: req.id }, data: { tripId: trip.id } })
    const chain = [
      ['NEW', 'DISPATCH'], ['DISPATCH', 'ASSIGNED'], ['ASSIGNED', 'ACCEPTED'],
      ['ACCEPTED', 'PRETRIP'], ['PRETRIP', 'IN_PROGRESS'], ['IN_PROGRESS', 'DONE'],
    ]
    await db.statusHistory.createMany({
      data: chain.map(([from, to], i) => ({
        requestId: req.id, fromStatus: from, toStatus: to,
        actor: to === 'ASSIGNED' ? 'Диспетчер Е. Крылова' : to === 'NEW' || to === 'DISPATCH' ? 'Авто' : `driver:${drv[d.driverIdx].id}`,
        at: new Date(daysAgo(d.daysAgo + 1).getTime() + i * 3600 * 1000),
      })),
    })
    regLog.push({ user: 'Логист', action: 'REQUEST_CREATE', entity: 'TransportRequest', entityId: d.number })
    regLog.push({ user: 'Диспетчер Е. Крылова', action: 'ASSIGN', entity: 'TransportRequest', entityId: d.number })
    regLog.push({ user: `driver:${drv[d.driverIdx].id}`, action: 'DRIVER_ACTION', entity: 'TransportRequest', entityId: d.number })
  }

  // ─── ЗК-2026/1071 — Сахар-песок (DISPATCH) ───
  const r1071 = await db.transportRequest.create({
    data: {
      number: 'ЗК-2026/1071', status: 'DISPATCH',
      contractorId: contractors['ООО «Кубань Агро»'].id,
      cargo: 'Сахар-песок в мешках, 40 паллет', weightT: 17,
      fromLocationId: loc['timashevsk'].id, toLocationId: loc['krasnodar'].id,
      loadingAt: new Date(now.getTime() + dayMs), unloadingWindow: 'завтра 12:00–14:00',
      docs: JSON.stringify(['ТТН', 'Качественное удостоверение', 'Счёт-фактура']),
    },
  })
  await db.statusHistory.createMany({
    data: [
      { requestId: r1071.id, fromStatus: null, toStatus: 'NEW', actor: 'Логист' },
      { requestId: r1071.id, fromStatus: 'NEW', toStatus: 'DISPATCH', actor: 'Авто' },
    ],
  })
  regLog.push({ user: 'Логист', action: 'REQUEST_CREATE', entity: 'TransportRequest', entityId: 'ЗК-2026/1071' })

  // ─── ЗК-2026/1074 — Металлопрокат листовой (DISPATCH) ───
  const r1074 = await db.transportRequest.create({
    data: {
      number: 'ЗК-2026/1074', status: 'DISPATCH',
      contractorId: contractors['ООО «Донсталь»'].id,
      cargo: 'Металлопрокат листовой, 2 шт.', weightT: 20.2,
      fromLocationId: loc['abinsk'].id, toLocationId: loc['rostov'].id,
      loadingAt: new Date(now.getTime() + 2 * dayMs), unloadingWindow: 'послезавтра 09:00–11:00',
      docs: JSON.stringify(['ТТН (2 экз.)', 'Паспорт груза']),
    },
  })
  await db.statusHistory.createMany({
    data: [
      { requestId: r1074.id, fromStatus: null, toStatus: 'NEW', actor: 'Логист' },
      { requestId: r1074.id, fromStatus: 'NEW', toStatus: 'DISPATCH', actor: 'Авто' },
    ],
  })
  regLog.push({ user: 'Логист', action: 'REQUEST_CREATE', entity: 'TransportRequest', entityId: 'ЗК-2026/1074' })

  // ─── ЗК-2026/1067 — назначена: рождение рейса уже произошло (как после работы диспетчера) ───
  const loadingAt = new Date('2026-11-12T06:30:00.000Z')
  const r1067 = await db.transportRequest.create({
    data: {
      number: 'ЗК-2026/1067', status: 'ASSIGNED',
      contractorId: contractors['ООО «Новороссийский терминал»'].id,
      cargo: 'Металлоконструкции (фермы), штучные', weightT: 18.5,
      fromLocationId: loc['abinsk'].id, toLocationId: loc['novoross'].id,
      loadingAt, unloadingWindow: 'сегодня 14:00–16:00',
      docs: JSON.stringify(['ТТН (2 экз.)', 'Паспорт груза', 'Пропуск на терминал', 'Акт допуска ТС']),
      vehicleId: veh['А 123 БС 23'].id, trailerId: tr['АВ 456 23'].id,
      driverId: drv[0].id, assignedBy: 'Диспетчер Е. Крылова', assignedAt: new Date(now.getTime() - 3600 * 1000),
    },
  })
  const route1067 = stubRoute(loc['abinsk'], loc['novoross'], 115000, 150)
  const trip1067 = await db.trip.create({
    data: {
      tripCode: 'ЗК-2026/1067', status: 'assigned',
      driverId: drv[0].id, vehicleId: veh['А 123 БС 23'].id,
      plannedStartAt: loadingAt, plannedFinishAt: new Date(loadingAt.getTime() + 150 * 60000),
      ...route1067,
    },
  })
  const pt1067: { id: string; tripId: string; seqNo: number; kind: string; name: string | null; address: string | null; lat: number; lon: number; geofenceRadiusM: number; plannedArrivalAt: Date | null; plannedDepartureAt: Date | null }[] = []
  pt1067.push(await db.tripPoint.create({
    data: { tripId: trip1067.id, seqNo: 1, kind: 'loading', name: loc['abinsk'].name, address: loc['abinsk'].address, lat: loc['abinsk'].lat, lon: loc['abinsk'].lon, plannedArrivalAt: loadingAt, plannedDepartureAt: new Date(loadingAt.getTime() + 40 * 60000) },
  }))
  pt1067.push(await db.tripPoint.create({
    data: { tripId: trip1067.id, seqNo: 2, kind: 'unloading', name: loc['novoross'].name, address: loc['novoross'].address, lat: loc['novoross'].lat, lon: loc['novoross'].lon, plannedArrivalAt: new Date(loadingAt.getTime() + 150 * 60000) },
  }))
  await db.transportRequest.update({ where: { id: r1067.id }, data: { tripId: trip1067.id } })
  await db.statusHistory.createMany({
    data: [
      { requestId: r1067.id, fromStatus: null, toStatus: 'NEW', actor: 'Логист' },
      { requestId: r1067.id, fromStatus: 'NEW', toStatus: 'DISPATCH', actor: 'Авто' },
      { requestId: r1067.id, fromStatus: 'DISPATCH', toStatus: 'ASSIGNED', actor: 'Диспетчер Е. Крылова', comment: 'МАЗ 5440 · А 123 БС 23 + НЕФАЗ 93341 · АВ 456 23' },
    ],
  })
  const note1067 = await db.systemNote.create({
    data: {
      driverId: drv[0].id, kind: 'ORDER_ASSIGNED',
      body: 'Вам назначена заявка ЗК-2026/1067: Металлоконструкции (фермы), штучные, Абинск, пл. АЗМЗ → Новороссийск, причал 27. Погрузка 12.11 06:30.',
      ref: JSON.stringify({ requestId: r1067.id, tripId: trip1067.id }),
    },
  })
  journal.push(
    { driverId: drv[0].id, entity: 'TRIP', op: 'UPSERT', payload: JSON.stringify(tripSnapshot({ ...trip1067 })) },
    ...pt1067.map((p) => ({ driverId: drv[0].id, entity: 'TRIP_POINT', op: 'UPSERT', payload: JSON.stringify(tripPointSnapshot(p)) })),
    { driverId: drv[0].id, entity: 'SYSTEM_NOTE', op: 'UPSERT', payload: JSON.stringify(systemNoteSnapshot(note1067)) },
  )
  regLog.push({ user: 'Логист', action: 'REQUEST_CREATE', entity: 'TransportRequest', entityId: 'ЗК-2026/1067' })
  regLog.push({ user: 'Диспетчер Е. Крылова', action: 'ASSIGN', entity: 'TransportRequest', entityId: 'ЗК-2026/1067' })

  // ─── Чат: пара сообщений диспетчера и водителя-демо ───
  const chat1 = await db.chatMessage.create({
    data: { driverId: drv[0].id, tripId: trip1067.id, sender: 'DISPATCHER', body: 'Добрый день, Сергей! Перед выездом проверьте крепление ферм и наличие пропуска на терминал.' },
  })
  const chat2 = await db.chatMessage.create({
    data: { driverId: drv[0].id, tripId: trip1067.id, sender: 'DRIVER', body: 'Принял, добрый день. Пропуск на руках, осмотр пройду утром.' },
  })
  journal.push(
    { driverId: drv[0].id, entity: 'CHAT_MESSAGE', op: 'UPSERT', payload: JSON.stringify(chatMessageSnapshot(chat1)) },
    { driverId: drv[0].id, entity: 'CHAT_MESSAGE', op: 'UPSERT', payload: JSON.stringify(chatMessageSnapshot(chat2)) },
  )
  regLog.push({ user: 'Диспетчер Е. Крылова', action: 'CHAT_SEND', entity: 'ChatMessage', entityId: chat1.id })

  await db.syncJournal.createMany({ data: journal })
  await db.registrationLog.createMany({
    data: regLog.map((r) => ({ user: r.user, action: r.action, entity: r.entity, entityId: r.entityId, level: r.level ?? 'info' })),
  })

  console.log('Сид готов: 6 заявок (1067 ASSIGNED, 1071/1074 DISPATCH, 3 DONE), нумератор на ЗК-2026/1075')
  console.log('Демо-водитель приложения: d1111111-1111-4111-8111-111111111111 (Иванов С.П.)')
}
```
```ts
// src/lib/1c/numbering.ts
// Нумератор документов «1С»: формат ЗК-ГГГГ/NNNN, годовой период, атомарный счётчик.
// Аналог SELECT … FOR UPDATE: инкремент внутри транзакции БД.
import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export async function nextRequestNumber(tx: Tx, when: Date = new Date()): Promise<string> {
  const year = String(when.getFullYear())
  // атомарный счётчик с повторами при занятой БД (SQLite BUSY под параллельной записью)
  let lastError: unknown = null
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const counter = await tx.numberCounter.upsert({
        where: { year },
        create: { year, last: 1001 },
        update: { last: { increment: 1 } },
      })
      return `ЗК-${year}/${counter.last}`
    } catch (e) {
      lastError = e
      const msg = e instanceof Error ? e.message : ''
      if (!/busy|locked|timeout/i.test(msg)) throw e
      await new Promise((r) => setTimeout(r, 60 * (attempt + 1)))
    }
  }
  throw lastError
}
```
```ts
// src/lib/1c/journal.ts
// «Журнал регистрации» 1С — аудит всех действий. Пишется из каждого доменного сервиса.
import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export async function logEvent(
  tx: Tx,
  entry: {
    user: string
    action: string
    entity: string
    entityId?: string | null
    level?: 'info' | 'warning' | 'error'
  },
): Promise<void> {
  await tx.registrationLog.create({
    data: {
      user: entry.user,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      level: entry.level ?? 'info',
    },
  })
}
```
```ts
// src/lib/1c/statuses.ts
// Статусная модель заявки (раздел 5 ТЗ) и маппинг в статусы приложения водителя
export const REQUEST_STATUSES = [
  'NEW',
  'DISPATCH',
  'ASSIGNED',
  'ACCEPTED',
  'PRETRIP',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export const STATUS_LABELS: Record<string, string> = {
  NEW: 'Заведена сбытом',
  DISPATCH: 'В диспетчерской',
  ASSIGNED: 'Назначена ТС и водителю',
  ACCEPTED: 'Взята водителем',
  PRETRIP: 'Предрейсовая подготовка',
  IN_PROGRESS: 'В пути',
  DONE: 'Выполнена',
  CANCELLED: 'Отменена',
}

// Таблица 8 ТЗ: внутренний статус → Order1C.status для водителя
export function mapOrderStatus(internal: string): 'DISPATCH' | 'ASSIGNED' | 'DONE' | null {
  switch (internal) {
    case 'NEW':
    case 'DISPATCH':
      return 'DISPATCH'
    case 'ASSIGNED':
    case 'ACCEPTED':
    case 'PRETRIP':
    case 'IN_PROGRESS':
      return 'ASSIGNED'
    case 'DONE':
      return 'DONE'
    default:
      return null // CANCELLED не возвращается — водитель получит SystemNote
  }
}

// Причины отмены («1С»: справочник причин закрытия заказов)
export const CANCEL_REASONS = [
  'Отмена заказчиком',
  'Нет доступного ТС',
  'Ошибка в заявке',
  'Груз не готов к отправке',
  'Отказ грузополучателя',
  'Дублирование заявки',
]

// Справочник шагов предрейсовой фотофиксации (таблица 9 ТЗ)
export const PRETRIP_STEPS = [
  { stepId: 'veh_side', label: 'ТС сбоку: правый борт целиком, госномер в кадре', group: 'vehicle' },
  { stepId: 'veh_front', label: 'ТС спереди: виден госномер тягача', group: 'vehicle' },
  { stepId: 'veh_rear', label: 'ТС сзади: кузов и полуприцеп', group: 'vehicle' },
  { stepId: 'order_docs', label: 'Документы по заявке: ТТН, паспорт груза, пропуск', group: 'order_docs' },
  { stepId: 'lic', label: 'Водительское удостоверение, обе стороны', group: 'personal' },
  { stepId: 'passport', label: 'Паспорт: разворот с фото и регистрацией', group: 'personal' },
] as const
export type PretripStepId = (typeof PRETRIP_STEPS)[number]['stepId']
export const PRETRIP_STEP_IDS = PRETRIP_STEPS.map((s) => s.stepId) as PretripStepId[]
```
```ts
// src/lib/1c/requests.ts
// Доменный сервис документа «Заказ на ТС» (TransportRequest):
// создание сбытом, переходы статусов с регистром StatusHistory.
import type { Prisma } from '@prisma/client'
import { db, withWriteLock } from '../db'
import { nextRequestNumber } from './numbering'
import { logEvent } from './journal'

export type CreateRequestInput = {
  contractorId: string
  cargo: string
  weightT: number
  fromLocationId: string
  toLocationId: string
  loadingAt: string | Date
  unloadingWindow: string
  docs: string[]
  actor?: string
}

// Сбыт заводит заявку: нумератор + запись в журнал + сразу DISPATCH (попадает в пул назначения)
export async function createRequest(input: CreateRequestInput) {
  return withWriteLock(() =>
    db.$transaction(async (tx) => {
    const number = await nextRequestNumber(tx)
    const req = await tx.transportRequest.create({
      data: {
        number,
        status: 'DISPATCH',
        contractorId: input.contractorId,
        cargo: input.cargo,
        weightT: input.weightT,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        loadingAt: new Date(input.loadingAt),
        unloadingWindow: input.unloadingWindow,
        docs: JSON.stringify(input.docs),
      },
      include: { contractor: true, fromLocation: true, toLocation: true },
    })
    await tx.statusHistory.create({
      data: { requestId: req.id, fromStatus: null, toStatus: 'NEW', actor: input.actor ?? 'Логист' },
    })
    await tx.statusHistory.create({
      data: { requestId: req.id, fromStatus: 'NEW', toStatus: 'DISPATCH', actor: 'Авто' },
    })
    await logEvent(tx, {
      user: input.actor ?? 'Логист',
      action: 'REQUEST_CREATE',
      entity: 'TransportRequest',
      entityId: number,
    })
      return req
    }, { timeout: 15000 }),
  )
}

// Смена статуса через «регистр статусов»
export async function changeStatus(
  tx: Prisma.TransactionClient,
  requestId: string,
  toStatus: string,
  actor: string,
  comment?: string,
): Promise<void> {
  const current = await tx.transportRequest.findUnique({ where: { id: requestId }, select: { status: true } })
  if (!current) throw new Error('Заявка не найдена')
  await tx.transportRequest.update({ where: { id: requestId }, data: { status: toStatus } })
  await tx.statusHistory.create({
    data: { requestId, fromStatus: current.status, toStatus, actor, comment },
  })
}

const requestInclude = {
  contractor: true,
  fromLocation: true,
  toLocation: true,
  vehicle: true,
  trailer: true,
  driver: true,
  trip: { include: { points: true, events: { orderBy: { occurredAt: 'asc' as const } } } },
} satisfies Prisma.TransportRequestInclude

export async function listRequests(status?: string) {
  return db.transportRequest.findMany({
    where: status ? { status } : undefined,
    include: requestInclude,
    orderBy: { number: 'desc' },
  })
}

export async function getRequest(idOrNumber: string) {
  return db.transportRequest.findFirst({
    where: { OR: [{ id: idOrNumber }, { number: idOrNumber }] },
    include: requestInclude,
  })
}
```
```ts
// src/lib/1c/assign.ts
// Рождение рейса (интеграционная точка №2, раздел 3.4 и 5.3 ТЗ).
// Назначение диспетчером выполняется В ОДНОЙ ТРАНЗАКЦИИ БД:
// валидации → ASSIGNED + StatusHistory → Trip + TripPoint → SyncJournal (TRIP, TRIP_POINT) → SystemNote (+ в SyncJournal).
// Если записи плана обмена не появятся в той же транзакции — водитель не увидит назначение.
import type { Prisma } from '@prisma/client'
import { db, withWriteLock } from '../db'
import { logEvent } from './journal'
import { driverIssues, vehicleIssues } from './eligibility'
import { computeRoute } from './route'
import { tripSnapshot, tripPointSnapshot, systemNoteSnapshot } from '../bus/snapshots'
import { journalWrite } from '../bus/syncWriter'

export type AssignResult =
  | { ok: true; requestId: string; tripId: string; number: string }
  | { ok: false; errors: string[] }

export async function assignRequest(
  requestId: string,
  input: { vehicleId: string; trailerId?: string | null; driverId: string },
  actor = 'Диспетчер',
): Promise<AssignResult> {
  // 1. Валидации проведения (вне транзакции — только чтение)
  const request = await db.transportRequest.findUnique({
    where: { id: requestId },
    include: { fromLocation: true, toLocation: true },
  })
  if (!request) return { ok: false, errors: ['Заявка не найдена'] }
  if (request.status !== 'DISPATCH')
    return { ok: false, errors: [`Заявка в статусе ${request.status} — назначение возможно только из статуса DISPATCH`] }

  const vehicle = await db.vehicle.findUnique({ where: { id: input.vehicleId } })
  if (!vehicle) return { ok: false, errors: ['ТС не найдено'] }

  const driver = await db.driver.findUnique({ where: { id: input.driverId } })
  if (!driver) return { ok: false, errors: ['Водитель не найден'] }

  let trailer: { id: string; type: string } | null = null
  if (input.trailerId) {
    trailer = await db.trailer.findUnique({ where: { id: input.trailerId } })
    if (!trailer) return { ok: false, errors: ['Прицеп не найден'] }
  }

  const errors: string[] = [
    ...vehicleIssues(vehicle, { cargo: request.cargo, weightT: request.weightT }).map((i) => i.text),
    ...(trailer && trailer.type !== vehicle.bodyType
      ? ['Тип прицепа не совпадает с типом кузова ТС']
      : []),
    ...(await driverIssues(db, driver)).map((i) => i.text),
  ]
  if (errors.length > 0) {
    await withWriteLock(() =>
      db.$transaction(async (tx) => {
        await logEvent(tx, {
          user: actor,
          action: 'ASSIGN_REJECTED',
          entity: 'TransportRequest',
          entityId: request.number,
          level: 'warning',
        })
      }),
    )
    return { ok: false, errors }
  }

  // 2. Роутинг не блокирует транзакцию: сначала считаем маршрут (с заглушкой при недоступности)
  const route = await computeRoute(
    { lat: request.fromLocation.lat, lon: request.fromLocation.lon },
    { lat: request.toLocation.lat, lon: request.toLocation.lon },
  )

  // 3. Атомарное назначение — одна транзакция
  try {
    const result = await withWriteLock(() =>
      db.$transaction(
        async (tx) => {
        // повторная проверка статуса внутри транзакции (гонки между диспетчерами)
        const fresh = await tx.transportRequest.findUnique({ where: { id: requestId }, select: { status: true, number: true } })
        if (!fresh || fresh.status !== 'DISPATCH') throw new Error('Заявка уже назначена или отменена')

        const busy = await tx.trip.findFirst({
          where: { driverId: driver.id, status: { in: ['assigned', 'in_progress'] } },
          select: { id: true },
        })
        if (busy) throw new Error(`Водитель занят в другом незавершённом рейсе`)

        await tx.transportRequest.update({
          where: { id: requestId },
          data: {
            status: 'ASSIGNED',
            vehicleId: vehicle.id,
            trailerId: trailer?.id ?? null,
            driverId: driver.id,
            assignedBy: actor,
            assignedAt: new Date(),
          },
        })
        await tx.statusHistory.create({
          data: {
            requestId,
            fromStatus: 'DISPATCH',
            toStatus: 'ASSIGNED',
            actor,
            comment: `${vehicle.model} · ${vehicle.plate}${trailer ? ` + прицеп` : ''}`,
          },
        })

        const trip =
          (await tx.trip.findUnique({ where: { tripCode: fresh.number } })) ??
          (await tx.trip.create({
            data: { tripCode: fresh.number, status: 'assigned', driverId: driver.id, vehicleId: vehicle.id },
          }))
        await tx.trip.update({
          where: { id: trip.id },
          data: {
            status: 'assigned',
            driverId: driver.id,
            vehicleId: vehicle.id,
            plannedStartAt: request.loadingAt,
            plannedFinishAt: new Date(request.loadingAt.getTime() + route.routeDurationS * 1000),
            routeGeoJson: route.routeGeoJson,
            routeStepsJson: route.routeStepsJson,
            routeDistanceM: route.routeDistanceM,
            routeDurationS: route.routeDurationS,
            routeMinLat: route.routeMinLat,
            routeMinLon: route.routeMinLon,
            routeMaxLat: route.routeMaxLat,
            routeMaxLon: route.routeMaxLon,
          },
        })
        await tx.transportRequest.update({ where: { id: requestId }, data: { tripId: trip.id } })

        // Точки маршрута: погрузка и выгрузка
        const prevPoints = await tx.tripPoint.findMany({ where: { tripId: trip.id }, select: { id: true } })
        if (prevPoints.length > 0) await tx.tripPoint.deleteMany({ where: { tripId: trip.id } })
        const point1 = await tx.tripPoint.create({
          data: {
            tripId: trip.id, seqNo: 1, kind: 'loading',
            name: request.fromLocation.name, address: request.fromLocation.address,
            lat: request.fromLocation.lat, lon: request.fromLocation.lon,
            geofenceRadiusM: request.fromLocation.geofenceRadiusM,
            plannedArrivalAt: request.loadingAt,
            plannedDepartureAt: new Date(request.loadingAt.getTime() + 40 * 60000),
          },
        })
        const point2 = await tx.tripPoint.create({
          data: {
            tripId: trip.id, seqNo: 2, kind: 'unloading',
            name: request.toLocation.name, address: request.toLocation.address,
            lat: request.toLocation.lat, lon: request.toLocation.lon,
            geofenceRadiusM: request.toLocation.geofenceRadiusM,
            plannedArrivalAt: new Date(request.loadingAt.getTime() + route.routeDurationS * 1000),
          },
        })

        const freshTrip = await tx.trip.findUniqueOrThrow({ where: { id: trip.id } })

        // Записи плана обмена — в той же транзакции (требование каркаса)
        await journalWrite(tx, driver.id, 'TRIP', 'UPSERT', tripSnapshot(freshTrip))
        await journalWrite(tx, driver.id, 'TRIP_POINT', 'UPSERT', tripPointSnapshot(point1))
        await journalWrite(tx, driver.id, 'TRIP_POINT', 'UPSERT', tripPointSnapshot(point2))

        const note = await tx.systemNote.create({
          data: {
            driverId: driver.id,
            kind: 'ORDER_ASSIGNED',
            body: `Вам назначена заявка ${fresh.number}: ${request.cargo}, ${request.fromLocation.name} → ${request.toLocation.name}. Погрузка ${request.loadingAt.toLocaleString('ru-RU')}.`,
            ref: JSON.stringify({ requestId, tripId: trip.id }),
          },
        })
        await journalWrite(tx, driver.id, 'SYSTEM_NOTE', 'UPSERT', systemNoteSnapshot(note))

        await logEvent(tx, { user: actor, action: 'ASSIGN', entity: 'TransportRequest', entityId: fresh.number })
        return { requestId, tripId: trip.id, number: fresh.number }
      },
        { timeout: 15000 },
      ),
    )
    return { ok: true, ...result }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Ошибка проведения назначения'
    await withWriteLock(() =>
      db.$transaction(async (tx) => {
        await logEvent(tx, { user: actor, action: 'ASSIGN_REJECTED', entity: 'TransportRequest', entityId: requestId, level: 'warning' })
      }),
    )
    return { ok: false, errors: [message] }
  }
}
```
```ts
// src/lib/1c/cancel.ts
// Отмена заявки диспетчером: причина из справочника + SystemNote водителю через план обмена.
import { db, withWriteLock } from '../db'
import { changeStatus } from './requests'
import { logEvent } from './journal'
import { systemNoteSnapshot } from '../bus/snapshots'
import { journalWrite } from '../bus/syncWriter'

export async function cancelRequest(requestId: string, reason: string, actor = 'Диспетчер') {
  const request = await db.transportRequest.findUnique({ where: { id: requestId }, include: { driver: true } })
  if (!request) return { ok: false as const, error: 'Заявка не найдена' }
  if (['DONE', 'CANCELLED'].includes(request.status))
    return { ok: false as const, error: `Заявка в статусе ${request.status} — отмена невозможна` }

  const result = await withWriteLock(() =>
    db.$transaction(async (tx) => {
    await changeStatus(tx, requestId, 'CANCELLED', actor, reason)
    await tx.transportRequest.update({ where: { id: requestId }, data: { closeReason: reason } })
    if (request.tripId) {
      await tx.trip.update({ where: { id: request.tripId }, data: { status: 'cancelled' } })
    }
    if (request.driverId) {
      const note = await tx.systemNote.create({
        data: {
          driverId: request.driverId,
          kind: 'ORDER_CANCELLED',
          body: `Заявка ${request.number} отменена диспетчером. Причина: ${reason}.`,
          ref: JSON.stringify({ requestId }),
        },
      })
      await journalWrite(tx, request.driverId, 'SYSTEM_NOTE', 'UPSERT', systemNoteSnapshot(note))
    }
    await logEvent(tx, { user: actor, action: 'CANCEL', entity: 'TransportRequest', entityId: request.number })
      return { number: request.number }
    }, { timeout: 15000 }),
  )
  return { ok: true as const, ...result }
}
```
```ts
// src/lib/1c/eligibility.ts
// Правила проведения при назначении (раздел 5.3 ТЗ):
// готовность ТС, грузоподъёмность, совместимость кузова и груза, активность и занятость водителя, статус заявки.
import type { Prisma } from '@prisma/client'

export type VehicleLite = {
  id: string
  plate: string
  model: string
  bodyType: string
  capacityT: number
  readiness: string
  isActive: boolean
}
export type DriverLite = { id: string; fullName: string; isActive: boolean }

// Справочная матрица «тип кузова → виды груза» (ключевые слова на русском)
const BODY_CARGO: Record<string, string[]> = {
  tarp: ['металло', 'паллет', 'мешк', 'ферм', 'прокат', 'лист', 'оборудован', 'пиломатериал', 'труб', 'рулон', 'шпала', 'кирпич'],
  fridge: ['продукт', 'мясо', 'рыба', 'молок', 'заморож', 'овощ', 'фрукт', 'морожен', 'медикамент', 'цвет'],
  flatbed: ['металло', 'прокат', 'лист', 'труб', 'жби', 'плита', 'бетон', 'кирпич', 'ферм', 'контейнер', 'рулон'],
  tank: ['наливн', 'топлив', 'молок наливн', 'битум'],
}

export function bodyCompatible(bodyType: string, cargo: string): boolean {
  const keys = BODY_CARGO[bodyType]
  if (!keys) return false
  const c = cargo.toLowerCase()
  return keys.some((k) => c.includes(k))
}

export type EligibilityIssue = { code: string; text: string }

export function vehicleIssues(v: VehicleLite, request: { cargo: string; weightT: number }): EligibilityIssue[] {
  const issues: EligibilityIssue[] = []
  if (!v.isActive) issues.push({ code: 'VEHICLE_INACTIVE', text: 'ТС выведено из эксплуатации' })
  if (v.readiness !== 'ready')
    issues.push({ code: 'VEHICLE_NOT_READY', text: `ТС недоступно: ${v.readiness === 'repair' ? 'в ремонте' : 'на обслуживании'}` })
  if (request.weightT > v.capacityT)
    issues.push({ code: 'CAPACITY', text: `Грузоподъёмность ${v.capacityT} т меньше веса груза ${request.weightT} т` })
  if (!bodyCompatible(v.bodyType, request.cargo))
    issues.push({ code: 'BODY_TYPE', text: 'Тип кузова не совместим с грузом' })
  return issues
}

export async function driverIssues(
  tx: Prisma.TransactionClient,
  d: DriverLite,
): Promise<EligibilityIssue[]> {
  const issues: EligibilityIssue[] = []
  if (!d.isActive) issues.push({ code: 'DRIVER_INACTIVE', text: 'Водитель не активен' })
  const busy = await tx.trip.findFirst({
    where: { driverId: d.id, status: { in: ['assigned', 'in_progress'] } },
    select: { tripCode: true },
  })
  if (busy) issues.push({ code: 'DRIVER_BUSY', text: `Занят в незавершённом рейсе ${busy.tripCode}` })
  return issues
}

export const BODY_TYPE_LABELS: Record<string, string> = {
  tarp: 'штора',
  fridge: 'рефрижератор',
  flatbed: 'борт',
  tank: 'цистерна',
}
export const READINESS_LABELS: Record<string, string> = {
  ready: 'готов',
  maintenance: 'обслуживание',
  repair: 'ремонт',
}
export const KIND_LABELS: Record<string, string> = {
  tractor: 'тягач',
  tipper: 'самосвал',
  van: 'фургон',
}
```
```ts
// src/lib/1c/route.ts
// Расчёт маршрута: серверный прокси 2ГИС Routing API (GIS2_API_KEY),
// при недоступности — заглушка: прямая между пунктами, время по средней скорости.
// Роутинг никогда не блокирует транзакцию назначения.
import { haversineM } from '../epoch'

type Pt = { lat: number; lon: number }

export type RouteResult = {
  routeGeoJson: string
  routeStepsJson: string | null
  routeDistanceM: number
  routeDurationS: number
  routeMinLat: number
  routeMinLon: number
  routeMaxLat: number
  routeMaxLon: number
  provider: '2gis' | 'stub'
}

function stubRoute(a: Pt, b: Pt): RouteResult {
  const straight = haversineM(a, b)
  const distanceM = Math.round(straight * 1.2) // коэффициент извилистости автодорог
  const avgKmh = 55
  const durationS = Math.round((distanceM / 1000 / avgKmh) * 3600)
  const geo = {
    type: 'LineString',
    coordinates: [0, 0.25, 0.5, 0.75, 1].map((k) => [
      +(a.lon + (b.lon - a.lon) * k).toFixed(6),
      +(a.lat + (b.lat - a.lat) * k).toFixed(6),
    ]),
  }
  return {
    routeGeoJson: JSON.stringify(geo),
    routeStepsJson: null,
    routeDistanceM: distanceM,
    routeDurationS: durationS,
    routeMinLat: Math.min(a.lat, b.lat),
    routeMinLon: Math.min(a.lon, b.lon),
    routeMaxLat: Math.max(a.lat, b.lat),
    routeMaxLon: Math.max(a.lon, b.lon),
    provider: 'stub',
  }
}

export async function computeRoute(from: Pt, to: Pt): Promise<RouteResult> {
  const key = process.env.GIS2_API_KEY
  if (!key) return stubRoute(from, to)
  try {
    const url = `https://routing.api.2gis.com/routing/7.0.0?key=${encodeURIComponent(key)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [
          { type: 'stop', lon: from.lon, lat: from.lat },
          { type: 'stop', lon: to.lon, lat: to.lat },
        ],
        transport: 'truck',
        traffic_mode: 'jam',
        output: 'detailed',
      }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return stubRoute(from, to)
    const data = (await res.json()) as {
      route?: { distance?: number; duration?: number; geometry?: string; maneuvers?: unknown[] }
    }
    const r = data.route
    if (!r || !r.distance || !r.duration) return stubRoute(from, to)
    let geometry: { type: string; coordinates: number[][] } | null = null
    if (r.geometry) {
      try {
        geometry = JSON.parse(r.geometry)
      } catch {
        geometry = null
      }
    }
    if (!geometry || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
      return stubRoute(from, to)
    }
    const lats = geometry.coordinates.map((c) => c[1])
    const lons = geometry.coordinates.map((c) => c[0])
    return {
      routeGeoJson: JSON.stringify(geometry),
      routeStepsJson: r.maneuvers ? JSON.stringify(r.maneuvers) : null,
      routeDistanceM: Math.round(r.distance),
      routeDurationS: Math.round(r.duration),
      routeMinLat: Math.min(...lats),
      routeMinLon: Math.min(...lons),
      routeMaxLat: Math.max(...lats),
      routeMaxLon: Math.max(...lons),
      provider: '2gis',
    }
  } catch {
    return stubRoute(from, to)
  }
}
```
```ts
// src/lib/1c/tripEvents.ts
// События рейса (TripEvent): авто-закрытие интервалов и автостатусы рейса.
// Новое событие закрывает открытую «открывашку»; lastEventType/At рейса пересчитываются;
// DEPARTURE → in_progress, TRIP_DONE → completed. Все записи — в журнале водителя (SyncJournal).
import type { Prisma } from '@prisma/client'
import { tripSnapshot, tripEventSnapshot } from '../bus/snapshots'
import { journalWrite } from '../bus/syncWriter'

export const EVENT_OPENS_INTERVAL = new Set(['DEPARTURE', 'ARRIVAL_LOADING', 'LOADING_DONE', 'REST_START', 'REST_END', 'ARRIVAL_UNLOADING', 'UNLOADING_DONE'])

export async function applyTripEvent(
  tx: Prisma.TransactionClient,
  input: {
    tripId: string
    type: string
    driverId: string
    vehicleId: string
    tripPointId?: string | null
    deviceId?: string | null
    source: 'GEOFENCE' | 'MANUAL' | 'MANUAL_BACKDATED'
    occurredAt?: Date
    lat?: number | null
    lon?: number | null
    note?: string | null
  },
): Promise<{ eventId: string; closedEventId: string | null }> {
  const trip = await tx.trip.findUnique({ where: { id: input.tripId } })
  if (!trip) throw new Error('Рейс не найден')

  // авто-закрытие: новое событие закрывает последнюю открытую «открывашку»
  const lastOpen = await tx.tripEvent.findFirst({
    where: { tripId: input.tripId, intervalClosedAt: null },
    orderBy: { occurredAt: 'desc' },
  })

  const occurredAt = input.occurredAt ?? new Date()
  const ev = await tx.tripEvent.create({
    data: {
      tripId: input.tripId,
      tripPointId: input.tripPointId ?? null,
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      deviceId: input.deviceId ?? null,
      type: input.type,
      occurredAt,
      source: input.source,
      lat: input.lat ?? null,
      lon: input.lon ?? null,
      note: input.note ?? null,
      intervalClosedAt: lastOpen ? occurredAt : null,
      intervalClosedBy: lastOpen ? input.type : null,
      intervalAutoClosed: lastOpen ? true : null,
    },
  })
  if (lastOpen) {
    await tx.tripEvent.update({
      where: { id: lastOpen.id },
      data: { intervalClosedAt: occurredAt, intervalClosedBy: input.type, intervalAutoClosed: true },
    })
  }

  // автостатусы рейса
  const status =
    input.type === 'DEPARTURE' ? 'in_progress' : input.type === 'TRIP_DONE' ? 'completed' : trip.status
  await tx.trip.update({
    where: { id: input.tripId },
    data: { status, lastEventType: input.type, lastEventAt: occurredAt },
  })

  // снимки в план обмена: событие + обновлённый рейс
  const freshTrip = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId } })
  await journalWrite(tx, input.driverId, 'TRIP_EVENT', 'UPSERT', tripEventSnapshot({ ...ev, intervalClosedAt: lastOpen ? occurredAt : null, intervalClosedBy: lastOpen ? input.type : null, intervalAutoClosed: lastOpen ? true : null }))
  await journalWrite(tx, input.driverId, 'TRIP', 'UPSERT', tripSnapshot(freshTrip))

  return { eventId: ev.id, closedEventId: lastOpen?.id ?? null }
}
```
```ts
// src/lib/1c/driverActions.ts
// Обратный канал действий водителя (раздел 5.4 и 6.2 ТЗ):
// ACCEPT | PRETRIP_STEP | START_ROUTE | COMPLETE_TRIP. Действие ASSIGN запрещено.
// Все действия идемпотентны на уникальных ключах и пишутся в журнал регистрации.
import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { db, withWriteLock } from '../db'
import { logEvent } from './journal'
import { changeStatus } from './requests'
import { PRETRIP_STEP_IDS } from './statuses'
import { applyTripEvent } from './tripEvents'
import { savePhotoDataUrl } from '../photos'

export type DriverAction = 'ACCEPT' | 'PRETRIP_STEP' | 'START_ROUTE' | 'COMPLETE_TRIP'

export type DriverActionResult =
  | { ok: true; received: { at: string; orderId: string; action: DriverAction; stepId?: string } }
  | { ok: false; code: 400 | 403 | 404 | 409; error: string }

export async function driverAction(
  input: {
    orderId: string
    action: string
    stepId?: string | null
    at?: string | null
    photoDataUrl?: string | null
  },
  driver: { id: string; fullName: string } | null,
): Promise<DriverActionResult> {
  const at = input.at ? new Date(input.at) : new Date()

  if (input.action === 'ASSIGN') {
    return { ok: false, code: 400, error: 'Действие ASSIGN в обратном канале запрещено — назначение выполняет только диспетчер' }
  }

  const request = await db.transportRequest.findFirst({
    where: { OR: [{ id: input.orderId }, { number: input.orderId }] },
    include: { trip: true },
  })
  if (!request) return { ok: false, code: 404, error: 'Заявка не найдена' }
  if (driver && request.driverId && request.driverId !== driver.id)
    return { ok: false, code: 403, error: 'Заявка назначена другому водителю' }

  const actor = driver ? `driver:${driver.id}` : 'driver:<demo>'

  switch (input.action) {
    case 'ACCEPT': {
      if (!['ASSIGNED', 'ACCEPTED', 'PRETRIP'].includes(request.status))
        return { ok: false, code: 400, error: `Заявка в статусе ${request.status} — брать нельзя` }
      if (request.status === 'ASSIGNED') {
        await withWriteLock(() =>
          db.$transaction(async (tx) => {
            await changeStatus(tx, request.id, 'ACCEPTED', actor)
            await logEvent(tx, { user: actor, action: 'DRIVER_ACTION', entity: 'TransportRequest', entityId: request.number })
          }),
        )
      }
      break
    }

    case 'PRETRIP_STEP': {
      if (!['ASSIGNED', 'ACCEPTED', 'PRETRIP'].includes(request.status))
        return { ok: false, code: 400, error: `Фотофиксация недоступна: заявка в статусе ${request.status}` }
      if (!input.stepId || !PRETRIP_STEP_IDS.includes(input.stepId as never))
        return { ok: false, code: 400, error: 'Обязателен корректный stepId (veh_side…passport)' }
      const photoUrl = input.photoDataUrl ? await savePhotoDataUrl(input.photoDataUrl) : null
      await withWriteLock(() =>
        db.$transaction(async (tx: Prisma.TransactionClient) => {
        const inspection = await tx.preTripInspection.upsert({
          where: { requestId: request.id },
          create: { requestId: request.id, driverId: request.driverId ?? driver?.id ?? '', vehicleId: request.vehicleId },
          update: {},
        })
        await tx.preTripStep.upsert({
          where: { inspectionId_stepId: { inspectionId: inspection.id, stepId: input.stepId! } },
          create: { inspectionId: inspection.id, stepId: input.stepId!, photoUrl, at },
          update: { photoUrl: photoUrl ?? undefined, at },
        })
        if (request.status === 'ASSIGNED' || request.status === 'ACCEPTED') {
          await changeStatus(tx, request.id, 'PRETRIP', actor)
        }
          await logEvent(tx, { user: actor, action: 'DRIVER_ACTION', entity: 'PreTripStep', entityId: `${request.number}:${input.stepId}` })
        }, { timeout: 15000 }),
      )
      break
    }

    case 'START_ROUTE': {
      if (request.status === 'IN_PROGRESS') break // повторное нажатие — идемпотентно
      if (request.status !== 'PRETRIP' && request.status !== 'ACCEPTED' && request.status !== 'ASSIGNED')
        return { ok: false, code: 400, error: `Начать маршрут нельзя: заявка в статусе ${request.status}` }
      const inspection = await db.preTripInspection.findUnique({
        where: { requestId: request.id },
        include: { steps: true },
      })
      const doneSteps = new Set(inspection?.steps.map((s) => s.stepId) ?? [])
      const missing = PRETRIP_STEP_IDS.filter((s) => !doneSteps.has(s))
      if (missing.length > 0) {
        await withWriteLock(() =>
          db.$transaction(async (tx) => {
            await logEvent(tx, {
              user: actor, action: 'DRIVER_ACTION_REJECTED', entity: 'TransportRequest',
              entityId: request.number, level: 'warning',
            })
          }),
        )
        return { ok: false, code: 409, error: `Предрейсовый осмотр не завершён. Не хватает шагов: ${missing.join(', ')}` }
      }
      if (!request.trip) return { ok: false, code: 400, error: 'У заявки нет рейса' }
      await withWriteLock(() =>
        db.$transaction(async (tx) => {
          await changeStatus(tx, request.id, 'IN_PROGRESS', actor)
          await applyTripEvent(tx, {
            tripId: request.tripId!,
            type: 'DEPARTURE',
            driverId: request.driverId ?? driver?.id ?? '',
            vehicleId: request.vehicleId ?? '',
            source: 'MANUAL',
            occurredAt: at,
          })
          await logEvent(tx, { user: actor, action: 'DRIVER_ACTION', entity: 'TransportRequest', entityId: request.number })
        }, { timeout: 15000 }),
      )
      break
    }

    case 'COMPLETE_TRIP': {
      if (request.status === 'DONE') break
      if (request.status !== 'IN_PROGRESS')
        return { ok: false, code: 400, error: `Завершить нельзя: заявка в статусе ${request.status} (нет события DEPARTURE)` }
      if (!request.trip) return { ok: false, code: 400, error: 'У заявки нет рейса' }
      await withWriteLock(() =>
        db.$transaction(async (tx) => {
          await changeStatus(tx, request.id, 'DONE', actor)
          await applyTripEvent(tx, {
            tripId: request.tripId!,
            type: 'TRIP_DONE',
            driverId: request.driverId ?? driver?.id ?? '',
            vehicleId: request.vehicleId ?? '',
            source: 'MANUAL',
            occurredAt: at,
          })
          await logEvent(tx, { user: actor, action: 'DRIVER_ACTION', entity: 'TransportRequest', entityId: request.number })
        }, { timeout: 15000 }),
      )
      break
    }

    default:
      return { ok: false, code: 400, error: `Неизвестное действие: ${input.action}` }
  }

  return {
    ok: true,
    received: {
      at: at.toISOString(),
      orderId: request.number,
      action: input.action,
      ...(input.stepId ? { stepId: input.stepId } : {}),
    },
  }
}

export function newOperationId(): string {
  return randomUUID()
}
```
```ts
// src/lib/1c/statusCounts.ts
// Счётчики заявок по статусам (дашборд и список заявок)
import { db } from '@/lib/db'
import { REQUEST_STATUSES } from './statuses'

export async function statusCounts(): Promise<Record<string, number>> {
  const group = await db.transportRequest.groupBy({ by: ['status'], _count: { status: true } })
  const counts: Record<string, number> = {}
  for (const s of REQUEST_STATUSES) counts[s] = 0
  for (const g of group) counts[g.status] = g._count.status
  return counts
}
```
```ts
// src/lib/1c/dblike.ts
import { db as prisma } from '../db'
import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

export { prisma }
export type DbLike = typeof prisma
```
```ts
// src/lib/1c/demos.ts
// Демо-сервисы (демо-панель): случайная заявка, автопрогон сквозного сценария, сброс и пересев.
import { db, withWriteLock } from '../db'
import { seedAll } from '../seedAll'
import { createRequest } from './requests'
import { assignRequest } from './assign'
import { driverAction } from './driverActions'
import { journalWrite } from '../bus/syncWriter'
import { chatMessageSnapshot } from '../bus/snapshots'
import { logEvent } from './journal'

const CARGOS = [
  { name: 'Металлоконструкции (фермы), штучные', weight: 18.5, docs: ['ТТН (2 экз.)', 'Паспорт груза', 'Пропуск на терминал'] },
  { name: 'Сахар-песок в мешках, 40 паллет', weight: 17, docs: ['ТТН', 'Качественное удостоверение', 'Счёт-фактура'] },
  { name: 'Металлопрокат листовой, 2 шт.', weight: 20.2, docs: ['ТТН (2 экз.)', 'Паспорт груза'] },
  { name: 'Трубы стальные, 12 м', weight: 15, docs: ['ТТН (2 экз.)'] },
  { name: 'Пиломатериалы обрезные', weight: 12, docs: ['ТТН', 'Счёт-фактура'] },
  { name: 'Кирпич керамический, паллеты', weight: 19, docs: ['ТТН', 'Качественное удостоверение'] },
  { name: 'Оборудование промышленное, ящики', weight: 9.5, docs: ['ТТН (2 экз.)', 'Паспорт груза'] },
]

export async function createRandomRequest(actor = 'Демо-панель') {
  const contractors = await db.contractor.findMany()
  const locations = await db.location.findMany()
  const cargo = CARGOS[Math.floor(Math.random() * CARGOS.length)]
  const contractor = contractors[Math.floor(Math.random() * contractors.length)]
  let from = locations[Math.floor(Math.random() * locations.length)]
  let to = locations[Math.floor(Math.random() * locations.length)]
  while (to.id === from.id) to = locations[Math.floor(Math.random() * locations.length)]

  const loadingAt = new Date(Date.now() + (12 + Math.floor(Math.random() * 36)) * 3600 * 1000)
  const req = await createRequest({
    contractorId: contractor.id,
    cargo: cargo.name,
    weightT: cargo.weight,
    fromLocationId: from.id,
    toLocationId: to.id,
    loadingAt,
    unloadingWindow: 'на следующий день 09:00–12:00',
    docs: cargo.docs,
    actor,
  })
  return req
}

export type AutoflowStep = { step: string; ok: boolean; detail: string }

// Автопрогон сквозного сценария 10.1: заявка → назначение → ACCEPT → осмотр (6) → старт → завершение → чат
export async function autoflow(actor = 'Демо-панель'): Promise<AutoflowStep[]> {
  const log: AutoflowStep[] = []
  const push = (step: string, ok: boolean, detail: string) => log.push({ step, ok, detail })

  // Находим ЗК-2026/1071 либо создаём случайную
  let request = await db.transportRequest.findUnique({ where: { number: 'ЗК-2026/1071' }, include: { fromLocation: true, toLocation: true } })
  if (!request || request.status !== 'DISPATCH') {
    const created = await createRandomRequest(actor)
    request = await db.transportRequest.findUniqueOrThrow({ where: { id: created.id }, include: { fromLocation: true, toLocation: true } })
  }
  push('Заявка', true, `${request.number} в статусе DISPATCH`)

  // Назначение: КАМАЗ 5490 + свободный водитель (№2 по сценарию, если не занят в другом рейсе)
  const vehicle = await db.vehicle.findFirst({ where: { model: { startsWith: 'КАМАЗ 5490' }, readiness: 'ready' } })
  const allDrivers = await db.driver.findMany({ orderBy: { createdAt: 'asc' } })
  const busyIds = new Set((await db.trip.findMany({ where: { status: { in: ['assigned', 'in_progress'] } }, select: { driverId: true } })).map((t) => t.driverId))
  const driver2 = allDrivers.find((d, i) => i === 1 && !busyIds.has(d.id)) ?? allDrivers.find((d) => d.isActive && !busyIds.has(d.id))
  if (!vehicle || !driver2) {
    push('Назначение', false, 'Нет кандидатов (запустите пересев базы)')
    return log
  }
  const assign = await assignRequest(request.id, { vehicleId: vehicle!.id, driverId: driver2!.id }, 'Диспетчер Е. Крылова')
  push('Назначение', assign.ok, assign.ok ? `${request.number} → ${vehicle!.model} · ${vehicle!.plate}, ${driver2!.fullName}` : (assign.errors.join('; ') || 'отказ'))
  if (!assign.ok) return log

  // ACCEPT
  const accept = await driverAction({ orderId: request.number, action: 'ACCEPT' }, driver2!)
  push('Водитель: ACCEPT', accept.ok, accept.ok ? 'статус ACCEPTED' : accept.error)

  // 6 шагов фотофиксации
  const steps = ['veh_side', 'veh_front', 'veh_rear', 'order_docs', 'lic', 'passport']
  for (const s of steps) {
    const r = await driverAction({ orderId: request.number, action: 'PRETRIP_STEP', stepId: s }, driver2!)
    if (!r.ok) { push('Фотофиксация', false, `${s}: ${r.error}`); return log }
  }
  push('Фотофиксация', true, '6 из 6 шагов записаны')

  // START_ROUTE до осмотра → должен быть отклонён (на второй заявке не проверяем здесь;
  // проверка отказа выполняется сценарием приёмки вручную/через curl)
  const start = await driverAction({ orderId: request.number, action: 'START_ROUTE' }, driver2!)
  push('Старт маршрута', start.ok, start.ok ? 'TripEvent DEPARTURE, статус IN_PROGRESS' : start.error)
  if (!start.ok) return log

  // COMPLETE_TRIP
  const done = await driverAction({ orderId: request.number, action: 'COMPLETE_TRIP' }, driver2!)
  push('Завершение рейса', done.ok, done.ok ? 'TripEvent TRIP_DONE, интервалы закрыты, заявка DONE' : done.error)

  // Чат диспетчера
  if (done.ok) {
    const trip = await db.trip.findUnique({ where: { tripCode: request.number } })
    const msg = await withWriteLock(() =>
      db.$transaction(async (tx) => {
      const m = await tx.chatMessage.create({
        data: { driverId: driver2.id, tripId: trip?.id ?? null, sender: 'DISPATCHER', body: `Рейс ${request!.number} принят. Сформируйте закрывающие документы на выгрузке.` },
      })
      await journalWrite(tx, driver2.id, 'CHAT_MESSAGE', 'UPSERT', chatMessageSnapshot(m))
        await logEvent(tx, { user: 'Диспетчер Е. Крылова', action: 'CHAT_SEND', entity: 'ChatMessage', entityId: m.id })
        return m
      }, { timeout: 15000 }),
    )
    push('Чат', true, `Сообщение диспетчера в плане обмена (seq SyncJournal обновлён, id ${msg.id.slice(0, 8)}…)`)
  }
  return log
}

export async function resetAndSeed() {
  await seedAll(db)
}
```
```ts
// src/lib/db.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Мьютекс записи: платформа работает в одном процессе Node, поэтому
 * последовательное выполнение пишущих транзакций гарантирует атомарность
 * (аналог SELECT … FOR UPDATE для SQLite; PostgreSQL в контуре стенда — обычные блокировки).
 */
let writeChain: Promise<unknown> = Promise.resolve()

export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn)
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
```
```ts
// src/lib/epoch.ts
// Утилиты времени: контракты шины — epoch millis (Long)
export function toMillis(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null
}

export function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

export function haversineM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}
```
```ts
// src/lib/cors.ts
// CORS для интеграционных слоёв /api/1c/* и /api/driver/v1/*.
// Разрешённый источник приложения водителя — env DRIVER_APP_ORIGIN (в демо '*').
const allowOrigin =
  process.env.DRIVER_APP_ORIGIN && process.env.DRIVER_APP_ORIGIN.length > 0
    ? process.env.DRIVER_APP_ORIGIN
    : '*'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': allowOrigin,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Driver-Id',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store',
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders, ...headers },
  })
}

export function optionsOk(): Response {
  return new Response(null, { status: 204, headers: corsHeaders })
}

export const jsonOfficeHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

export function jsonOffice(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonOfficeHeaders })
}
```
```ts
// src/lib/photos.ts
// Хранение фото предрейсового осмотра: локальные файлы в uploads/, отдача через /api/office/files/…
// В журнал регистрации пишется только факт (PHOTO_VIEW), не содержимое (152-ФЗ, минимизация).
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

export async function savePhotoDataUrl(dataUrl: string): Promise<string | null> {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg')
  const name = `${randomUUID()}.${ext}`
  try {
    await mkdir(UPLOAD_DIR, { recursive: true })
    await writeFile(path.join(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'))
    return `/api/office/files/${name}`
  } catch {
    return null
  }
}

export function photoPath(name: string): string | null {
  if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(name)) return null
  return path.join(UPLOAD_DIR, name)
}
```
```ts
// src/lib/office/serialize.ts
// Сериализация данных для UI рабочих мест
import type { TransportRequest, Contractor, Location, Vehicle, Trailer, Driver, Trip, TripPoint, TripEvent, PreTripInspection, PreTripStep } from '@prisma/client'

export type RequestRow = {
  id: string
  number: string
  externalId: string
  createdAt: string
  status: string
  statusLabel: string
  contractor: { id: string; name: string }
  cargo: string
  weightT: number
  from: { id: string; name: string; address: string }
  to: { id: string; name: string; address: string }
  loadingAt: string
  unloadingWindow: string
  docs: string[]
  vehicle: { id: string; model: string; plate: string } | null
  trailer: { id: string; model: string; plate: string } | null
  driver: { id: string; fullName: string } | null
  assignedBy: string | null
  assignedAt: string | null
  closeReason: string | null
  trip: {
    id: string
    status: string
    lastEventType: string | null
    lastEventAt: string | null
    routeDistanceM: number | null
    routeDurationS: number | null
    points: { id: string; seqNo: number; kind: string; name: string | null; lat: number; lon: number }[]
    events: { id: string; type: string; occurredAt: string; source: string; intervalClosedAt: string | null }[]
  } | null
  pretrip: { done: number; total: number; steps: { stepId: string; at: string; photoUrl: string | null }[] } | null
}

export function requestRow(
  r: TransportRequest & {
    contractor: Contractor
    fromLocation: Location
    toLocation: Location
    vehicle?: Vehicle | null
    trailer?: Trailer | null
    driver?: Driver | null
    trip?: (Trip & { points: TripPoint[]; events: TripEvent[] }) | null
  },
  pretrip?: (PreTripInspection & { steps: PreTripStep[] }) | null,
): RequestRow {
  return {
    id: r.id,
    number: r.number,
    externalId: r.externalId,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
    statusLabel: r.status,
    contractor: { id: r.contractor.id, name: r.contractor.name },
    cargo: r.cargo,
    weightT: r.weightT,
    from: { id: r.fromLocation.id, name: r.fromLocation.name, address: r.fromLocation.address },
    to: { id: r.toLocation.id, name: r.toLocation.name, address: r.toLocation.address },
    loadingAt: r.loadingAt.toISOString(),
    unloadingWindow: r.unloadingWindow,
    docs: JSON.parse(r.docs) as string[],
    vehicle: r.vehicle ? { id: r.vehicle.id, model: r.vehicle.model, plate: r.vehicle.plate } : null,
    trailer: r.trailer ? { id: r.trailer.id, model: r.trailer.model, plate: r.trailer.plate } : null,
    driver: r.driver ? { id: r.driver.id, fullName: r.driver.fullName } : null,
    assignedBy: r.assignedBy,
    assignedAt: r.assignedAt?.toISOString() ?? null,
    closeReason: r.closeReason,
    trip: r.trip
      ? {
          id: r.trip.id,
          status: r.trip.status,
          lastEventType: r.trip.lastEventType,
          lastEventAt: r.trip.lastEventAt?.toISOString() ?? null,
          routeDistanceM: r.trip.routeDistanceM,
          routeDurationS: r.trip.routeDurationS,
          points: r.trip.points
            .sort((a, b) => a.seqNo - b.seqNo)
            .map((p) => ({ id: p.id, seqNo: p.seqNo, kind: p.kind, name: p.name, lat: p.lat, lon: p.lon })),
          events: r.trip.events
            .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
            .map((e) => ({ id: e.id, type: e.type, occurredAt: e.occurredAt.toISOString(), source: e.source, intervalClosedAt: e.intervalClosedAt?.toISOString() ?? null })),
        }
      : null,
    pretrip: pretrip
      ? {
          done: pretrip.steps.length,
          total: 6,
          steps: pretrip.steps
            .sort((a, b) => a.at.getTime() - b.at.getTime())
            .map((s) => ({ stepId: s.stepId, at: s.at.toISOString(), photoUrl: s.photoUrl })),
        }
      : { done: 0, total: 6, steps: [] },
  }
}
```
```ts
// src/lib/bus/syncWriter.ts
// SyncJournalWriter — запись в «план обмена»: личный журнал водителя.
// Каждая прикладная запись обязана попадать в SyncJournal, иначе клиент её не увидит.
import type { Prisma } from '@prisma/client'

export type SyncEntity = 'TRIP' | 'TRIP_POINT' | 'TRIP_EVENT' | 'CHAT_MESSAGE' | 'SYSTEM_NOTE'
export type SyncOp = 'UPSERT' | 'DELETE'

export async function journalWrite(
  tx: Prisma.TransactionClient,
  driverId: string,
  entity: SyncEntity,
  op: SyncOp,
  payload: unknown,
): Promise<void> {
  await tx.syncJournal.create({
    data: {
      driverId,
      entity,
      op,
      payload: JSON.stringify(payload),
    },
  })
}
```
```ts
// src/lib/bus/snapshots.ts
// Снимки сущностей для SyncJournal (план обмена) — формы полей 1:1 с SyncDtos каркаса
// приложения водителя: camelCase, время — epoch millis.
import { toMillis } from '../epoch'

export function tripSnapshot(t: {
  id: string
  tripCode: string
  status: string
  driverId: string | null
  vehicleId: string | null
  plannedStartAt: Date | null
  plannedFinishAt: Date | null
  routeGeoJson: string | null
  routeStepsJson: string | null
  routeDistanceM: number | null
  routeDurationS: number | null
  routeMinLat: number | null
  routeMinLon: number | null
  routeMaxLat: number | null
  routeMaxLon: number | null
  lastEventType: string | null
  lastEventAt: Date | null
}) {
  return {
    id: t.id,
    tripCode: t.tripCode,
    status: t.status,
    driverId: t.driverId,
    vehicleId: t.vehicleId,
    plannedStartAt: toMillis(t.plannedStartAt),
    plannedFinishAt: toMillis(t.plannedFinishAt),
    routeGeoJson: t.routeGeoJson,
    routeStepsJson: t.routeStepsJson,
    routeDistanceM: t.routeDistanceM,
    routeDurationS: t.routeDurationS,
    routeMinLat: t.routeMinLat,
    routeMinLon: t.routeMinLon,
    routeMaxLat: t.routeMaxLat,
    routeMaxLon: t.routeMaxLon,
    lastEventType: t.lastEventType,
    lastEventAt: toMillis(t.lastEventAt),
  }
}

export function tripPointSnapshot(p: {
  id: string
  tripId: string
  seqNo: number
  kind: string
  name: string | null
  address: string | null
  lat: number
  lon: number
  geofenceRadiusM: number
  plannedArrivalAt: Date | null
  plannedDepartureAt: Date | null
}) {
  return {
    id: p.id,
    tripId: p.tripId,
    seqNo: p.seqNo,
    kind: p.kind,
    name: p.name,
    address: p.address,
    lat: p.lat,
    lon: p.lon,
    geofenceRadiusM: p.geofenceRadiusM,
    plannedArrivalAt: toMillis(p.plannedArrivalAt),
    plannedDepartureAt: toMillis(p.plannedDepartureAt),
  }
}

export function tripEventSnapshot(e: {
  id: string
  tripId: string
  tripPointId: string | null
  driverId: string
  vehicleId: string
  deviceId: string | null
  type: string
  occurredAt: Date
  source: string
  lat: number | null
  lon: number | null
  note: string | null
  intervalClosedAt: Date | null
  intervalClosedBy: string | null
  intervalAutoClosed: boolean | null
  correctionOf: string | null
  editedAt: Date | null
  createdAt: Date
}) {
  return {
    id: e.id,
    tripId: e.tripId,
    tripPointId: e.tripPointId,
    driverId: e.driverId,
    vehicleId: e.vehicleId,
    deviceId: e.deviceId,
    type: e.type,
    occurredAt: e.occurredAt.getTime(),
    source: e.source,
    lat: e.lat,
    lon: e.lon,
    note: e.note,
    intervalClosedAt: toMillis(e.intervalClosedAt),
    intervalClosedBy: e.intervalClosedBy,
    intervalAutoClosed: e.intervalAutoClosed,
    correctionOf: e.correctionOf,
    editedAt: toMillis(e.editedAt),
    createdAt: e.createdAt.getTime(),
  }
}

export function chatMessageSnapshot(m: {
  id: string
  driverId: string
  tripId: string | null
  sender: string
  body: string
  createdAt: Date
}) {
  return {
    id: m.id,
    driverId: m.driverId,
    tripId: m.tripId,
    sender: m.sender,
    body: m.body,
    createdAt: m.createdAt.getTime(),
  }
}

export function systemNoteSnapshot(n: {
  id: string
  driverId: string
  kind: string
  body: string
  ref: string | null
  createdAt: Date
  readAt: Date | null
}) {
  return {
    id: n.id,
    driverId: n.driverId,
    kind: n.kind,
    body: n.body,
    ref: n.ref,
    createdAt: n.createdAt.getTime(),
    readAt: toMillis(n.readAt),
  }
}
```
```ts
// src/lib/bus/appliers.ts
// Appliers push-операций (протокол синхронизации, раздел 6.3 ТЗ):
// TRIP_EVENT_CREATE | MARK_PUBLISH | MARK_VOTE | CHAT_SEND | NOTE_READ.
// Идемпотентность: opId хранится в SyncOperation; повторная доставка даёт тот же результат.
// REJECTED финален — rejectReason показывается водителю.
import { randomUUID } from 'crypto'
import { db, withWriteLock } from '../db'
import { applyTripEvent } from '../1c/tripEvents'
import { journalWrite } from './syncWriter'
import { chatMessageSnapshot, systemNoteSnapshot } from './snapshots'

export type PushOperation = { opId: string; type: string; payload: Record<string, unknown> }
export type PushResult = { opId: string; status: 'APPLIED' | 'DUPLICATE' | 'REJECTED'; rejectReason?: string }

const MARK_CATEGORIES = ['POTHOLE', 'ROADWORKS', 'POLICE', 'ACCIDENT', 'CLOSED']
const MARK_TTL = [6, 12, 720]
const MAX_MARKS_PER_HOUR = 5

type TripEventPayload = {
  id?: string
  tripId: string
  tripPointId?: string | null
  vehicleId?: string | null
  deviceId?: string | null
  type: string
  occurredAt?: number | null
  source?: string | null
  lat?: number | null
  lon?: number | null
  note?: string | null
}

export async function applyOperations(
  driverId: string,
  deviceId: string | null,
  operations: PushOperation[],
): Promise<PushResult[]> {
  const results: PushResult[] = []
  for (const op of operations) {
    const result = await applyOperation(driverId, deviceId, op)
    results.push(result)
  }
  return results
}

async function applyOperation(driverId: string, deviceId: string | null, op: PushOperation): Promise<PushResult> {
  if (!op.opId || typeof op.opId !== 'string' || !op.type) {
    return { opId: String(op.opId ?? randomUUID()), status: 'REJECTED', rejectReason: 'BAD_OPERATION' }
  }

  // идемпотентность: уже известная операция возвращает сохранённый результат
  const existing = await db.syncOperation.findUnique({ where: { opId: op.opId } })
  if (existing && existing.state !== 'PENDING') {
    return existing.state === 'REJECTED'
      ? { opId: op.opId, status: 'REJECTED', rejectReason: existing.rejectReason ?? undefined }
      : { opId: op.opId, status: existing.state as 'APPLIED' | 'DUPLICATE' }
  }

  const reject = async (reason: string) => {
    await db.syncOperation.upsert({
      where: { opId: op.opId },
      create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'REJECTED', rejectReason: reason, attempts: 1, syncedAt: new Date() },
      update: { state: 'REJECTED', rejectReason: reason, attempts: { increment: 1 }, syncedAt: new Date() },
    })
    return { opId: op.opId, status: 'REJECTED' as const, rejectReason: reason }
  }

  try {
    switch (op.type) {
      case 'TRIP_EVENT_CREATE': {
        const p = op.payload as unknown as TripEventPayload
        const trip = await db.trip.findUnique({ where: { id: p.tripId } })
        if (!trip) return await reject('TRIP_NOT_FOUND')
        if (trip.driverId !== driverId) return await reject('TRIP_NOT_OWNED')
        if (trip.status === 'completed' || trip.status === 'cancelled') return await reject('TRIP_CLOSED')
        await withWriteLock(() =>
        db.$transaction(async (tx) => {
          await applyTripEvent(tx, {
            tripId: p.tripId,
            type: p.type,
            driverId,
            vehicleId: p.vehicleId ?? trip.vehicleId ?? '',
            tripPointId: p.tripPointId ?? null,
            deviceId: p.deviceId ?? deviceId,
            source: (p.source as 'GEOFENCE' | 'MANUAL' | 'MANUAL_BACKDATED') ?? 'MANUAL',
            occurredAt: p.occurredAt ? new Date(p.occurredAt) : undefined,
            lat: p.lat ?? null,
            lon: p.lon ?? null,
            note: p.note ?? null,
          })
          await tx.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'APPLIED', attempts: 1, syncedAt: new Date() },
            update: { state: 'APPLIED', attempts: { increment: 1 }, syncedAt: new Date() },
          })
        }, { timeout: 15000 }),
        )
        return { opId: op.opId, status: 'APPLIED' }
      }

      case 'MARK_PUBLISH': {
        // rate limit: не более MAX_MARKS_PER_HOUR публикаций в час
        const since = new Date(Date.now() - 3600 * 1000)
        const recent = await db.markPublicationLog.count({ where: { driverId, publishedAt: { gte: since } } })
        if (recent >= MAX_MARKS_PER_HOUR) return await reject('RATE_LIMIT')
        const p = op.payload as {
          category?: string
          geometry?: string | { type: string; coordinates: [number, number][] }
          polylineGeoJson?: string
          comment?: string | null
          ttlHours?: number
        }
        if (!p.category || !MARK_CATEGORIES.includes(p.category)) return await reject('BAD_CATEGORY')
        const ttl = MARK_TTL.includes(p.ttlHours ?? -1) ? p.ttlHours! : 6
        const geo = typeof p.geometry === 'string' ? JSON.parse(p.geometry) : p.geometry ?? (p.polylineGeoJson ? JSON.parse(p.polylineGeoJson) : null)
        if (!geo || !Array.isArray(geo.coordinates) || geo.coordinates.length < 2) return await reject('BAD_GEOMETRY')
        const lats = geo.coordinates.map((c: [number, number]) => c[1])
        const lons = geo.coordinates.map((c: [number, number]) => c[0])
        const now = new Date()
        await withWriteLock(() =>
        db.$transaction(async (tx) => {
          await tx.roadMark.create({
            data: {
              id: (p as { id?: string }).id ?? randomUUID(),
              category: p.category!,
              polylineGeoJson: JSON.stringify(geo),
              comment: p.comment ?? null,
              ttlHours: ttl,
              createdAt: now,
              expiresAt: new Date(now.getTime() + ttl * 3600 * 1000),
              minLat: Math.min(...lats), minLon: Math.min(...lons),
              maxLat: Math.max(...lats), maxLon: Math.max(...lons),
            },
          })
          await tx.markPublicationLog.create({ data: { driverId, publishedAt: now } })
          await tx.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'APPLIED', attempts: 1, syncedAt: now },
            update: { state: 'APPLIED', attempts: { increment: 1 }, syncedAt: now },
          })
        }, { timeout: 15000 }),
        )
        return { opId: op.opId, status: 'APPLIED' }
      }

      case 'MARK_VOTE': {
        const p = op.payload as { markId?: string; vote?: number }
        if (!p.markId || (p.vote !== 1 && p.vote !== -1)) return await reject('BAD_VOTE')
        const mark = await db.roadMark.findUnique({ where: { id: p.markId } })
        if (!mark) return await reject('MARK_NOT_FOUND')
        if (mark.expiresAt.getTime() <= Date.now()) return await reject('MARK_EXPIRED')
        const vote = await db.markVote.upsert({
          where: { markId_voterDriverId: { markId: p.markId, voterDriverId: driverId } },
          create: { markId: p.markId, voterDriverId: driverId, vote: p.vote },
          update: { vote: p.vote },
        })
        const agg = await db.markVote.groupBy({ by: ['vote'], where: { markId: p.markId }, _count: { vote: true } })
        const confirm = agg.find((a) => a.vote === 1)?._count.vote ?? 0
        const outdated = agg.find((a) => a.vote === -1)?._count.vote ?? 0
        await withWriteLock(() =>
        db.$transaction(async (tx) => {
          await tx.roadMark.update({ where: { id: p.markId! }, data: { confirmCount: confirm, outdatedCount: outdated } })
          await tx.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'APPLIED', attempts: 1, syncedAt: new Date() },
            update: { state: 'APPLIED', attempts: { increment: 1 }, syncedAt: new Date() },
          })
        }, { timeout: 15000 }),
        )
        return { opId: op.opId, status: 'APPLIED' }
      }

      case 'CHAT_SEND': {
        const p = op.payload as { body?: string; tripId?: string | null; id?: string }
        if (!p.body || typeof p.body !== 'string' || p.body.trim().length === 0) return await reject('EMPTY_BODY')
        const duplicate = await db.chatMessage.findUnique({ where: { id: p.id ?? '' } })
        if (duplicate) {
          await db.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'DUPLICATE', attempts: 1, syncedAt: new Date() },
            update: { state: 'DUPLICATE', attempts: { increment: 1 }, syncedAt: new Date() },
          })
          return { opId: op.opId, status: 'DUPLICATE' }
        }
        const msg = await withWriteLock(() =>
        db.$transaction(async (tx) => {
          const m = await tx.chatMessage.create({
            data: {
              id: p.id ?? randomUUID(),
              driverId,
              tripId: p.tripId ?? null,
              sender: 'DRIVER',
              body: p.body!.trim(),
            },
          })
          await journalWrite(tx, driverId, 'CHAT_MESSAGE', 'UPSERT', chatMessageSnapshot(m))
          await tx.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'APPLIED', attempts: 1, syncedAt: new Date() },
            update: { state: 'APPLIED', attempts: { increment: 1 }, syncedAt: new Date() },
          })
          return m
        }, { timeout: 15000 }),
        )
        return { opId: op.opId, status: 'APPLIED' }
      }

      case 'NOTE_READ': {
        const p = op.payload as { id?: string }
        const note = p.id ? await db.systemNote.findUnique({ where: { id: p.id } }) : null
        if (!note || note.driverId !== driverId) return await reject('NOTE_NOT_FOUND')
        if (note.readAt) {
          await db.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'DUPLICATE', attempts: 1, syncedAt: new Date() },
            update: { state: 'DUPLICATE', attempts: { increment: 1 }, syncedAt: new Date() },
          })
          return { opId: op.opId, status: 'DUPLICATE' }
        }
        await withWriteLock(() =>
        db.$transaction(async (tx) => {
          const updated = await tx.systemNote.update({ where: { id: note.id }, data: { readAt: new Date() } })
          await journalWrite(tx, driverId, 'SYSTEM_NOTE', 'UPSERT', systemNoteSnapshot(updated))
          await tx.syncOperation.upsert({
            where: { opId: op.opId },
            create: { opId: op.opId, driverId, type: op.type, payload: JSON.stringify(op.payload), state: 'APPLIED', attempts: 1, syncedAt: new Date() },
            update: { state: 'APPLIED', attempts: { increment: 1 }, syncedAt: new Date() },
          })
        }, { timeout: 15000 }),
        )
        return { opId: op.opId, status: 'APPLIED' }
      }

      default:
        return await reject('UNKNOWN_TYPE')
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'INTERNAL'
    return await reject(message.slice(0, 120))
  }
}
```
```ts
// src/lib/bus/traffic.ts
// Демо-генератор пробок: правдоподобные сегменты на дорогах Краснодарского края.
import { randomUUID } from 'crypto'
import { db } from '../db'

const ROADS = [
  { title: 'А-146 · Гайдук — Крымск', points: [[37.78, 44.70], [37.85, 44.74], [37.92, 44.78], [38.00, 44.82]] },
  { title: 'А-146 · Абинск — Крымск', points: [[38.16, 44.87], [38.05, 44.84], [37.95, 44.80]] },
  { title: 'М-4 «Дон» · Северный обход Краснодара', points: [[38.90, 45.08], [38.97, 45.05], [39.05, 45.03]] },
  { title: 'А-160 · Новороссийск — Керчь', points: [[37.77, 44.69], [37.70, 44.72], [37.63, 44.75]] },
  { title: 'Р-217 «Кавказ» · Тимашевск', points: [[38.93, 45.61], [38.99, 45.58], [39.05, 45.55]] },
  { title: 'М-4 «Дон» · Ростов — Самара (Кущёвка)', points: [[39.60, 46.60], [39.68, 46.57], [39.75, 46.54]] },
  { title: 'А-290 · Новороссийск — Джубга', points: [[37.78, 44.66], [37.86, 44.61], [37.95, 44.55]] },
  { title: 'Краснодар · ул. Российская', points: [[38.96, 45.04], [38.98, 45.02], [39.00, 45.00]] },
]

export async function refreshTraffic() {
  const chosen = [...ROADS].sort(() => Math.random() - 0.5).slice(0, 5 + Math.floor(Math.random() * 4))
  const rows = chosen.map((r, i) => {
    const level = 1 + Math.floor(Math.random() * 10)
    return {
      id: `osm:way:${1000 + i}:${Math.floor(Math.random() * 9)}`,
      title: r.title,
      geometry: JSON.stringify({ type: 'LineString', coordinates: r.points.map(([lon, lat]) => [lon, lat]) }),
      level,
      speedKmh: Math.max(8, 90 - level * 8),
      onRoute: Math.random() > 0.4,
    }
  })
  await db.$transaction(async (tx) => {
    await tx.trafficSegment.deleteMany()
    await tx.trafficSegment.createMany({ data: rows })
  })
  return rows
}

export function segmentBbox(geometry: string): { minLat: number; minLon: number; maxLat: number; maxLon: number } {
  const g = JSON.parse(geometry) as { coordinates: [number, number][] }
  const lats = g.coordinates.map((c) => c[1])
  const lons = g.coordinates.map((c) => c[0])
  return { minLat: Math.min(...lats), minLon: Math.min(...lons), maxLat: Math.max(...lats), maxLon: Math.max(...lons) }
}

export function newMarkId(): string {
  return randomUUID()
}
```

## ЧАСТЬ 3 — API-КОНТРАКТЫ (все маршруты, файлы целиком + живые примеры)

Все примеры ниже — реальные запросы/ответы, захваченные curl-прогонами 2026-11-11 в этой сессии против `http://localhost:3000` на свежем сиде. Служебное: CORS-заголовки на `/api/1c/*` и `/api/driver/v1/*` — `Access-Control-Allow-Origin: $DRIVER_APP_ORIGIN` (демо `*`), `Access-Control-Allow-Headers: Content-Type, X-Driver-Id`, `OPTIONS` → 204.

### 3.1 HTTP-сервис «1С»: /api/1c/orders (GET/POST)

```ts
// src/app/api/1c/orders/route.ts
// HTTP-сервис «1С»: get_driver_orders — зеркалит контракт, который уже потребляет приложение водителя.
// GET  → список заявок водителя (формат 6.1 ТЗ, поле-в-поле)
// POST → обратный канал действий водителя (ACCEPT | PRETRIP_STEP | START_ROUTE | COMPLETE_TRIP)
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'
import { mapOrderStatus } from '@/lib/1c/statuses'
import { driverAction } from '@/lib/1c/driverActions'

export const dynamic = 'force-dynamic'

async function resolveDriver(req: Request) {
  const key = req.headers.get('x-driver-id')?.trim()
  if (key) {
    // X-Driver-Id — appId приложения водителя; на стенде допускается и id записи
    const byApp = await db.driver.findUnique({ where: { appId: key } })
    if (byApp) return byApp
    const byId = await db.driver.findUnique({ where: { id: key } })
    if (byId) return byId
  }
  // в демо-режиме заголовок необязателен: подставляется демо-водитель
  return db.driver.findUnique({ where: { appId: 'd1111111-1111-4111-8111-111111111111' } })
}



function vehicleLabel(v: { model: string; plate: string } | null): string {
  return v ? `${v.model} · ${v.plate}` : '—'
}

export async function GET(req: Request) {
  const driver = await resolveDriver(req)
  if (!driver) return json({ ok: false, error: 'Водитель не найден' }, 404)

  const active = await db.transportRequest.findMany({
    where: {
      OR: [
        { driverId: driver.id, status: { in: ['ASSIGNED', 'ACCEPTED', 'PRETRIP', 'IN_PROGRESS'] } },
        { driverId: null, status: 'DISPATCH' },
      ],
    },
    include: {
      contractor: true, fromLocation: true, toLocation: true, vehicle: true, trailer: true,
      trip: { select: { routeDistanceM: true, routeDurationS: true } },
    },
    orderBy: { loadingAt: 'asc' },
  })
  const done = await db.transportRequest.findMany({
    where: { driverId: driver.id, status: 'DONE' },
    include: {
      contractor: true, fromLocation: true, toLocation: true, vehicle: true, trailer: true,
      trip: { select: { routeDistanceM: true, routeDurationS: true } },
    },
    orderBy: { assignedAt: 'desc' },
    take: 3,
  })

  const orders = [...active, ...done].map((r) => ({
    number: r.number,
    externalId: r.externalId,
    client: r.contractor.name,
    cargo: r.cargo,
    weightT: r.weightT,
    fromLabel: r.fromLocation.name,
    toLabel: r.toLocation.name,
    loadingAt: r.loadingAt.toISOString(),
    unloadingWindow: r.unloadingWindow,
    vehicle: vehicleLabel(r.vehicle),
    trailer: vehicleLabel(r.trailer),
    docs: JSON.parse(r.docs) as string[],
    distanceKm: r.trip?.routeDistanceM ? Math.round(r.trip.routeDistanceM / 1000) : 0,
    durationMin: r.trip?.routeDurationS ? Math.round(r.trip.routeDurationS / 60) : 0,
    status: mapOrderStatus(r.status) ?? 'ASSIGNED',
    assignedBy: r.assignedBy ?? '—',
  }))

  // eventLog — журнал действий водителя: из регистра статусов и шагов фотофиксации
  type Entry = { at: string; orderId: string; action: string }
  const log: Entry[] = []
  const statuses = await db.statusHistory.findMany({
    where: { actor: `driver:${driver.id}` },
    include: { request: { select: { number: true } } },
    orderBy: { at: 'desc' },
    take: 60,
  })
  const statusToAction: Record<string, string> = {
    ACCEPTED: 'ACCEPT',
    PRETRIP: 'PRETRIP_STEP',
    IN_PROGRESS: 'START_ROUTE',
    DONE: 'COMPLETE_TRIP',
  }
  for (const s of statuses) {
    const action = statusToAction[s.toStatus]
    if (action && s.request) log.push({ at: s.at.toISOString(), orderId: s.request.number, action })
  }
  const steps = await db.preTripStep.findMany({
    where: { inspection: { driverId: driver.id } },
    include: { inspection: { include: { request: { select: { number: true } } } } },
    orderBy: { at: 'desc' },
    take: 30,
  })
  for (const s of steps) {
    if (s.inspection.request)
      log.push({ at: s.at.toISOString(), orderId: s.inspection.request.number, action: `PRETRIP_STEP:${s.stepId}` })
  }
  const eventLog = log.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50)

  return json({
    source: '1c-stand',
    note: 'Эмулятор 1С: список заявок водителя',
    orders,
    eventLog,
  })
}

export async function POST(req: Request) {
  const driver = await resolveDriver(req)
  let body: { orderId?: string; action?: string; stepId?: string; at?: string; photoDataUrl?: string | null }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Некорректное тело запроса (ожидается JSON)' }, 400)
  }
  if (!body?.orderId || !body?.action)
    return json({ ok: false, error: 'Обязательны поля orderId и action' }, 400)

  const result = await driverAction(
    {
      orderId: body.orderId,
      action: body.action,
      stepId: body.stepId ?? null,
      at: body.at ?? null,
      photoDataUrl: body.photoDataUrl ?? null,
    },
    driver ? { id: driver.id, fullName: driver.fullName } : null,
  )
  if (!result.ok) return json({ ok: false, error: result.error }, result.code)
  return json(result)
}

export async function OPTIONS() {
  return optionsOk()
}
```

Живой пример GET:

```
$ curl -H 'X-Driver-Id: d1111111-1111-4111-8111-111111111111' http://localhost:3000/api/1c/orders
→ 200
{"source":"1c-stand","note":"Эмулятор 1С: список заявок водителя","orders":[{ "number":"ЗК-2026/1067",
"externalId":"71e4f16f-2ca6-484f-8dd6-62540f21b0d6","client":"ООО «Новороссийский терминал»",
"cargo":"Металлоконструкции (фермы), штучные","weightT":18.5,"fromLabel":"Абинск, пл. АЗМЗ",
"toLabel":"Новороссийск, причал 27","loadingAt":"2026-11-12T06:30:00.000Z","unloadingWindow":"сегодня 14:00–16:00",
"vehicle":"МАЗ 5440 · А 123 БС 23","trailer":"НЕФАЗ 93341 · АВ 456 23",
"docs":["ТТН (2 экз.)","Паспорт груза","Пропуск на терминал","Акт допуска ТС"],
"distanceKm":115,"durationMin":150,"status":"ASSIGNED","assignedBy":"Диспетчер Е. Крылова"}, …],
"eventLog":[]} // всего orders=3 на чистом сиде
```

Живой пример POST (запрещённое действие — контроль обратного канала):

```
$ curl -X POST http://localhost:3000/api/1c/orders -H 'Content-Type: application/json' \
  -H 'X-Driver-Id: d1111111-1111-4111-8111-111111111111' -d '{"orderId":"ЗК-2026/1071","action":"ASSIGN"}'
→ 400 {"ok":false,"error":"Действие ASSIGN в обратном канале запрещено — назначение выполняет только диспетчер"}
```

Живой пример POST (отказ старта до осмотра — 409, шаг 7а приёмки):

```
$ curl -X POST … -d '{"orderId":"ЗК-2026/1071","action":"START_ROUTE"}'  (после 1-го шага осмотра)
→ 409 {"ok":false,"error":"Предрейсовый осмотр не завершён. Не хватает шагов: veh_front, veh_rear, order_docs, lic, passport"}
```

### 3.2 Шина: /api/driver/v1/sync/pull (GET)

```ts
// src/app/api/driver/v1/sync/pull/route.ts
// Шина приложения: дельта личного журнала водителя (план обмена)
// GET /api/driver/v1/sync/pull?cursor=0&limit=500 → entries(seq, entity, op, payload) + cursor + hasMore
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'

export const dynamic = 'force-dynamic'

async function resolveDriver(req: Request) {
  const key = req.headers.get('x-driver-id')?.trim()
  if (key) {
    // X-Driver-Id — appId приложения водителя; на стенде допускается и id записи
    const byApp = await db.driver.findUnique({ where: { appId: key } })
    if (byApp) return byApp
    const byId = await db.driver.findUnique({ where: { id: key } })
    if (byId) return byId
  }
  // в демо-режиме заголовок необязателен: подставляется демо-водитель
  return db.driver.findUnique({ where: { appId: 'd1111111-1111-4111-8111-111111111111' } })
}



export async function GET(req: Request) {
  const driver = await resolveDriver(req)
  if (!driver) return json({ ok: false, error: 'Водитель не найден (заголовок X-Driver-Id)' }, 404)

  const url = new URL(req.url)
  const cursor = Math.max(0, parseInt(url.searchParams.get('cursor') ?? '0', 10) || 0)
  const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get('limit') ?? '500', 10) || 500))

  const rows = await db.syncJournal.findMany({
    where: { driverId: driver.id, seq: { gt: cursor } },
    orderBy: { seq: 'asc' },
    take: limit + 1,
  })
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  const entries = page.map((r) => ({
    seq: r.seq,
    entity: r.entity,
    op: r.op,
    payload: JSON.parse(r.payload) as Record<string, unknown>,
  }))
  const lastSeq = page.length > 0 ? page[page.length - 1].seq : cursor

  return json({ entries, cursor: lastSeq, hasMore })
}

export async function OPTIONS() {
  return optionsOk()
}
```

Живой пример (демо-водитель, свежий сид):

```
$ curl -H 'X-Driver-Id: <id-Иванова>' 'http://localhost:3000/api/driver/v1/sync/pull?cursor=0'
→ 200
{"entries":[
 {"seq":262,"entity":"TRIP","op":"UPSERT","payload":{"id":"5f5c38cc-…","tripCode":"ЗК-2026/1067","status":"assigned",
  "driverId":"4f64a559-…","vehicleId":"e9728a1b-…","plannedStartAt":1794465000000,"plannedFinishAt":1794474000000,
  "routeGeoJson":"{\"type\":\"LineString\",\"coordinates\":[[38.158,44.868],…]}","routeStepsJson":null,
  "routeDistanceM":115000,"routeDurationS":9000,…}},
 {"seq":263,"entity":"TRIP_POINT","op":"UPSERT","payload":{…seqNo:1, kind:"loading", lat:44.868, lon:38.158,…}},
 {"seq":264,"entity":"TRIP_POINT","op":"UPSERT","payload":{…seqNo:2, kind:"unloading", lat:44.685, lon:37.775,…}},
 {"seq":265,"entity":"SYSTEM_NOTE","op":"UPSERT","payload":{…kind:"ORDER_ASSIGNED", body:"Вам назначена заявка ЗК-2026/1067…"}},
 {"seq":266,"entity":"CHAT_MESSAGE","op":"UPSERT","payload":{…sender:"DISPATCHER","body":"Добрый день, Сергей!…"}},
 {"seq":267,"entity":"CHAT_MESSAGE","op":"UPSERT","payload":{…sender:"DRIVER","body":"Принял, добрый день.…"}}],
"cursor":267,"hasMore":false}
```

### 3.3 Шина: /api/driver/v1/sync/push (POST)

```ts
// src/app/api/driver/v1/sync/push/route.ts
// Шина приложения: push-операции водителя
// POST /api/driver/v1/sync/push { deviceId, operations: [{ opId, type, payload }] }
// → { results: [{ opId, status, rejectReason? }] }
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'
import { applyOperations, type PushOperation } from '@/lib/bus/appliers'

export const dynamic = 'force-dynamic'

async function resolveDriver(req: Request) {
  const key = req.headers.get('x-driver-id')?.trim()
  if (key) {
    // X-Driver-Id — appId приложения водителя; на стенде допускается и id записи
    const byApp = await db.driver.findUnique({ where: { appId: key } })
    if (byApp) return byApp
    const byId = await db.driver.findUnique({ where: { id: key } })
    if (byId) return byId
  }
  // в демо-режиме заголовок необязателен: подставляется демо-водитель
  return db.driver.findUnique({ where: { appId: 'd1111111-1111-4111-8111-111111111111' } })
}



export async function POST(req: Request) {
  const driver = await resolveDriver(req)
  if (!driver) return json({ ok: false, error: 'Водитель не найден (заголовок X-Driver-Id)' }, 404)

  let body: { deviceId?: string | null; operations?: PushOperation[] }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Некорректное тело запроса (ожидается JSON)' }, 400)
  }
  if (!Array.isArray(body?.operations))
    return json({ ok: false, error: 'Ожидается массив operations' }, 400)

  const results = await applyOperations(driver.id, body.deviceId ?? null, body.operations!)
  return json({ results })
}

export async function OPTIONS() {
  return optionsOk()
}
```

Живой пример (MARK_PUBLISH + повтор того же opId):

```
$ curl -X POST http://localhost:3000/api/driver/v1/sync/push -H 'Content-Type: application/json' \
  -H 'X-Driver-Id: d1111111-1111-4111-8111-111111111111' -d '{"deviceId":"handoff-device","operations":[
    {"opId":"handoff-demo-op-0001","type":"MARK_PUBLISH","payload":{"category":"POTHOLE",
     "geometry":{"type":"LineString","coordinates":[[37.78,44.7],[37.8,44.71],[37.82,44.72]]},
     "comment":"Яма у поворота (проверка handoff)","ttlHours":6}}]}'
→ 200 {"results":[{"opId":"handoff-demo-op-0001","status":"APPLIED"}]}
// повтор того же opId → 200 {"results":[{"opId":"handoff-demo-op-0001","status":"APPLIED"}]} (идемпотентно)
// далее GET /api/driver/v1/sync/marks → marks=1 (пометка видна в снимке)
```

Семантика apply — `src/lib/bus/appliers.ts` (целиком в Части 2): `APPLIED` — применено; повтор `opId` возвращает сохранённый результат (для MARK_PUBLISH это снова `APPLIED` — «тот же результат»; для CHAT_SEND с существующим id и NOTE_READ — `DUPLICATE`); `REJECTED` — финален, `rejectReason` из множества: BAD_OPERATION, TRIP_NOT_FOUND, TRIP_NOT_OWNED, TRIP_CLOSED, RATE_LIMIT, BAD_CATEGORY, BAD_GEOMETRY, BAD_VOTE, MARK_NOT_FOUND, MARK_EXPIRED, EMPTY_BODY, NOTE_NOT_FOUND, UNKNOWN_TYPE.

### 3.4 Шина: /api/driver/v1/sync/marks (GET)

```ts
// src/app/api/driver/v1/sync/marks/route.ts
// Шина приложения: снимок активных пометок «водители для водителей» по bbox
// GET /api/driver/v1/sync/marks?minLat&minLon&maxLat&maxLon&since → { snapshotAt, marks }
// Автор пометки не хранится (152-ФЗ, минимизация) — наследие каркаса.
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const minLat = num(url.searchParams.get('minLat'))
  const minLon = num(url.searchParams.get('minLon'))
  const maxLat = num(url.searchParams.get('maxLat'))
  const maxLon = num(url.searchParams.get('maxLon'))
  const since = num(url.searchParams.get('since'))

  const marks = await db.roadMark.findMany({
    where: {
      expiresAt: { gt: new Date() },
      ...(since ? { updatedAt: { gt: new Date(since) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })
  const filtered = marks.filter((m) => {
    if (minLat === undefined && maxLat === undefined && minLon === undefined && maxLon === undefined) return true
    // пересечение bbox пометки с запрошенным bbox
    if (minLat !== undefined && m.maxLat < minLat) return false
    if (maxLat !== undefined && m.minLat > maxLat) return false
    if (minLon !== undefined && m.maxLon < minLon) return false
    if (maxLon !== undefined && m.minLon > maxLon) return false
    return true
  })

  return json({
    snapshotAt: Date.now(),
    marks: filtered.map((m) => ({
      id: m.id,
      category: m.category,
      geometry: m.polylineGeoJson,
      comment: m.comment,
      ttlHours: m.ttlHours,
      confirmCount: m.confirmCount,
      outdatedCount: m.outdatedCount,
      createdAt: m.createdAt.getTime(),
      expiresAt: m.expiresAt.getTime(),
    })),
  })
}

function num(v: string | null): number | undefined {
  if (v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export async function OPTIONS() {
  return optionsOk()
}
```

Живой пример:

```
$ curl 'http://localhost:3000/api/driver/v1/sync/marks'   (после публикации из примера push)
→ 200 {"snapshotAt":1794402408368,"marks":[{"id":"f9086a4b-…","category":"POTHOLE",
"geometry":"{\"type\":\"LineString\",…}","comment":"Яма у поворота (проверка handoff)",
"ttlHours":6,"confirmCount":0,"outdatedCount":0,"createdAt":1794402408…,"expiresAt":1794424008…}]}
// на чистом сиде marks=0
```

### 3.5 Шина: /api/driver/v1/traffic (GET)

```ts
// src/app/api/driver/v1/traffic/route.ts
// Шина приложения: снимок пробок по bbox (в демо — генератор правдоподобных сегментов)
// GET /api/driver/v1/traffic?minLat&minLon&maxLat&maxLon&since → { snapshotAt, segments }
import { db } from '@/lib/db'
import { json, optionsOk } from '@/lib/cors'
import { refreshTraffic, segmentBbox } from '@/lib/bus/traffic'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const minLat = num(url.searchParams.get('minLat'))
  const minLon = num(url.searchParams.get('minLon'))
  const maxLat = num(url.searchParams.get('maxLat'))
  const maxLon = num(url.searchParams.get('maxLon'))
  const since = num(url.searchParams.get('since'))

  // если есть свежий снимок (моложе 60 c) — отдаём его, иначе перегенерируем
  let segments = await db.trafficSegment.findMany()
  const stale = since === undefined || segments.length === 0 || segments.some((s) => s.updatedAt.getTime() < (since ?? 0)) || segments.some((s) => Date.now() - s.updatedAt.getTime() > 60_000)
  if (stale) {
    const rows = await refreshTraffic()
    segments = rows.map((r) => ({ ...r, updatedAt: new Date() })) as typeof segments
  }

  const filtered = segments
    .filter((s) => {
      if (minLat === undefined && maxLat === undefined && minLon === undefined && maxLon === undefined) return true
      const b = segmentBbox(s.geometry)
      if (minLat !== undefined && b.maxLat < minLat) return false
      if (maxLat !== undefined && b.minLat > maxLat) return false
      if (minLon !== undefined && b.maxLon < minLon) return false
      if (maxLon !== undefined && b.minLon > maxLon) return false
      return true
    })
    .map((s) => ({
      id: s.id,
      title: s.title,
      geometry: s.geometry,
      level: s.level,
      speedKmh: s.speedKmh,
      onRoute: s.onRoute,
      updatedAt: s.updatedAt.getTime(),
    }))

  return json({ snapshotAt: Date.now(), segments: filtered })
}

function num(v: string | null): number | undefined {
  if (v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export async function OPTIONS() {
  return optionsOk()
}
```

Живой пример:

```
$ curl 'http://localhost:3000/api/driver/v1/traffic'
→ 200 {"snapshotAt":1794402408276,"segments":[{"id":"osm:way:1000:3","title":"А-146 · Гайдук — Крымск",
"geometry":"{\"type\":\"LineString\",…}","level":7,"speedKmh":34,"onRoute":true,"updatedAt":…}, …]}
// сегментов 5–8, демо-генератор перегенерирует при снимке старше 60 с
```

### 3.6 Офис: /api/office/requests (GET/POST)

```ts
// src/app/api/office/requests/route.ts
// API рабочего места «Заявки»: список с фильтром по статусу + создание заявки (сбыт)
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { createRequest, listRequests } from '@/lib/1c/requests'
import { requestRow } from '@/lib/office/serialize'
import { statusCounts } from '@/lib/1c/statusCounts'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? undefined
  const rows = await listRequests(status && status !== 'ALL' ? status : undefined)
  const inspections = await db.preTripInspection.findMany({ include: { steps: true } })
  const byRequest = new Map(inspections.map((i) => [i.requestId, i]))
  return jsonOffice({
    requests: rows.map((r) => requestRow(r, byRequest.get(r.id) ?? null)),
    counts: await statusCounts(),
  })
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }
  const required = ['contractorId', 'cargo', 'weightT', 'fromLocationId', 'toLocationId', 'loadingAt'] as const
  const missing = required.filter((k) => !body[k])
  if (missing.length > 0)
    return jsonOffice({ ok: false, error: `Не заполнены обязательные поля: ${missing.join(', ')}` }, 400)

  const docs = Array.isArray(body.docs) ? (body.docs as string[]) : typeof body.docs === 'string' && body.docs.trim() ? (body.docs as string).split(',').map((s) => s.trim()) : []
  const req2 = await createRequest({
    contractorId: String(body.contractorId),
    cargo: String(body.cargo),
    weightT: Number(body.weightT),
    fromLocationId: String(body.fromLocationId),
    toLocationId: String(body.toLocationId),
    loadingAt: String(body.loadingAt),
    unloadingWindow: String(body.unloadingWindow ?? 'по согласованию'),
    docs,
    actor: String(body.actor ?? 'Логист'),
  })
  return jsonOffice({ ok: true, request: req2 })
}
```

Живые примеры:

```
$ curl 'http://localhost:3000/api/office/requests'
→ 200 {"requests":[{"id":"…","number":"ЗК-2026/1074","externalId":"…","createdAt":"…","status":"DISPATCH",
"statusLabel":"DISPATCH","contractor":{"id":"…","name":"ООО «Донсталь»"},"cargo":"Металлопрокат листовой, 2 шт.",
"weightT":20.2,"from":{…},"to":{…},"loadingAt":"…","unloadingWindow":"послезавтра 09:00–11:00",
"docs":["ТТН (2 экз.)","Паспорт груза"],"vehicle":null,"trailer":null,"driver":null,"assignedBy":null,
"assignedAt":null,"closeReason":null,"trip":null,"pretrip":{"done":0,"total":6,"steps":[]}}, …],
"counts":{…}} // 6 заявок на чистом сиде
```

```
$ curl -X POST http://localhost:3000/api/office/requests -H 'Content-Type: application/json' \
  -d '{"contractorId":"<id>","cargo":"Оборудование промышленное, ящики","weightT":9.5,
       "fromLocationId":"<id>","toLocationId":"<id>","loadingAt":"2026-11-13T08:00:00.000Z",
       "unloadingWindow":"на следующий день 09:00–11:00","docs":["ТТН (2 экз.)","Паспорт груза"],"actor":"Логист"}'
→ 200 {"ok":true,"request":{…,"number":"ЗК-2026/1075","status":"DISPATCH",…}}
```

### 3.7 Офис: /api/office/requests/[id]/assign (POST)

```ts
// src/app/api/office/requests/[id]/assign/route.ts
// Назначение ТС и водителя: проведение + рождение рейса (одна транзакция, раздел 5.3 ТЗ)
import { jsonOffice } from '@/lib/cors'
import { assignRequest } from '@/lib/1c/assign'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { vehicleId?: string; trailerId?: string | null; driverId?: string; actor?: string }
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, errors: ['Некорректное тело запроса'] }, 400)
  }
  if (!body?.vehicleId || !body?.driverId)
    return jsonOffice({ ok: false, errors: ['Нужны vehicleId и driverId'] }, 400)

  const result = await assignRequest(
    id,
    { vehicleId: body.vehicleId, trailerId: body.trailerId ?? null, driverId: body.driverId },
    body.actor ?? 'Диспетчер',
  )
  if (!result.ok) return jsonOffice({ ok: false, errors: result.errors }, 400)
  return jsonOffice(result)
}
```

Живой пример (и отказ по правилу занятости):

```
$ curl -X POST http://localhost:3000/api/office/requests/<requestId>/assign -H 'Content-Type: application/json' \
  -d '{"vehicleId":"<id-МАЗ 6312>","driverId":"<id-Петрова>","actor":"Диспетчер Е. Крылова"}'
→ 200 {"ok":true,"requestId":"be2de5d9-…","tripId":"0fa6c117-…","number":"ЗК-2026/1074"}
// отказ проведения (занятый водитель) → 400
// {"ok":false,"errors":["Занят в незавершённом рейсе ЗК-2026/1076"]}
```

### 3.8 Офис: /api/office/requests/[id]/cancel (POST)

```ts
// src/app/api/office/requests/[id]/cancel/route.ts
// Отмена заявки диспетчером: причина из справочника
import { jsonOffice } from '@/lib/cors'
import { cancelRequest } from '@/lib/1c/cancel'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { reason?: string; actor?: string }
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }
  if (!body?.reason) return jsonOffice({ ok: false, error: 'Укажите причину отмены' }, 400)

  const result = await cancelRequest(id, body.reason, body.actor ?? 'Диспетчер')
  if (!result.ok) return jsonOffice(result, 400)
  return jsonOffice(result)
}
```

Живой пример:

```
$ curl -X POST http://localhost:3000/api/office/requests/<requestId>/cancel -H 'Content-Type: application/json' \
  -d '{"reason":"Отмена заказчиком","actor":"Диспетчер Е. Крылова"}'
→ 200 {"ok":true,"number":"ЗК-2026/1074"}
```

### 3.9 Офис: /api/office/dashboard (GET)

```ts
// src/app/api/office/dashboard/route.ts
// Дашборд: счётчики заявок по статусам, активные рейсы, лента журнала регистрации
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { statusCounts } from '@/lib/1c/statusCounts'
import { REQUEST_STATUSES } from '@/lib/1c/statuses'

export const dynamic = 'force-dynamic'

export async function GET() {
  const counts = await statusCounts()
  const activeTrips = await db.trip.findMany({
    where: { status: { in: ['assigned', 'in_progress'] } },
    include: {
      points: true,
      request: { include: { contractor: true, driver: true, vehicle: true } },
    },
    orderBy: { tripCode: 'desc' },
  })
  const feed = await db.registrationLog.findMany({ orderBy: { at: 'desc' }, take: 12 })
  return jsonOffice({
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    statusOrder: REQUEST_STATUSES,
    activeTrips: activeTrips.map((t) => ({
      tripCode: t.tripCode,
      status: t.status,
      lastEventType: t.lastEventType,
      lastEventAt: t.lastEventAt?.toISOString() ?? null,
      driver: t.request?.driver?.fullName ?? '—',
      vehicle: t.request?.vehicle ? `${t.request.vehicle.model} · ${t.request.vehicle.plate}` : '—',
      from: t.points.find((p) => p.kind === 'loading')?.name ?? null,
      to: t.points.find((p) => p.kind === 'unloading')?.name ?? null,
    })),
    feed: feed.map((f) => ({ id: f.id, user: f.user, action: f.action, entity: f.entity, entityId: f.entityId, level: f.level, at: f.at.toISOString() })),
  })
}
```

Живой пример:

```
$ curl http://localhost:3000/api/office/dashboard
→ 200 {"counts":{"NEW":0,"DISPATCH":2,"ASSIGNED":1,"ACCEPTED":0,"PRETRIP":0,"IN_PROGRESS":0,"DONE":3,"CANCELLED":0},
"total":6,"statusOrder":["NEW","DISPATCH","ASSIGNED","ACCEPTED","PRETRIP","IN_PROGRESS","DONE","CANCELLED"],
"activeTrips":[{"tripCode":"ЗК-2026/1067","status":"assigned","lastEventType":null,"lastEventAt":null,
"driver":"Иванов Сергей Петрович","vehicle":"МАЗ 5440 · А 123 БС 23","from":"Абинск, пл. АЗМЗ",
"to":"Новороссийск, причал 27"}],"feed":[…12 записей журнала…]}}
```

### 3.10 Офис: /api/office/trips (GET)

```ts
// src/app/api/office/trips/route.ts
// Реестр рейсов: статусы из событий (last_event_*), открытые интервалы, предрейсовый осмотр
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { requestRow } from '@/lib/office/serialize'

export const dynamic = 'force-dynamic'

export const EVENT_LABELS: Record<string, string> = {
  DEPARTURE: 'в движении',
  ARRIVAL_LOADING: 'на погрузке',
  LOADING_DONE: 'погрузка завершена',
  REST_START: 'на стоянке',
  REST_END: 'выход с стоянки',
  ARRIVAL_UNLOADING: 'на выгрузке',
  UNLOADING_DONE: 'выгрузка завершена',
  TRIP_DONE: 'рейс завершён',
}

export async function GET() {
  const requests = await db.transportRequest.findMany({
    where: { tripId: { not: null } },
    include: {
      contractor: true, fromLocation: true, toLocation: true, vehicle: true, trailer: true, driver: true,
      trip: { include: { points: true, events: { orderBy: { occurredAt: 'asc' } } } },
    },
    orderBy: { number: 'desc' },
  })
  const inspections = await db.preTripInspection.findMany({ include: { steps: true } })
  const byRequest = new Map(inspections.map((i) => [i.requestId, i]))

  const trips = requests.map((r) => {
    const row = requestRow(r, byRequest.get(r.id) ?? null)
    const events = row.trip?.events ?? []
    // открытые интервалы: события без закрытия (последнее из них — текущий интервал рейса)
    const openIntervals = events.filter((e) => e.intervalClosedAt === null)
    return {
      ...row,
      lastEventLabel: row.trip?.lastEventType ? EVENT_LABELS[row.trip.lastEventType] ?? row.trip.lastEventType : null,
      openIntervals,
    }
  })
  return jsonOffice({ trips })
}
```

Живой пример:

```
$ curl http://localhost:3000/api/office/trips   (после назначения из примера assign)
→ 200 {"trips":[{…,"number":"ЗК-2026/1074","status":"ASSIGNED","lastEventLabel":null,
"openIntervals":[],"trip":{"points":2,"routeDistanceM":346638,"routeDurationS":…}}, …]}
```

### 3.11 Офис: /api/office/chat (GET/POST)

```ts
// src/app/api/office/chat/route.ts
// Чат диспетчера с водителем: сообщения уходят водителю через SyncJournal (план обмена)
import { randomUUID } from 'crypto'
import { db, withWriteLock } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { journalWrite } from '@/lib/bus/syncWriter'
import { chatMessageSnapshot } from '@/lib/bus/snapshots'
import { logEvent } from '@/lib/1c/journal'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const driverId = url.searchParams.get('driverId')

  const drivers = await db.driver.findMany({ where: { isActive: true }, orderBy: { fullName: 'asc' } })
  const allMessages = await db.chatMessage.findMany({ orderBy: { createdAt: 'asc' } })

  const threads = drivers.map((d) => {
    const msgs = allMessages.filter((m) => m.driverId === d.id)
    return {
      driverId: d.id,
      fullName: d.fullName,
      lastMessage: msgs.length ? { body: msgs[msgs.length - 1].body, sender: msgs[msgs.length - 1].sender, at: msgs[msgs.length - 1].createdAt.toISOString() } : null,
      unreadFromDriver: msgs.filter((m) => m.sender === 'DRIVER').length,
    }
  })

  const messages = driverId
    ? allMessages
        .filter((m) => m.driverId === driverId)
        .map((m) => ({ id: m.id, sender: m.sender, body: m.body, tripId: m.tripId, at: m.createdAt.toISOString() }))
    : []

  return jsonOffice({ threads, messages })
}

export async function POST(req: Request) {
  let body: { driverId?: string; body?: string; tripId?: string | null; actor?: string }
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }
  if (!body?.driverId || !body?.body?.trim())
    return jsonOffice({ ok: false, error: 'Нужны driverId и body' }, 400)

  const msg = await withWriteLock(() =>
    db.$transaction(async (tx) => {
    const m = await tx.chatMessage.create({
      data: {
        id: randomUUID(),
        driverId: body.driverId!,
        tripId: body.tripId ?? null,
        sender: 'DISPATCHER',
        body: body.body!.trim(),
      },
    })
    await journalWrite(tx, body.driverId!, 'CHAT_MESSAGE', 'UPSERT', chatMessageSnapshot(m))
      await logEvent(tx, { user: body.actor ?? 'Диспетчер', action: 'CHAT_SEND', entity: 'ChatMessage', entityId: m.id })
      return m
    }, { timeout: 15000 }),
  )
  return jsonOffice({ ok: true, message: { id: msg.id, sender: msg.sender, body: msg.body, at: msg.createdAt.toISOString() } })
}
```

Живой пример:

```
$ curl -X POST http://localhost:3000/api/office/chat -H 'Content-Type: application/json' \
  -d '{"driverId":"<id-водителя>","body":"Проверка доставки чата через план обмена"}'
→ 200 {"ok":true,"message":{"id":"…","sender":"DISPATCHER","body":"Проверка доставки чата через план обмена","at":"…"}}
// далее GET /api/driver/v1/sync/pull?cursor=0 (X-Driver-Id водителя) → в entries есть CHAT_MESSAGE с этим телом
// (проверено шагом 9 сценария приёмки)
```

### 3.12 Офис: /api/office/journal (GET)

```ts
// src/app/api/office/journal/route.ts
// Журнал регистрации: кто, что, когда, уровень; фильтры
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const user = url.searchParams.get('user') ?? undefined
  const action = url.searchParams.get('action') ?? undefined
  const level = url.searchParams.get('level') ?? undefined
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '200', 10) || 200))

  const rows = await db.registrationLog.findMany({
    where: {
      ...(user ? { user: { contains: user } } : {}),
      ...(action ? { action: { contains: action } } : {}),
      ...(level ? { level } : {}),
    },
    orderBy: { at: 'desc' },
    take: limit,
  })
  return jsonOffice({
    rows: rows.map((r) => ({
      id: r.id,
      user: r.user,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      level: r.level,
      at: r.at.toISOString(),
    })),
  })
}
```

Живой пример:

```
$ curl 'http://localhost:3000/api/office/journal?limit=3'   (после действий примеров assign/cancel)
→ 200 {"rows":[
 {"id":…,"user":"Диспетчер Е. Крылова","action":"CANCEL","entity":"TransportRequest","entityId":"ЗК-2026/1074","level":"info","at":"2026-11-11T13:10:59.279Z"},
 {"id":…,"user":"Диспетчер Е. Крылова","action":"ASSIGN","entity":"TransportRequest","entityId":"ЗК-2026/1074","level":"info","at":"2026-11-11T13:10:59.146Z"},
 {"id":…,"user":"Логист","action":"REQUEST_CREATE","entity":"TransportRequest","entityId":"ЗК-2026/1063","level":"info","at":"…"}]}
```

### 3.13 Офис: /api/office/catalog/[entity] (GET/POST) и /[id] (PATCH/DELETE)

```ts
// src/app/api/office/catalog/[entity]/route.ts
// CRUD справочников: /api/office/catalog/vehicles | trailers | drivers | contractors | locations
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { logEvent } from '@/lib/1c/journal'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Entity = 'vehicles' | 'trailers' | 'drivers' | 'contractors' | 'locations'

function isEntity(e: string): e is Entity {
  return ['vehicles', 'trailers', 'drivers', 'contractors', 'locations'].includes(e)
}

export async function GET(_req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params
  if (!isEntity(entity)) return jsonOffice({ ok: false, error: `Неизвестный справочник: ${entity}` }, 404)
  let rows: unknown
  switch (entity) {
    case 'vehicles': rows = await db.vehicle.findMany({ orderBy: { createdAt: 'asc' } }); break
    case 'trailers': rows = await db.trailer.findMany({ orderBy: { createdAt: 'asc' } }); break
    case 'drivers': rows = await db.driver.findMany({ orderBy: { createdAt: 'asc' } }); break
    case 'contractors': rows = await db.contractor.findMany({ orderBy: { createdAt: 'asc' } }); break
    case 'locations': rows = await db.location.findMany({ orderBy: { name: 'asc' } }); break
  }
  return jsonOffice({ rows })
}

export async function POST(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params
  if (!isEntity(entity)) return jsonOffice({ ok: false, error: `Неизвестный справочник: ${entity}` }, 404)
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }

  try {
    let id = ''
    switch (entity) {
      case 'vehicles': {
        if (!body.plate || !body.model) return jsonOffice({ ok: false, error: 'Нужны plate и model' }, 400)
        const row = await db.vehicle.create({
          data: {
            plate: String(body.plate),
            model: String(body.model),
            kind: String(body.kind ?? 'tractor'),
            bodyType: String(body.bodyType ?? 'tarp'),
            capacityT: Number(body.capacityT ?? 20),
            volumeM3: body.volumeM3 !== undefined && body.volumeM3 !== null && body.volumeM3 !== '' ? Number(body.volumeM3) : null,
            readiness: String(body.readiness ?? 'ready'),
          },
        })
        id = row.id
        break
      }
      case 'trailers': {
        if (!body.plate || !body.model) return jsonOffice({ ok: false, error: 'Нужны plate и model' }, 400)
        const row = await db.trailer.create({ data: { plate: String(body.plate), model: String(body.model), type: String(body.type ?? 'tarp') } })
        id = row.id
        break
      }
      case 'drivers': {
        if (!body.fullName) return jsonOffice({ ok: false, error: 'Нужно fullName' }, 400)
        const row = await db.driver.create({
          data: {
            fullName: String(body.fullName),
            phone: body.phone ? String(body.phone) : null,
            licenseNo: body.licenseNo ? String(body.licenseNo) : null,
            appId: body.appId ? String(body.appId) : null,
          },
        })
        id = row.id
        break
      }
      case 'contractors': {
        if (!body.name) return jsonOffice({ ok: false, error: 'Нужно name' }, 400)
        const row = await db.contractor.create({ data: { name: String(body.name), inn: body.inn ? String(body.inn) : null, kind: String(body.kind ?? 'customer') } })
        id = row.id
        break
      }
      case 'locations': {
        if (!body.name || !body.address) return jsonOffice({ ok: false, error: 'Нужны name и address' }, 400)
        const row = await db.location.create({
          data: {
            name: String(body.name),
            address: String(body.address),
            lat: Number(body.lat ?? 0),
            lon: Number(body.lon ?? 0),
            geofenceRadiusM: Number(body.geofenceRadiusM ?? 300),
          },
        })
        id = row.id
        break
      }
    }
    await logEvent(db, { user: 'Админ', action: 'CATALOG_CREATE', entity, entityId: id })
    return jsonOffice({ ok: true })
  } catch (e) {
    const msg = e instanceof Prisma.PrismaClientKnownRequestError ? 'Запись с таким ключом уже существует' : e instanceof Error ? e.message : 'Ошибка создания записи'
    return jsonOffice({ ok: false, error: msg }, 400)
  }
}
```

```ts
// src/app/api/office/catalog/[entity]/[id]/route.ts
// Правка и мягкое удаление (пометка удаления, как в 1С) записей справочников
import { db } from '@/lib/db'
import { jsonOffice } from '@/lib/cors'
import { logEvent } from '@/lib/1c/journal'

export const dynamic = 'force-dynamic'

type Entity = 'vehicles' | 'trailers' | 'drivers' | 'contractors' | 'locations'

function isEntity(e: string): e is Entity {
  return ['vehicles', 'trailers', 'drivers', 'contractors', 'locations'].includes(e)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ entity: string; id: string }> }) {
  const { entity, id } = await params
  if (!isEntity(entity)) return jsonOffice({ ok: false, error: 'Неизвестный справочник' }, 404)
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }
  try {
    switch (entity) {
      case 'vehicles':
        await db.vehicle.update({
          where: { id },
          data: {
            ...(body.model !== undefined ? { model: String(body.model) } : {}),
            ...(body.kind !== undefined ? { kind: String(body.kind) } : {}),
            ...(body.bodyType !== undefined ? { bodyType: String(body.bodyType) } : {}),
            ...(body.capacityT !== undefined && body.capacityT !== '' ? { capacityT: Number(body.capacityT) } : {}),
            ...(body.volumeM3 !== undefined ? { volumeM3: body.volumeM3 === '' || body.volumeM3 === null ? null : Number(body.volumeM3) } : {}),
            ...(body.readiness !== undefined ? { readiness: String(body.readiness) } : {}),
            ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
          },
        })
        break
      case 'trailers':
        await db.trailer.update({
          where: { id },
          data: {
            ...(body.model !== undefined ? { model: String(body.model) } : {}),
            ...(body.type !== undefined ? { type: String(body.type) } : {}),
            ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
          },
        })
        break
      case 'drivers':
        await db.driver.update({
          where: { id },
          data: {
            ...(body.fullName !== undefined ? { fullName: String(body.fullName) } : {}),
            ...(body.phone !== undefined ? { phone: String(body.phone) } : {}),
            ...(body.licenseNo !== undefined ? { licenseNo: String(body.licenseNo) } : {}),
            ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
          },
        })
        break
      case 'contractors':
        await db.contractor.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: String(body.name) } : {}),
            ...(body.inn !== undefined ? { inn: String(body.inn) } : {}),
            ...(body.kind !== undefined ? { kind: String(body.kind) } : {}),
            ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
          },
        })
        break
      case 'locations':
        await db.location.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: String(body.name) } : {}),
            ...(body.address !== undefined ? { address: String(body.address) } : {}),
            ...(body.lat !== undefined && body.lat !== '' ? { lat: Number(body.lat) } : {}),
            ...(body.lon !== undefined && body.lon !== '' ? { lon: Number(body.lon) } : {}),
            ...(body.geofenceRadiusM !== undefined && body.geofenceRadiusM !== '' ? { geofenceRadiusM: Number(body.geofenceRadiusM) } : {}),
          },
        })
        break
    }
    await logEvent(db, { user: 'Админ', action: 'CATALOG_UPDATE', entity, entityId: id })
    return jsonOffice({ ok: true })
  } catch (e) {
    return jsonOffice({ ok: false, error: e instanceof Error ? e.message : 'Ошибка правки' }, 400)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ entity: string; id: string }> }) {
  const { entity, id } = await params
  if (!isEntity(entity)) return jsonOffice({ ok: false, error: 'Неизвестный справочник' }, 404)
  try {
    switch (entity) {
      case 'vehicles': await db.vehicle.update({ where: { id }, data: { isActive: false } }); break
      case 'trailers': await db.trailer.update({ where: { id }, data: { isActive: false } }); break
      case 'drivers': await db.driver.update({ where: { id }, data: { isActive: false } }); break
      case 'contractors': await db.contractor.update({ where: { id }, data: { isActive: false } }); break
      case 'locations': await db.location.update({ where: { id }, data: { geofenceRadiusM: 0 } }); break
    }
    await logEvent(db, { user: 'Админ', action: 'CATALOG_DELETE', entity, entityId: id, level: 'warning' })
    return jsonOffice({ ok: true })
  } catch (e) {
    return jsonOffice({ ok: false, error: e instanceof Error ? e.message : 'Ошибка удаления' }, 400)
  }
}
```

Живой пример GET:

```
$ curl http://localhost:3000/api/office/catalog/drivers
→ 200 {"rows":[{"id":"4f64a559-…","fullName":"Иванов Сергей Петрович","phone":"+7 (918) 201-15-32",
"licenseNo":"5412 889012","isActive":true,"appId":"d1111111-1111-4111-8111-111111111111","createdAt":"…"}, …]} // rows=12
```

### 3.14 Офис: /api/office/demo (POST)

```ts
// src/app/api/office/demo/route.ts
// Демо-панель: случайная заявка, автопрогон сквозного сценария, сброс и пересев
import { jsonOffice } from '@/lib/cors'
import { createRandomRequest, autoflow, resetAndSeed, type AutoflowStep } from '@/lib/1c/demos'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return jsonOffice({ ok: false, error: 'Некорректное тело запроса' }, 400)
  }
  switch (body.action) {
    case 'random-request': {
      const r = await createRandomRequest()
      return jsonOffice({ ok: true, message: `Создана заявка ${r.number} (DISPATCH)`, number: r.number })
    }
    case 'autoflow': {
      const log: AutoflowStep[] = await autoflow()
      const failed = log.filter((l) => !l.ok)
      return jsonOffice({ ok: failed.length === 0, log })
    }
    case 'reset': {
      await resetAndSeed()
      return jsonOffice({ ok: true, message: 'База сброшена и пересеяна демо-данными' })
    }
    default:
      return jsonOffice({ ok: false, error: 'Действие: random-request | autoflow | reset' }, 400)
  }
}
```

Живой пример автопрогона (выполнен в этой сессии):

```
$ curl -X POST http://localhost:3000/api/office/demo -H 'Content-Type: application/json' -d '{"action":"autoflow"}'
→ 200 {"ok":true,"log":[
 {"step":"Заявка","ok":true,"detail":"ЗК-2026/1071 в статусе DISPATCH"},
 {"step":"Назначение","ok":true,"detail":"ЗК-2026/1071 → КАМАЗ 5490 · К 456 МН 23, Петров Андрей Николаевич"},
 {"step":"Водитель: ACCEPT","ok":true,"detail":"статус ACCEPTED"},
 {"step":"Фотофиксация","ok":true,"detail":"6 из 6 шагов записаны"},
 {"step":"Старт маршрута","ok":true,"detail":"TripEvent DEPARTURE, статус IN_PROGRESS"},
 {"step":"Завершение рейса","ok":true,"detail":"TripEvent TRIP_DONE, интервалы закрыты, заявка DONE"},
 {"step":"Чат","ok":true,"detail":"Сообщение диспетчера в плане обмена (seq SyncJournal обновлён, id b567e974…)"}]}
```

### 3.15 Офис: /api/office/files/[name] (GET)

```ts
// src/app/api/office/files/[name]/route.ts
// Отдача фото предрейсового осмотра. Каждый просмотр фиксируется в журнале регистрации
// (PHOTO_VIEW) — 152-ФЗ, ст. 18.1 и 19 (организационные и технические меры).
import { readFile } from 'fs/promises'
import { db } from '@/lib/db'
import { logEvent } from '@/lib/1c/journal'
import { photoPath } from '@/lib/photos'

export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const filePath = photoPath(name)
  if (!filePath) return new Response('Not found', { status: 404 })
  try {
    const data = await readFile(filePath)
    await logEvent(db, { user: 'Диспетчер', action: 'PHOTO_VIEW', entity: 'PreTripStep', entityId: name })
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': MIME[name.split('.').pop() ?? ''] ?? 'application/octet-stream', 'Cache-Control': 'no-store' },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
```

Живой пример:

```
$ curl -I http://localhost:3000/api/office/files/<uuid>.png
→ 200, Content-Type: image/png   (файл из uploads/; каждый просмотр пишется в журнал как PHOTO_VIEW)
```

### 3.16 Прочее

`src/app/api/route.ts` — заглушка каркаса песочницы (`{"message":"Hello, world!"}`), к платформе не относится.

## ЧАСТЬ 4 — UI (сжато)

| Экран/компонент | Путь | Что делает (одна строка) |
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

Страница-вход: `src/app/page.tsx` рендерит `<Workspace/>`; тема 1С — блок `.c1-*` в `src/app/globals.css`; метаданные и `lang="ru"` — в `src/app/layout.tsx`.

### Файлы с бизнес-логикой — целиком

```tsx
// src/components/workspace/Workspace.tsx
'use client'

import { useSyncExternalStore, useState } from 'react'
import { OneCShell, type OneCSection, type OneCWindow } from '@/components/1c/OneCShell'
import { DashboardScreen } from './DashboardScreen'
import { RequestsScreen } from './RequestsScreen'
import { DispatchScreen } from './DispatchScreen'
import { TripsScreen } from './TripsScreen'
import { ChatScreen } from './ChatScreen'
import { CatalogsScreen } from './CatalogsScreen'
import { JournalScreen } from './JournalScreen'
import { DemoScreen } from './DemoScreen'
import { House, ShoppingCart, Package, Truck, MessagesSquare, Settings } from 'lucide-react'

type ScreenId = 'home' | 'orders' | 'route-sheets' | 'trips' | 'chat' | 'catalogs' | 'journal' | 'demo'

// Рабочие места: окна открываются из панели разделов, как формы в 1С
const SCREENS: Record<ScreenId, { title: string; roles: string[] }> = {
  home: { title: 'Главная страница', roles: ['Логист', 'Диспетчер', 'Админ'] },
  orders: { title: 'Заказы грузоотправителей', roles: ['Логист'] },
  'route-sheets': { title: 'Маршрутные листы', roles: ['Диспетчер'] },
  trips: { title: 'Рейсы', roles: ['Диспетчер'] },
  chat: { title: 'Обсуждение', roles: ['Диспетчер'] },
  catalogs: { title: 'Справочники (НСИ)', roles: ['Админ'] },
  journal: { title: 'Журнал регистрации', roles: ['Админ'] },
  demo: { title: 'Демо-панель', roles: ['Логист', 'Диспетчер', 'Админ'] },
}

const ROLES = ['Логист', 'Диспетчер', 'Админ']

// Рабочее место запоминается между сеансами, как настройка пользователя 1С.
// Хранилище на localStorage + useSyncExternalStore: без расхождений гидратации.
const ROLE_KEY = 'kontur1c.role'

let roleListeners: (() => void)[] = []
function readRole(): string {
  try {
    const saved = window.localStorage.getItem(ROLE_KEY)
    return saved && ROLES.includes(saved) ? saved : 'Диспетчер'
  } catch {
    return 'Диспетчер' // приватный режим
  }
}
const roleStore = {
  subscribe(listener: () => void) {
    roleListeners.push(listener)
    return () => {
      roleListeners = roleListeners.filter((l) => l !== listener)
    }
  },
  get: readRole,
  getServer: () => 'Диспетчер',
  set(next: string) {
    try {
      window.localStorage.setItem(ROLE_KEY, next)
    } catch {
      /* приватный режим — просто не запоминаем */
    }
    for (const l of roleListeners) l()
  },
}

export function Workspace() {
  const role = useSyncExternalStore(roleStore.subscribe, roleStore.get, roleStore.getServer)

  const [openIds, setOpenIds] = useState<ScreenId[]>(['home'])
  const [activeId, setActiveId] = useState<ScreenId>('home')

  const allowed = (id: ScreenId) => SCREENS[id].roles.includes(role)

  function openWindow(id: string) {
    const sid = id as ScreenId
    if (!allowed(sid)) return
    setOpenIds((prev) => (prev.includes(sid) ? prev : [...prev, sid]))
    setActiveId(sid)
  }

  function closeWindow(id: string) {
    setOpenIds((prev) => {
      const next = prev.filter((w) => w !== id)
      setActiveId((cur) => (cur === id ? 'home' : cur))
      return next
    })
  }

  // смена рабочего места: запоминаем и закрываем окна, недоступные новой роли
  function changeRole(r: string) {
    roleStore.set(r)
    setOpenIds((prev) => {
      const next = prev.filter((w) => SCREENS[w].roles.includes(r))
      setActiveId((cur) => (next.includes(cur) ? cur : 'home'))
      return next
    })
  }

  // Панель разделов «1С:ERP»: разделы видны по правам роли (как в 1С —
  // недоступные подсистемы вообще не показываются в панели разделов)
  const sections: OneCSection[] = [
    { id: 'main', label: 'Главное', icon: <House className="h-4 w-4" />, windowId: 'home' },
    ...(allowed('orders')
      ? [{ id: 'sales', label: 'Продажи', icon: <ShoppingCart className="h-4 w-4" />, windowId: 'orders' }]
      : []),
    ...(allowed('route-sheets')
      ? [{ id: 'warehouse', label: 'Склад и доставка', icon: <Package className="h-4 w-4" />, windowId: 'route-sheets' }]
      : []),
    ...(allowed('trips')
      ? [{ id: 'fleet', label: 'Управление автопарком', icon: <Truck className="h-4 w-4" />, windowId: 'trips' }]
      : []),
    ...(allowed('chat')
      ? [{ id: 'talk', label: 'Обсуждение', icon: <MessagesSquare className="h-4 w-4" />, windowId: 'chat' }]
      : []),
    {
      id: 'nsi',
      label: 'НСИ и администрирование',
      icon: <Settings className="h-4 w-4" />,
      menu: [
        { windowId: 'catalogs', label: 'Справочники (НСИ)', disabled: !allowed('catalogs') },
        { windowId: 'journal', label: 'Журнал регистрации', disabled: !allowed('journal') },
        { windowId: 'demo', label: 'Демо-панель', disabled: !allowed('demo') },
      ],
    },
  ]

  // Открытые окна в порядке открытия
  const windows: OneCWindow[] = openIds.map((id) => ({ id, title: SCREENS[id].title }))

  const close = (id: string) => closeWindow(id as ScreenId)

  return (
    <OneCShell
      sections={sections}
      windows={windows}
      activeId={activeId}
      onSelectWindow={(id) => setActiveId(id as ScreenId)}
      onOpenWindow={openWindow}
      onCloseWindow={closeWindow}
      userName="Котельников Роман Сергеевич"
      role={role}
      roles={ROLES}
      onRoleChange={changeRole}
      statusLeft="Эмулятор учётного контура 1С: справочники, документы, проведение, регистры, план обмена · экраны обновляются опросом раз в 5 секунд"
      statusRight={`Рабочее место: ${role} · Контур 1С (демо-стенд)`}
    >
      {activeId === 'home' && <DashboardScreen />}
      {activeId === 'orders' && <RequestsScreen onClose={() => close('orders')} />}
      {activeId === 'route-sheets' && <DispatchScreen onClose={() => close('route-sheets')} />}
      {activeId === 'trips' && <TripsScreen onClose={() => close('trips')} />}
      {activeId === 'chat' && <ChatScreen onClose={() => close('chat')} />}
      {activeId === 'catalogs' && <CatalogsScreen onClose={() => close('catalogs')} />}
      {activeId === 'journal' && <JournalScreen onClose={() => close('journal')} />}
      {activeId === 'demo' && <DemoScreen onClose={() => close('demo')} />}
    </OneCShell>
  )
}
```

```tsx
// src/components/workspace/DispatchScreen.tsx
'use client'

// Рабочее место диспетчерской — форма «Маршрутные листы» (список + панель назначения).
// Разметка имитирует список документов 1С (скриншот 1С:ERP, интерфейс «Такси»).

import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { C1Button, C1Select, C1ToolButton, FormTitleBar } from '@/components/1c/kit'
import { apiPost } from './api'
import { usePoll } from './usePoll'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { CANCEL_REASONS, STATUS_LABELS } from '@/lib/1c/statuses'

type RequestRow = {
  id: string; number: string; status: string; contractor: { name: string }; cargo: string; weightT: number
  from: { name: string; address: string }; to: { name: string; address: string }
  loadingAt: string; unloadingWindow: string; docs: string[]
}
type Vehicle = { id: string; plate: string; model: string; kind: string; bodyType: string; capacityT: number; volumeM3: number | null; readiness: string; isActive: boolean }
type Trailer = { id: string; plate: string; model: string; type: string; isActive: boolean }
type Driver = { id: string; fullName: string; isActive: boolean; appId: string | null }
type TripRow = { number: string; driver: { id: string } | null; trip: { status: string } | null }

// зеркала правил 5.3 для бейджей кандидатов (сервер перепроверяет при проведении)
const BODY_CARGO: Record<string, string[]> = {
  tarp: ['металло', 'паллет', 'мешк', 'ферм', 'прокат', 'лист', 'оборудован', 'пиломатериал', 'труб', 'рулон', 'шпала', 'кирпич'],
  fridge: ['продукт', 'мясо', 'рыба', 'молок', 'заморож', 'овощ', 'фрукт', 'морожен', 'медикамент', 'цвет'],
  flatbed: ['металло', 'прокат', 'лист', 'труб', 'жби', 'плита', 'бетон', 'кирпич', 'ферм', 'контейнер', 'рулон'],
  tank: ['наливн', 'топлив', 'битум'],
}
const BODY_RU: Record<string, string> = { tarp: 'штора', fridge: 'реф', flatbed: 'борт', tank: 'цистерна' }
const KIND_RU: Record<string, string> = { tractor: 'тягач', tipper: 'самосвал', van: 'фургон' }

const STATUS_DOT: Record<string, string> = {
  NEW: '#8a8a8a', DISPATCH: '#e8a000', ASSIGNED: '#2f6db0', ACCEPTED: '#00a0b0',
  PRETRIP: '#7a4fb0', IN_PROGRESS: '#1c5a3a', DONE: '#2f8a2f', CANCELLED: '#c43e1c',
}

// дата в формате списка 1С: 13.11.2026 11:34:02
const fmt1C = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${date} ${time}`
}

function vehicleIssues(v: Vehicle, r: RequestRow): string[] {
  const issues: string[] = []
  if (!v.isActive) issues.push('не активено')
  if (v.readiness !== 'ready') issues.push(v.readiness === 'repair' ? 'в ремонте' : 'на обслуживании')
  if (r.weightT > v.capacityT) issues.push(`грузоподъёмность ${v.capacityT} т < ${r.weightT} т`)
  const keys = BODY_CARGO[v.bodyType] ?? []
  if (!keys.some((k) => r.cargo.toLowerCase().includes(k))) issues.push(`кузов «${BODY_RU[v.bodyType]}» не под груз`)
  return issues
}

/* Иконки первой пары колонок списка 1С: документ + транспорт */
function DocIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" className="shrink-0">
      <path d="M2 1.5h7l3 3V14.5H2z" fill="#fff" stroke="#7a9cc0" strokeWidth="1" />
      <path d="M9 1.5v3h3" fill="#e8f0f8" stroke="#7a9cc0" strokeWidth="1" />
      <path d="M4 7h6M4 9h6M4 11h4" stroke="#9ab4cc" strokeWidth="0.9" />
    </svg>
  )
}
function TruckIcon({ muted }: { muted?: boolean }) {
  return (
    <svg width="17" height="15" viewBox="0 0 18 15" className="shrink-0">
      <rect x="1" y="3" width="9" height="6.5" rx="0.8" fill={muted ? '#e2e2e2' : '#3f9c46'} stroke={muted ? '#b8b8b8' : '#2f7a36'} strokeWidth="0.9" />
      <path d="M10 5h3.2l2.3 2.4v2.1H10z" fill={muted ? '#eeeeee' : '#66b96c'} stroke={muted ? '#b8b8b8' : '#2f7a36'} strokeWidth="0.9" />
      <circle cx="4.5" cy="11.5" r="1.6" fill="#5c5c5c" stroke="#333" strokeWidth="0.7" />
      <circle cx="13" cy="11.5" r="1.6" fill="#5c5c5c" stroke="#333" strokeWidth="0.7" />
    </svg>
  )
}

export function DispatchScreen({ onClose }: { onClose?: () => void }) {
  const { data: requestsData, reload } = usePoll<{ requests: RequestRow[] }>('/api/office/requests?status=DISPATCH')
  const { data: vehiclesData } = usePoll<{ rows: Vehicle[] }>('/api/office/catalog/vehicles')
  const { data: trailersData } = usePoll<{ rows: Trailer[] }>('/api/office/catalog/trailers')
  const { data: driversData } = usePoll<{ rows: Driver[] }>('/api/office/catalog/drivers')
  const { data: tripsData } = usePoll<{ trips: TripRow[] }>('/api/office/trips')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [vehicleId, setVehicleId] = useState<string>('')
  const [trailerId, setTrailerId] = useState<string>('')
  const [driverId, setDriverId] = useState<string>('')
  const [assigning, setAssigning] = useState(false)
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [cancelTarget, setCancelTarget] = useState<RequestRow | null>(null)
  const [cancelReason, setCancelReason] = useState<string>(CANCEL_REASONS[0])
  const [cancelOpen, setCancelOpen] = useState(false)
  const [filterText, setFilterText] = useState('')

  const pool = requestsData?.requests ?? []
  const selected = pool.find((r) => r.id === selectedId) ?? null
  const rows = useMemo(
    () => pool.filter((r) => !filterText || `${r.number} ${r.cargo} ${r.from.name} ${r.to.name} ${r.contractor.name}`.toLowerCase().includes(filterText.toLowerCase())),
    [pool, filterText],
  )

  const busyDriverIds = useMemo(() => {
    const s = new Set<string>()
    for (const t of tripsData?.trips ?? []) {
      if (t.trip && ['assigned', 'in_progress'].includes(t.trip.status) && t.driver) s.add(t.driver.id)
    }
    return s
  }, [tripsData])

  const candidates = useMemo(() => {
    if (!selected || !vehiclesData) return []
    return vehiclesData.rows
      .map((v) => ({ v, issues: vehicleIssues(v, selected) }))
      .sort((a, b) => a.issues.length - b.issues.length)
  }, [selected, vehiclesData])

  function select(r: RequestRow) {
    setSelectedId(r.id)
    setVehicleId('')
    setTrailerId('')
    setDriverId('')
    setServerErrors([])
  }

  async function assign() {
    if (!selected || !vehicleId || !driverId) return
    setAssigning(true)
    setServerErrors([])
    try {
      const res = await apiPost<{ number: string }>(`/api/office/requests/${selected.id}/assign`, {
        vehicleId,
        trailerId: trailerId || null,
        driverId,
        actor: 'Диспетчер Е. Крылова',
      })
      toast.success(`Проведено: ${res.number} — рейс рождён, план обмена записан`)
      setSelectedId(null)
      reload()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Отказ проведения'
      setServerErrors(message.split('; '))
      toast.error('Документ не проведён')
    } finally {
      setAssigning(false)
    }
  }

  async function cancel() {
    if (!cancelTarget) return
    try {
      await apiPost(`/api/office/requests/${cancelTarget.id}/cancel`, { reason: cancelReason, actor: 'Диспетчер Е. Крылова' })
      toast.success(`Заявка ${cancelTarget.number} отменена`)
      setCancelOpen(false)
      setCancelTarget(null)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка отмены')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <FormTitleBar title="Маршрутные листы" onClose={onClose} />

      {/* Командная панель списка */}
      <div className="flex h-[34px] shrink-0 items-center gap-1 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
        <C1Button className="!h-[24px]">
          <svg width="11" height="11" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="#2f7a36" strokeWidth="1.6" /></svg>
          Создать
          <svg width="8" height="5" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#666" /></svg>
        </C1Button>
        <C1ToolButton title="Скопировать">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="#5c5c5c" strokeWidth="1.1" /><path d="M9.5 2.5h-7v7" stroke="#5c5c5c" strokeWidth="1.1" /></svg>
        </C1ToolButton>
        <C1ToolButton title="Изменить">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M9.5 2l2.5 2.5L5 11.5l-3 .5.5-3z" stroke="#c98a00" strokeWidth="1.1" strokeLinejoin="round" /></svg>
        </C1ToolButton>
        <C1Button className="!h-[24px]">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 1h6v3H3zM2 7h8v4H2z" stroke="#5c5c5c" strokeWidth="1.1" /><path d="M4 7V5h4v2" stroke="#5c5c5c" strokeWidth="1.1" /></svg>
          Печать
          <svg width="8" height="5" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#666" /></svg>
        </C1Button>
        <C1Button className="!h-[24px]">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 10.5c2-4 8-4 10 0M6 6.5a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2z" stroke="#5c5c5c" strokeWidth="1.1" /></svg>
          Отчеты
          <svg width="8" height="5" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#666" /></svg>
        </C1Button>

        <div className="ml-auto flex items-center gap-1">
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Поиск (Ctrl+F)"
            className="c1-input w-[210px]"
          />
          <C1ToolButton title="Найти">
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4" stroke="#5c5c5c" strokeWidth="1.3" /><path d="M9 9l3.5 3.5" stroke="#5c5c5c" strokeWidth="1.3" /></svg>
          </C1ToolButton>
          <C1Button className="!h-[24px]">
            Ещё
            <svg width="8" height="5" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#666" /></svg>
          </C1Button>
        </div>
      </div>

      {/* Список документов «Маршрутные листы» */}
      <div className="c1-scroll min-h-[180px] flex-1 overflow-auto">
        <table className="c1-table">
          <thead>
            <tr>
              <th className="w-[24px] min-w-[24px] max-w-[24px] px-0" />
              <th className="w-[26px] min-w-[26px] max-w-[26px] px-0" />
              <th className="w-[110px]">Номер</th>
              <th className="w-[135px]">
                Дата
                <span className="ml-1 inline-block text-[9px] text-[#2f6db0]">▼</span>
              </th>
              <th className="w-[90px]">ТС</th>
              <th className="w-[170px]">Водители</th>
              <th className="w-[120px]">Перевозчик</th>
              <th className="w-[130px]">Адрес отправления</th>
              <th className="w-[130px]">Адрес прибытия</th>
              <th className="w-[80px]">Статус</th>
              <th>Комментарий</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sel = r.id === selectedId
              return (
                <tr key={r.id} className={cn(sel && 'c1-row-pink')} onClick={() => select(r)}>
                  <td className="px-1 text-center"><DocIcon /></td>
                  <td className="px-1 text-center"><TruckIcon muted={sel} /></td>
                  <td>{r.number}</td>
                  <td>{fmt1C(r.loadingAt)}</td>
                  <td />
                  <td />
                  <td className="truncate">АЗМЗ ООО</td>
                  <td>{r.from.name}</td>
                  <td>{r.to.name}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: STATUS_DOT[r.status] ?? '#8a8a8a' }} />
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="max-w-[420px]">
                    <span className="text-[#1c1c1c]">{r.cargo}</span>
                    <span className="text-[#8a8a8a]"> · {r.weightT} т · окно: {r.unloadingWindow}{r.docs.length ? ` · ${r.docs.join(', ')}` : ''}</span>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="py-8 text-center text-[12px] text-[#8a8a8a]">
                  {pool.length === 0 ? 'Пул диспетчерской пуст — все заявки назначены' : 'Не найдено по строке поиска'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Разделитель панелей */}
      <div className="c1-splitter shrink-0" />

      {/* Нижняя панель: назначение ТС и водителя (проведение документа) */}
      <div className="flex min-h-[220px] shrink-0 flex-col overflow-hidden" style={{ height: 300 }}>
        <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2">
          <C1Button accent className="!h-[25px]" disabled={!selected || !vehicleId || !driverId || assigning} onClick={() => void assign()}>
            <svg width="10" height="9" viewBox="0 0 10 9"><path d="M0 4.5L3.5 8 10 0.8" stroke="#4a2f00" strokeWidth="1.8" fill="none" /></svg>
            {assigning ? 'Проведение…' : 'Назначить — провести документ'}
          </C1Button>
          <C1Button className="!h-[25px]" disabled={!selected} onClick={() => { if (selected) { setCancelTarget(selected); setCancelOpen(true) } }}>
            <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4.2" stroke="#c43e1c" strokeWidth="1.2" fill="none" /><path d="M1.8 1.8l6.4 6.4" stroke="#c43e1c" strokeWidth="1.2" /></svg>
            Отменить заявку
          </C1Button>
          <span className="ml-2 truncate text-[12px] text-[#5c5c5c]">
            {selected
              ? `${selected.number} · ${selected.contractor.name} · ${selected.cargo} · ${selected.weightT} т · ${selected.from.name} → ${selected.to.name} · погрузка ${fmt1C(selected.loadingAt)} · окно: ${selected.unloadingWindow}${selected.docs.length ? ` · документы: ${selected.docs.join(', ')}` : ''}`
              : 'Выберите заявку в списке — правила 5.3: готовность · грузоподъёмность · кузов'}
          </span>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 border-b border-[#e5e5e5] bg-[#fafafa] px-3 py-1.5 text-[12px] lg:grid-cols-4">
          <div><span className="text-[#8a8a8a]">Заказчик: </span>{selected?.contractor.name ?? '—'}</div>
          <div><span className="text-[#8a8a8a]">Груз: </span>{selected ? `${selected.cargo} · ${selected.weightT} т` : '—'}</div>
          <div><span className="text-[#8a8a8a]">Погрузка: </span>{selected ? fmt1C(selected.loadingAt) : '—'}</div>
          <div><span className="text-[#8a8a8a]">Окно выгрузки: </span>{selected?.unloadingWindow ?? '—'}</div>
        </div>

        <div className="c1-scroll min-h-0 flex-1 overflow-auto">
          <table className="c1-table">
            <thead>
              <tr>
                <th className="w-[26px] px-0" />
                <th className="w-[150px]">Транспортное средство</th>
                <th className="w-[90px]">Тип</th>
                <th className="w-[90px]">Кузов</th>
                <th className="w-[70px]">Груз, т</th>
                <th className="w-[110px]">Готовность</th>
                <th>Оценка правилами 5.3</th>
              </tr>
            </thead>
            <tbody>
              {selected ? (
                candidates.map(({ v, issues }) => {
                  const ok = issues.length === 0
                  return (
                    <tr
                      key={v.id}
                      className={cn(vehicleId === v.id && 'c1-row-sel', !ok && 'text-[#a2a2a2]')}
                      onClick={() => ok && setVehicleId(v.id)}
                    >
                      <td className="px-1 text-center">
                        {ok ? (
                          <svg width="13" height="13" viewBox="0 0 14 14" className="mx-auto"><circle cx="7" cy="7" r="6" fill="#dff0df" stroke="#2f8a2f" strokeWidth="1" /><path d="M4 7.2l2 2 4-4.4" stroke="#2f8a2f" strokeWidth="1.4" fill="none" /></svg>
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 14 14" className="mx-auto"><circle cx="7" cy="7" r="6" fill="#f7d8da" stroke="#c43e1c" strokeWidth="1" /><path d="M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8" stroke="#c43e1c" strokeWidth="1.3" /></svg>
                        )}
                      </td>
                      <td>{v.model} · {v.plate}</td>
                      <td>{KIND_RU[v.kind] ?? v.kind}</td>
                      <td>{BODY_RU[v.bodyType] ?? v.bodyType}</td>
                      <td>{v.capacityT}</td>
                      <td>{v.readiness === 'ready' ? 'готов' : v.readiness === 'repair' ? 'ремонт' : 'обслуживание'}</td>
                      <td className={ok ? 'text-[#2f7a36]' : 'text-[#c43e1c]'}>{ok ? 'подходит под рейс' : issues.join('; ')}</td>
                    </tr>
                  )
                })
              ) : (
                <tr><td colSpan={7} className="py-6 text-center text-[12px] text-[#8a8a8a]">ТС не отбираются — заявка не выбрана</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Подбор прицепа и водителя + сообщения сервера */}
        <div className="shrink-0 border-t border-[#e5e5e5] bg-[#fafafa] px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="c1-label">Прицеп:</span>
            <C1Select
              className="w-[210px]"
              value={trailerId}
              onChange={setTrailerId}
              placeholder="Без прицепа"
              disabled={!selected}
              options={(trailersData?.rows ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: `${t.model} · ${t.plate} (${BODY_RU[t.type] ?? t.type})` }))}
            />
            <span className="c1-label">Водитель:</span>
            <C1Select
              className="w-[260px]"
              value={driverId}
              onChange={setDriverId}
              placeholder="Из справочника водителей"
              disabled={!selected}
              options={(driversData?.rows ?? []).filter((d) => d.isActive).map((d) => ({
                value: d.id,
                label: d.fullName + (busyDriverIds.has(d.id) ? ' · занят в рейсе' : ''),
                disabled: busyDriverIds.has(d.id),
              }))}
            />
            <span className="text-[11px] text-[#8a8a8a]">
              Назначение — одна транзакция: ASSIGNED → рейс + точки маршрута → записи плана обмена → SystemNote водителю
            </span>
          </div>
          {serverErrors.length > 0 && (
            <div className="mt-2 rounded-[3px] border border-[#e3b8b8] bg-[#fdf1f1] px-3 py-1.5 text-[12px] text-[#c43e1c]">
              <div className="font-semibold">Документ не проведён (аналог сообщений 1С):</div>
              {serverErrors.map((e, i) => (
                <div key={i}>• {e}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Диалог отмены (стиль 1С сохраняем shadcn-ом) */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Отмена заявки {cancelTarget?.number}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Причина (справочник причин)</label>
            <C1Select
              className="w-full"
              value={cancelReason}
              onChange={setCancelReason}
              options={CANCEL_REASONS.map((r) => ({ value: r, label: r }))}
            />
          </div>
          <DialogFooter>
            <C1Button onClick={() => setCancelOpen(false)}>Не отменять</C1Button>
            <C1Button onClick={() => void cancel()}>Отменить с причиной</C1Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

```tsx
// src/components/workspace/RequestsScreen.tsx
'use client'

// Рабочее место сбыта — форма «Заказы грузоотправителей» с деревом заказов и
// нижней панелью «Путевые листы» (имитация формы 1С из скриншота «Учет металла»).

import { Fragment, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { C1Button, C1Checkbox, C1Input, C1Select, FormTitleBar } from '@/components/1c/kit'
import { apiPost } from './api'
import { usePoll } from './usePoll'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { REQUEST_STATUSES, STATUS_LABELS } from '@/lib/1c/statuses'

type Catalog = { rows: { id: string; name: string; address?: string }[] }
type RequestRow = {
  id: string
  number: string
  status: string
  contractor: { name: string }
  cargo: string
  weightT: number
  from: { name: string }
  to: { name: string }
  loadingAt: string
  unloadingWindow: string
  docs: string[]
  vehicle: { model: string; plate: string } | null
  driver: { fullName: string } | null
  assignedBy: string | null
  closeReason: string | null
}
type TripRow = {
  number: string
  status: string
  contractor: { name: string }
  cargo: string
  weightT: number
  from: { name: string }
  to: { name: string }
  loadingAt: string
  unloadingWindow: string
  vehicle: { model: string; plate: string } | null
  trailer: { model: string; plate: string } | null
  driver: { fullName: string } | null
}

const fmtT = (t: number): string =>
  new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(t)

const fmtDateOnly = (iso: string): string => {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// квадрат сворачивания дерева 1С: ⊖ / ⊕
function TreeIcon({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" className="shrink-0">
      <rect x="0.5" y="0.5" width="10" height="10" rx="1.5" fill="#fff" stroke="#7a9cc0" />
      <path d="M2.5 5.5h6" stroke="#2f6db0" strokeWidth="1.2" />
      {!open && <path d="M5.5 2.5v6" stroke="#2f6db0" strokeWidth="1.2" />}
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="#2f7a36" strokeWidth="1.6" /></svg>
  )
}

export function RequestsScreen({ onClose }: { onClose?: () => void }) {
  const { data, reload } = usePoll<{ requests: RequestRow[]; counts: Record<string, number> }>('/api/office/requests')
  const { data: contractors } = usePoll<Catalog>('/api/office/catalog/contractors')
  const { data: locations } = usePoll<Catalog>('/api/office/catalog/locations')
  const { data: tripsData } = usePoll<{ trips: TripRow[] }>('/api/office/trips')

  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [period, setPeriod] = useState<'today' | 'all'>('today')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [onlyActiveSheets, setOnlyActiveSheets] = useState(false)

  // отбор по периоду (как «Период: Сегодня» в шапке формы 1С)
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
  const rows = useMemo(() => {
    const all = data?.requests ?? []
    return all
      .filter((r) => (period === 'today' ? new Date(r.loadingAt) >= startOfDay : true))
      .filter((r) => statusFilter === 'ALL' || r.status === statusFilter)
  }, [data, statusFilter, period, startOfDay])

  // агрегаты шапки отбора: число машин/рейсов, вес по видам продукции
  const agg = useMemo(() => {
    let machines = 0, tripsCount = 0, sheetCount = 0
    const byKind = { прокат: 0, катанка: 0, прочее: 0 }
    for (const r of rows) {
      const c = r.cargo.toLowerCase()
      const key = c.includes('прокат') ? 'прокат' : c.includes('катанк') || c.includes('мото') ? 'катанка' : 'прочее'
      byKind[key] += r.weightT
      if (r.vehicle) { machines += 1; tripsCount += 1 }
    }
    const trips = tripsData?.trips ?? []
    sheetCount = trips.filter((t) => (onlyActiveSheets ? !['DONE', 'CANCELLED'].includes(t.status) : true)).length
    return { machines, tripsCount, byKind, sheetCount }
  }, [rows, tripsData, onlyActiveSheets])

  // дерево: контрагент → заявка (спецификация) → пункт разгрузки
  const groups = useMemo(() => {
    const map = new Map<string, RequestRow[]>()
    for (const r of rows) {
      const arr = map.get(r.contractor.name) ?? []
      arr.push(r)
      map.set(r.contractor.name, arr)
    }
    return [...map.entries()]
  }, [rows])

  const totals = useMemo(() => {
    const start = rows.reduce((s, r) => s + r.weightT, 0)
    const out = rows.filter((r) => r.vehicle).reduce((s, r) => s + r.weightT, 0)
    return { start, out, rest: start - out }
  }, [rows])

  function toggle(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function create(form: FormData) {
    setSaving(true)
    try {
      const docs = String(form.get('docs') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await apiPost<{ request: { number: string } }>('/api/office/requests', {
        contractorId: form.get('contractorId'),
        cargo: form.get('cargo'),
        weightT: Number(form.get('weightT')),
        fromLocationId: form.get('fromLocationId'),
        toLocationId: form.get('toLocationId'),
        loadingAt: new Date(String(form.get('loadingAt'))).toISOString(),
        unloadingWindow: form.get('unloadingWindow'),
        docs,
        actor: 'Логист',
      })
      toast.success(`Заявка ${res.request.number} создана — статус DISPATCH`)
      setOpen(false)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка создания')
    } finally {
      setSaving(false)
    }
  }

  const sheets = (tripsData?.trips ?? []).filter((t) => (onlyActiveSheets ? !['DONE', 'CANCELLED'].includes(t.status) : true))

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <FormTitleBar title="Заказы грузоотправителей" onClose={onClose} />

      {/* Строка отбора (шапка формы 1С) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2.5 py-1.5">
        <span className="c1-label">Период:</span>
        <C1Select
          className="w-[130px] !border-[#ffc94d]"
          value={period}
          onChange={(v) => setPeriod(v as 'today' | 'all')}
          options={[
            { value: 'today', label: 'Сегодня' },
            { value: 'all', label: 'Все время' },
          ]}
        />
        <span className="c1-label">Транспортная компания:</span>
        <C1Select className="w-[180px]" value="" onChange={() => {}} options={[{ value: '', label: 'АЗМЗ ООО' }]} disabled />
        <span className="c1-label">Число машин:</span>
        <span className="c1-input inline-flex w-[46px] items-center justify-end bg-[#fbfbfb]">{agg.machines}</span>
        <span className="c1-label">Число рейсов:</span>
        <span className="c1-input inline-flex w-[46px] items-center justify-end bg-[#fbfbfb]">{agg.tripsCount}</span>
        <span className="c1-label">Вес машин:</span>
        <span className="c1-label text-[#1c1c1c]">Прокат:</span>
        <span className="c1-input inline-flex w-[86px] items-center justify-end bg-[#fbfbfb]">{fmtT(agg.byKind.прокат)}</span>
        <span className="c1-label text-[#1c1c1c]">Катанка:</span>
        <span className="c1-input inline-flex w-[86px] items-center justify-end bg-[#fbfbfb]">{fmtT(agg.byKind.катанка)}</span>
        <span className="c1-label text-[#1c1c1c]">Прочее:</span>
        <span className="c1-input inline-flex w-[86px] items-center justify-end bg-[#fbfbfb]">{fmtT(agg.byKind.прочее)}</span>
      </div>

      {/* Командная панель формы */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2 py-1">
        <C1Button className="!h-[24px]" title="Обновить список" onClick={() => reload()}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12 7a5 5 0 11-1.5-3.6M12 1.5V5H8.5" stroke="#2f6db0" strokeWidth="1.3" strokeLinecap="round" /></svg>
          Обновить
        </C1Button>
        <C1Button className="!h-[24px]" onClick={() => setOpen(true)}>
          <PlusIcon />
          Создать заказ
        </C1Button>
        <span className="c1-label ml-2">Статус продукции:</span>
        <C1Select
          className="w-[210px]"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[{ value: 'ALL', label: '(все статусы)' }, ...REQUEST_STATUSES.map((s) => ({ value: s, label: `${STATUS_LABELS[s]} (${data?.counts[s] ?? 0})` }))]}
        />
        <C1Button className="!h-[24px] !px-2" title="Сбросить отбор" onClick={() => setStatusFilter('ALL')}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="#c43e1c" strokeWidth="1.4" /></svg>
        </C1Button>
        <span className="ml-auto text-[11px] text-[#8a8a8a]">Зеленая строка — заказ вывозится (есть ТС); итоги по контрагентам — голубые</span>
      </div>

      {/* Дерево заказов */}
      <div className="c1-scroll min-h-[160px] flex-1 overflow-auto">
        <table className="c1-table">
          <thead>
            <tr>
              <th className="w-[26px] min-w-[26px] px-0" />
              <th className="min-w-[300px]">Контрагент / Заказ / Пункт разгрузки</th>
              <th className="min-w-[180px]">Номенклатура</th>
              <th className="min-w-[130px]">Комментарий</th>
              <th className="min-w-[130px]">Грузополучатель</th>
              <th className="min-w-[190px]">Заказ ТС</th>
              <th className="w-[100px] text-right">На начало</th>
              <th className="w-[100px] text-right">На вывоз</th>
              <th className="w-[100px] text-right">Остаток</th>
            </tr>
          </thead>
          <tbody>
            {/* Общий итог — жёлтая строка, как в 1С */}
            <tr className="c1-row-yellow font-semibold">
              <td />
              <td>Общий итог:</td>
              <td /><td /><td /><td />
              <td className="text-right">{fmtT(totals.start)}</td>
              <td className="text-right">{fmtT(totals.out)}</td>
              <td className="text-right">{fmtT(totals.rest)}</td>
            </tr>

            {groups.map(([name, list]) => {
              const isOpen = !collapsed.has(name)
              const gStart = list.reduce((s, r) => s + r.weightT, 0)
              const gOut = list.filter((r) => r.vehicle).reduce((s, r) => s + r.weightT, 0)
              return (
                <Fragment key={`grp-${name}`}>
                  {/* Контрагент — голубая (циан) строка группы */}
                  <tr key={`g-${name}`} className="c1-row-cyan font-semibold" onClick={() => toggle(name)}>
                    <td className="px-1 text-center"><TreeIcon open={isOpen} /></td>
                    <td>{name}</td>
                    <td /><td /><td /><td />
                    <td className="text-right">{fmtT(gStart)}</td>
                    <td className="text-right">{fmtT(gOut)}</td>
                    <td className="text-right">{fmtT(gStart - gOut)}</td>
                  </tr>
                  {isOpen &&
                    list.map((r) => {
                      const dispatched = Boolean(r.vehicle)
                      return (
                        <Fragment key={`ord-${r.id}`}>
                          {/* Заявка (спецификация) */}
                          <tr key={`o-${r.id}`}>
                            <td className="px-1 text-center">
                              <svg width="11" height="11" viewBox="0 0 11 11" className="mx-auto">
                                <rect x="0.5" y="0.5" width="10" height="10" rx="1.5" fill="#fff" stroke="#c9c9c9" />
                                <path d="M2.5 5.5h6" stroke="#9ab4cc" strokeWidth="1.2" />
                              </svg>
                            </td>
                            <td style={{ paddingLeft: 26 }}>
                              <span className="c1-link">Заявка {r.number}</span>
                              <span className="text-[#8a8a8a]"> от {fmtDateOnly(r.loadingAt)}</span>
                            </td>
                            <td /><td />
                            <td>{r.to.name}</td>
                            <td>{r.vehicle ? `Заказ на ТС ${r.number} · ${r.vehicle.plate}` : ''}</td>
                            <td className="text-right">{fmtT(r.weightT)}</td>
                            <td className="text-right">{dispatched ? fmtT(r.weightT) : '\u2013'}</td>
                            <td className="text-right">{dispatched ? '0,000' : fmtT(r.weightT)}</td>
                          </tr>
                          {/* Пункт разгрузки — зеленая строка, если заказ вывозится */}
                          <tr key={`l-${r.id}`} className={cn(dispatched && 'c1-row-green')}>
                            <td />
                            <td style={{ paddingLeft: 42 }}>{r.to.name}</td>
                            <td>{r.cargo}</td>
                            <td className="text-[#8a8a8a]">{r.unloadingWindow}{r.docs.length ? ` · ${r.docs.join(', ')}` : ''}</td>
                            <td>{r.to.name}</td>
                            <td>{r.driver ? `${r.driver.fullName}` : ''}</td>
                            <td /><td />
                            <td className="text-right">{fmtT(r.weightT)}</td>
                          </tr>
                        </Fragment>
                      )
                    })}
                </Fragment>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-[12px] text-[#8a8a8a]">Заказов по отбору нет — нажмите «Создать заказ»</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Разделитель + панель «Путевые листы» */}
      <div className="c1-splitter shrink-0" />
      <div className="flex min-h-[200px] shrink-0 flex-col overflow-hidden" style={{ height: 264 }}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[#d4d4d4] bg-[#f2f2f2] px-2 py-1.5">
          <C1Button className="!h-[25px]" title="Обновить путевые листы" onClick={() => reload()}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12 7a5 5 0 11-1.5-3.6M12 1.5V5H8.5" stroke="#2f6db0" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </C1Button>
          <C1Button accent className="!h-[27px] !text-[13px]">
            <svg width="9" height="11" viewBox="0 0 9 11"><path d="M1 1l7 4.5L1 10z" fill="#4a2f00" /></svg>
            «Путевые листы»
          </C1Button>
          <C1Button className="!h-[25px]">
            <PlusIcon />
            Добавить
          </C1Button>
          <span className="c1-label">Дата путевого листа:</span>
          <C1Input type="date" className="w-[130px]" />
          <span className="c1-label">Машины:</span>
          <span className="c1-input inline-flex w-[40px] items-center justify-end bg-[#fbfbfb]">{sheets.length}</span>
          <span className="c1-label">Кол-во:</span>
          <span className="c1-input inline-flex w-[86px] items-center justify-end bg-[#fbfbfb]">
            {fmtT(sheets.reduce((s, t) => s + (t.weightT ?? 0), 0))}
          </span>
          <span className="text-[12px] font-semibold text-[#c43e1c]">Контактное лицо: 8 (927) 385-68-18 Игорь Попов</span>
          <C1Checkbox className="ml-auto" checked={onlyActiveSheets} onChange={setOnlyActiveSheets} label="Не выполненные" />
        </div>

        <div className="c1-scroll min-h-0 flex-1 overflow-auto">
          <table className="c1-table">
            <thead>
              <tr>
                <th className="w-[34px] text-center">№/№</th>
                <th className="w-[24px] px-0" />
                <th className="w-[80px]">Дата док.</th>
                <th className="w-[80px]">Дата выг.</th>
                <th className="w-[110px]">Транспортная компания</th>
                <th className="w-[100px]">Номер ТС</th>
                <th className="w-[90px]">Прицеп</th>
                <th className="min-w-[150px]">Водитель</th>
                <th className="min-w-[140px]">Контрагент</th>
                <th className="min-w-[150px]">Спецификация</th>
                <th className="min-w-[160px]">Пункт разгрузки</th>
                <th className="min-w-[150px]">Продукция</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((t, i) => (
                <tr key={t.number}>
                  <td className="text-center">{i + 1}</td>
                  <td className="px-1 text-center">
                    <svg width="12" height="12" viewBox="0 0 12 12" className="mx-auto"><path d="M1.5 6.5L4.5 9.5 10.5 2.5" stroke="#2f8a2f" strokeWidth="1.5" fill="none" /></svg>
                  </td>
                  <td>{fmtDateOnly(t.loadingAt)}</td>
                  <td className="max-w-[120px]">{t.unloadingWindow}</td>
                  <td>АЗМЗ ООО</td>
                  <td>{t.vehicle?.plate ?? '—'}</td>
                  <td>{t.trailer?.plate ?? ''}</td>
                  <td>{t.driver?.fullName ?? '—'}</td>
                  <td>{t.contractor.name}</td>
                  <td>Заказ на ТС {t.number}</td>
                  <td>{t.to.name}</td>
                  <td>{t.cargo}</td>
                </tr>
              ))}
              {sheets.length === 0 && (
                <tr><td colSpan={12} className="py-6 text-center text-[12px] text-[#8a8a8a]">Путевых листов нет — рейсы создаются при проведении заявки в диспетчерской</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Диалог создания заказа (форма документа 1С) */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Новая заявка на перевозку (Заказ грузоотправителя)</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void create(new FormData(e.currentTarget))
            }}
            className="grid gap-3"
          >
            <div className="grid gap-1.5">
              <label className="c1-label">Заказчик</label>
              <select name="contractorId" required className="c1-select w-full">
                <option value="" disabled>Из справочника контрагентов</option>
                {(contractors?.rows ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <label className="c1-label">Груз (номенклатура)</label>
              <C1Input name="cargo" required placeholder="Пруток 2ф-МД-12х6700-ОМ1-А800" className="w-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className="c1-label">Вес, т</label>
                <C1Input name="weightT" type="number" step="0.1" min="0.1" required defaultValue="10" />
              </div>
              <div className="grid gap-1.5">
                <label className="c1-label">Погрузка</label>
                <input name="loadingAt" type="datetime-local" required className="c1-input w-full" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className="c1-label">Погрузка из</label>
                <select name="fromLocationId" required className="c1-select w-full">
                  <option value="" disabled>Пункт</option>
                  {(locations?.rows ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <label className="c1-label">Выгрузка в</label>
                <select name="toLocationId" required className="c1-select w-full">
                  <option value="" disabled>Пункт</option>
                  {(locations?.rows ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="c1-label">Окно выгрузки</label>
              <C1Input name="unloadingWindow" placeholder="сегодня 14:00–16:00" defaultValue="по согласованию" className="w-full" />
            </div>
            <div className="grid gap-1.5">
              <label className="c1-label">Документы для фотофиксации (через запятую)</label>
              <textarea name="docs" rows={2} placeholder="ТТН (2 экз.), Паспорт груза, Пропуск на терминал" className="c1-input h-auto w-full py-1" />
            </div>
            <DialogFooter>
              <C1Button onClick={() => setOpen(false)}>Отмена</C1Button>
              <C1Button type="submit" accent disabled={saving}>{saving ? 'Проведение…' : 'Создать'}</C1Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

Остальные экраны (Dashboard/Trips/Chat/Catalogs/Journal/Demo, OneCShell, kit, badges, usePoll, api) — чистая презентация + fetch-вызовы к контрактам Части 3; тела в архиве `kontur-1c-handoff.zip`.

## ЧАСТЬ 5 — ПРОВЕРЕНО / НЕ ПРОВЕРЕНО / ПРОБЕЛЫ

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

## ЧАСТЬ 6 — ФАЙЛЫ

Этот пакет сохранён в корень проекта: `/home/z/my-project/HANDOFF.md`.
Архив со всем проектом (без `node_modules` и `.next`, с HANDOFF.md внутри): `/home/z/my-project/download/kontur-1c-handoff.zip`.
Копия пакета для прямой отдачи: `/home/z/my-project/download/HANDOFF.md`.

Восстановление: распаковать архив → `bun install && bun run db:generate && bun run db:push && bun run db:seed` → `bun run dev` (порт 3000) → приёмка `python3 scripts/acceptance.py` (15/15).
