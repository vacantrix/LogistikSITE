# Модуль водителя (`driver/`)

Модуль водителя — отдельное Next.js-приложение, смонтированное в платформу по
`/driver`. Водитель видит только его: заявку, маршрут, отметки, топливо, чат,
GPS. Админки и чужих заявок здесь нет.

| Что | Адрес |
|---|---|
| PWA | `https://logistiksite.vacantrix.ru/driver` |
| APK | `https://logistiksite.vacantrix.ru/dl/Drivemobile.apk` |
| API | `https://logistiksite.vacantrix.ru/api/driver/v1/*` |
| Заявки 1С | `/api/1c/orders` с `X-Driver-Id` |

## 1. Устройство

```
driver/
├── src/app/                 layout, page, API routes
├── src/components/azmz/     экраны: старт, карта, рейс, чат, история, 2ГИС, настройки
├── src/lib/                 store (Zustand), sync, protocol, rules
├── public/                  manifest, sw.js v10, иконки, maplibre-gl-worker.mjs
├── prisma/schema.prisma     Trip, TripPoint, TripEvent, RoadMark, Chat, SyncJournal
├── download/azmz-karkas/    Android-проект (Kotlin/Compose/Room/WorkManager)
├── download/azmz-driver.apk канонический APK
└── kontur-1c/               автономный локальный «Контур» (legacy)
```

`next.config.ts`: `output: "standalone"`, `basePath: "/driver"`,
`Service-Worker-Allowed: /driver`. Снаружи gateway проксирует `/driver/*`,
`/api/driver/*`, `/api/1c/*`, `/api/2gis/*`, `/api/mapstyle`,
`/api/maptiles/*`, `/api/demo/*`, `/api/stand/*` на :3102.

## 2. Экраны

| Экран | Что делает |
|---|---|
| Старт | вход по коду/водителю, статус связи, ближайший рейс |
| Карта | MapLibre, линия маршрута, точки, события, ETA, остаток пути |
| Рейс | заявка, адреса, окна, груз, ТС, кнопки статусов |
| Отметки | дорожные пометки и голосования |
| Чат | переписка с офисом |
| История | завершённые рейсы и события |
| 2ГИС | альтернативный просмотр/поиск (стенд) |
| Настройки | сервер, водитель, GPS, офлайн-очередь, диагностика |

## 3. Синхронизация

Исходящие операции сначала пишутся в персистентный outbox (Zustand +
localStorage в PWA, Room в APK) и только потом уходят в сеть. Входящие — журнал
`SyncJournal` по курсору.

```
каждые 4 с:  outbox → POST /api/driver/v1/sync/push   (батч, идемпотентно по opId)
             GET /api/driver/v1/sync/pull?cursor=N   (до 500 записей)
             GET /api/driver/v1/sync/marks           (дорожные пометки)
long-poll:   GET /api/driver/v1/sync/wait?cursor=N&timeout=25
резерв:      polling каждые 15 с; заявки — 5 с, пробки — 12 с, GPS — 5 с
триггеры:    online, focus, visibilitychange, azmz:outbox
```

- `sync/wait` отвечает сразу после записи в журнал, поэтому входящие приходят
  мгновенно; таймаут 25 с страхует прокси, которые режут длинные запросы.
- `sync/push` идемпотентен: повтор после обрыва не создаёт дубль.
- Курсор двигается только после успешного применения пачки.
- При обрыве сети очередь растёт локально; после `online` досылается сама.

## 4. Офлайн

PWA держит офлайн-оболочку service worker `aemz-driver-v10` (scope `/driver`,
precache главного экрана, `offline.html`, иконок). API service worker не
перехватывает: синхронизация и гео идут напрямую, офлайн-логика — в сторе.

APK: foreground-цикл `SyncEngine` + фоновая страховка WorkManager; данные
лежат в Room, поэтому карта и рейс доступны без сети.

## 5. Маршрут офиса

1. Логист вставляет ссылку Яндекс.Карт в рейс.
2. `src/lib/kontur/yandex-route.ts` разбирает `rtext` и забирает точную
   геометрию со страницы (`routerResponse.routes[0].coordinates`).
3. Платформа сохраняет `routeGeometry`, `routeWaypoints`, `routeDistanceM`,
   `routeDurationS`, `routeSource=yandex`.
4. `driver-bridge.ts` отправляет снимок рейса в журнал водителя (`TRIP`,
   `TRIP_POINT`, `EVENT`).
5. PWA строит линию из `routeCoords`, APK — из `routeGeoJson`.

**Приоритет:** офисная линия Яндекса всегда выше OSRM. При
`routeSource=yandex` OSRM не строится и не подменяет маршрут. Если страница
Яндекса недоступна, OSRM строит линию через те же точки, а интерфейс честно
показывает «линия по точкам».

MapLibre worker отдаётся по `/driver/maplibre-gl-worker.mjs`; без этого
браузер пишет `Worker failed to load`, и линия не рисуется.

## 6. Заявки

`GET /api/1c/orders` с `X-Driver-Id` возвращает доступные водителю заявки.
`DISPATCH`-заявка принимается кнопкой «Взять заявку»; после принятия
появляются ETA, остаток расстояния и время в пути, пересчитанные по активной
линии. Демо-точки и события фильтруются по активному `trip.id`, поэтому чужие
и устаревшие данные на карту не попадают.

## 7. APK

`ru.azmz.logistics.driver`, `0.3.2-pilot`, `versionCode 6`, minSdk 26,
targetSdk 34. Канонический файл — `driver/download/azmz-driver.apk`
(38 119 513 байт, SHA-256
`F90722580DF6EC1857491B88B94E34FC26861B780A6D6A325722F7C62980C953`).
Сборка — `tools/android-build/build-apk.ps1`, публикация —
`publish/publish-apk.ps1`, CI — `.github/workflows/android-apk.yml`.

## 8. Переменные

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `DATABASE_URL` | `file:../db/custom.db` | база модуля |
| `KONTUR_1C_URL` | `http://127.0.0.1:3001/kontur` | источник заявок автономного стенда |
| `KONTUR_DRIVER_URL` | `http://127.0.0.1:3002` | адрес модуля для «Контура» |
| `DRIVER_BRIDGE_URL` | `http://127.0.0.1:3102/driver/api/driver/v1/ingest` | приём рейса из платформы |
| `DRIVER_APP_INGEST_TOKEN` | демо-токен стенда | подпись ingest-запроса |
| `OSRM_BASE_URL` | публичные OSRM | резервная геометрия |

Демо-токен и пароли стенда не являются production-секретами; для боевого
контура задайте свои значения (см. [../security.md](../security.md)).

## 9. Проверка

```powershell
cd driver
npx next build
npx next start -p 3102
# PWA: http://127.0.0.1:3102/driver
```

На стенде проверено: `sw.js` → `aemz-driver-v10`; `sync/pull` отдаёт журнал;
маршрут `ЗК-1042` (Абинск → Краснодар) — `routeSource=yandex`, 2 355
координат, 94 394 м, 5 900 с; карта показывает полную оранжевую линию.
