# АЭМЗ Поток — единая логистическая платформа

Монорепозиторий всей системы автоматизации логистики Абинского
металлургического завода: платформа заявок и торгов, кабинет перевозчика,
собственный парк и диспетчерская «Контур 1С», нейропроверка документов,
ЭДО/ЭТрН, интеграция с 1С, модуль водителя (PWA + Android) и публичный
демо-стенд.

**Главный репозиторий и единственный источник истины:**
`https://github.com/vacantrix/LogistikSITE`.

---

## 0. Что лежит в одном репозитории

| Блок | Каталог | Что это |
|---|---|---|
| Платформа «АЭМЗ Поток» | `src/`, `prisma/`, `public/` | Next.js 16: заявки, торги, кабинет перевозчика, сверка документов, реестр рейсов, отчёты, ЭДО, администрирование |
| Диспетчерская «Контур 1С» | `src/app/kontur/`, `src/lib/kontur/` | Собственный парк: заявки 1С/ATI.SU, планирование, рейсы, GPS-мониторинг, маршруты |
| Модуль водителя | `driver/` | PWA `/driver`, API `/api/driver/v1/*`, Android-каркас, локальный стенд «Контура» |
| Android-приложение | `driver/download/azmz-karkas/android/` | Kotlin/Compose/Room/WorkManager/MapLibre, 9 Gradle-модулей |
| OCR | `mini-services/paddle-ocr/`, `mini-services/ocr-service/` | Локальный PaddleOCR на серверах АЭМЗ + шлюз очереди |
| Real-time шина | `mini-services/ws-service/` | socket.io-уведомления платформы |
| ЭДО-стенд | `mini-services/diadoc-mock/` | Имитация Диадока для демо ЭТрН |
| Публикация и эксплуатация | `publish/`, `Caddyfile` | Caddy, gateway, портал, сборка, запуск, статус, APK |
| Android-сборка | `tools/android-build/` | Переносимые скрипты сборки и публикации APK |
| OCR-диагностика | `tools/ocr-probe/` | Ручные пробы распознавания на синтетических образцах |
| Документация | `docs/`, `worklog.md`, `README.md` | Архитектура, модули, развёртывание, история |
| Материалы проекта | `docs/materials/` | Паспорт проекта, презентация, речь |

Модуль водителя перенесён в `driver/` через `git subtree` с полной историей
`vacantrix/Drivemobile`. Отдельный репозиторий `Drivemobile` остаётся
источником-зеркалом, но новые изменения ведутся здесь.

---

## 1. Как устроена система

```
ПОЛЬЗОВАТЕЛИ
  логист / админ · перевозчик · водитель · 1С:ERP · ATI.SU
        │
        ▼
  HTTPS 443 (Caddy, Let's Encrypt TLS-ALPN-01)
        │
        ├── vacantrix.ru                  → портал Vacantrix, каталог, /dl/*
        └── logistiksite.vacantrix.ru     → лендинг + /demo/
              │
              ▼
        gateway 127.0.0.1:8080
              ├── /driver/*, /api/driver/*, /api/1c/*,
              │   /api/2gis/*, /api/mapstyle, /api/maptiles/*,
              │   /api/demo/*, /api/stand/*  → модуль водителя :3102
              └── остальное                  → платформа :3000
                    ├── /kontur/*            → встроенная диспетчерская
                    ├── /api/*               → REST платформы
                    └── SQLite db/combat.db  → платформа + Dispatch*
              │
              ├── real-time шина :3003 (socket.io)
              ├── OCR-шлюз :3020 → PaddleOCR :3031 (только localhost)
              └── Диадок-мок :3040 (стенд ЭДО)
```

### Порты production-контура

| Сервис | Порт | Каталог | Назначение |
|---|---:|---|---|
| Платформа | 3000 | `src/` | UI платформы, `/kontur`, REST API, Prisma |
| Модуль водителя | 3102 | `driver/` | PWA `/driver`, API водителя, заявки |
| Gateway | 8080 | `publish/landing-server.mjs` | Единый вход для домена демо-стенда |
| Portal auth | 8090 | `publish/portal-auth.mjs` | Регистрация/вход портала Vacantrix |
| Real-time | 3003 | `mini-services/ws-service` | События `platform:update` |
| OCR-шлюз | 3020 | `mini-services/ocr-service` | Очередь, сжатие, таймауты |
| PaddleOCR | 3031 | `mini-services/paddle-ocr` | Нейросеть, только `127.0.0.1` |
| Диадок-мок | 3040 | `mini-services/diadoc-mock` | Статусы ЭТрН на стенде |
| Caddy | 443 / 81 | `publish/Caddyfile.publish` | TLS, маршрутизация, статика |

Автономный стенд модуля (исторический режим `driver/scripts/start-stack.sh`)
поднимает «Контур 1С» на `:3001`, приложение водителя на `:3002` и роутер на
`:3000`. В production он не используется: диспетчерская встроена в платформу,
а модуль водителя работает под `basePath: /driver` на `:3102`.

### Основные сценарии

1. **Заявка и торги.** Логист публикует заявку (FIXED/AUCTION/CLOSED),
   перевозчик делает ставку или забирает фикс, логист назначает победителя.
2. **Документы.** Перевозчик загружает паспорт, регистрацию, ВУ, СТС, М-2.
   Платформа сжимает фото, отправляет в OCR-шлюз, PaddleOCR читает поля,
   `src/lib/verify.ts` сверяет их с заявкой и выносит вердикт.
3. **Собственный парк.** «Контур 1С» принимает заявки из 1С/ATI.SU, проводит
   их, назначает водителя и ТС, строит рейс и маршрут, ведёт GPS-мониторинг.
4. **Маршрут офиса.** Логист вставляет ссылку Яндекс.Карт; платформа сохраняет
   точную геометрию `rtext`, километраж и время и автоматически доставляет
   маршрут водителю в PWA и APK.
5. **Рейс водителя.** Водитель видит только свой модуль: заявку, маршрут,
   отметки, топливо, чат, GPS. Входящие приходят long-poll, исходящие — сразу;
   при обрыве работает персистентная офлайн-очередь.
6. **ЭДО и 1С.** Реестр рейсов и ЭТрН уходят в 1С; Диадок подписывает титул Т1;
   статусы и уведомления возвращаются в платформу.

---

## 2. Быстрый старт

### 2.1. Production-контур на Windows (как на стенде)

Требования: Windows 10/11, Node.js 20+, Bun (для зависимостей платформы),
PostgreSQL не нужен — SQLite. Для OCR — Python 3.10+ и PaddleOCR.

```powershell
git clone https://github.com/vacantrix/LogistikSITE.git
cd LogistikSITE

# 1. Зависимости платформы
bun install

# 2. Секреты: скопировать .env.example -> .env.local и заполнить
#    DATABASE_URL, AUTH_SECRET, ONEC_API_KEY, OCR_*, DIADOC_* (см. .env.example)

# 3. База платформы (db/combat.db) и учётные записи
npm run db:push
npm run db:generate
npm run auth:seed

# 4. Сборка платформы (standalone) и модуля водителя
powershell -NoProfile -ExecutionPolicy Bypass -File publish\build-public.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File publish\build-driver.ps1

# 5. APK: собрать (нужен Android SDK) и опубликовать
powershell -NoProfile -ExecutionPolicy Bypass -File tools\android-build\build-apk.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File publish\publish-apk.ps1

# 6. Запуск всего стека и проверка
powershell -NoProfile -ExecutionPolicy Bypass -File publish\start-all.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File publish\status.ps1
```

`start-all.ps1` проверяет целостность сборки по `publish/build-manifest.json`,
поднимает OCR, WS, платформу, модуль водителя, gateway, портал и Caddy, затем
печатает адреса. Остановка — `publish\stop-all.ps1`.

### 2.2. Разработка

```bash
bun run dev                 # платформа :3000
```

У модуля водителя `basePath: /driver`, поэтому в разработке он запускается на
отдельном порту и проксируется gateway:

```powershell
cd driver
npx next dev -p 3102
```

Real-time шина: `npm run ws` (порт 3003). OCR-шлюз:
`cd mini-services/ocr-service && bun install && bun run dev` (3020).
PaddleOCR: `cd mini-services/paddle-ocr && .venv\Scripts\python server.py`
(3031) или `start-service.ps1`.

---

## 3. Модуль водителя

| Что | Адрес |
|---|---|
| PWA | `https://logistiksite.vacantrix.ru/driver` |
| APK | `https://logistiksite.vacantrix.ru/dl/Drivemobile.apk` |
| API | `https://logistiksite.vacantrix.ru/api/driver/v1/*` |
| Заявки | `/api/1c/orders` с заголовком `X-Driver-Id` |

**Изоляция.** Водитель видит только свой модуль. Внутри Next.js модуль живёт
под `basePath: /driver`; gateway проксирует `/driver/*`, `/api/driver/*`,
`/api/1c/*`, `/api/2gis/*`, `/api/mapstyle`, `/api/maptiles/*`, `/api/demo/*`,
`/api/stand/*` на `127.0.0.1:3102`. Платформа остаётся единственной точкой
входа, отдельного домена и отдельного входа у водителя нет.

**Мгновенная синхронизация.**
- `sync/wait` — long-poll до 25 с, отвечает сразу после записи в журнал;
- `sync/push` — действия водителя уходят сразу (идемпотентно);
- `sync/pull` — журнал по курсору, до 500 записей за цикл;
- резервный polling каждые 15 с; заявки — 5 с, пробки — 12 с, GPS — 5 с;
- цикл также стартует по `online`, `focus`, `visibilitychange`, `azmz:outbox`.

**Офлайн.** Исходящие сначала попадают в персистентный outbox и досылаются
после восстановления сети; входящие догружаются по курсору. PWA держит
офлайн-оболочку service worker `aemz-driver-v10` (scope `/driver`,
`Service-Worker-Allowed: /driver`, `offline.html`). В APK работают foreground-
цикл `SyncEngine` и фоновая страховка WorkManager.

**Маршрут офиса.** Платформа разбирает ссылку Яндекс.Карт (`rtext`), забирает
точную геометрию со страницы (`routerResponse.routes[0]`), сохраняет
`routeGeometry`, `routeWaypoints`, `routeDistanceM`, `routeDurationS` и
отправляет снимок рейса в журнал водителя. PWA строит линию из `routeCoords`,
APK — из `routeGeoJson`. Если страница Яндекса недоступна, OSRM строит линию
через те же точки; в интерфейсе честно указано «линия по точкам». Офисная
линия приоритетнее OSRM: при `routeSource=yandex` OSRM не подменяет маршрут.
MapLibre worker отдаётся по `/driver/maplibre-gl-worker.mjs`.

**APK.** `ru.azmz.logistics.driver`, `0.3.2-pilot`, versionCode 6, minSdk 26,
targetSdk 34. Актуальный файл — `driver/download/azmz-driver.apk` (38 119 513
байт, SHA-256 `F90722580DF6EC1857491B88B94E34FC26861B780A6D6A325722F7C62980C953`).
Сборка — `tools/android-build/build-apk.ps1`; CI — `.github/workflows/android-apk.yml`.

Подробно: [docs/modules/driver.md](docs/modules/driver.md).

---

## 4. «Контур 1С» и собственный парк

В production диспетчерская — это маршрут `/kontur` внутри платформы:
заявки из 1С и ATI.SU, планирование, занятость, рейсы, мониторинг GPS,
справочники, журнал, отчёты. Таблицы лежат в `db/combat.db` с префиксом
`Dispatch*` (схема `prisma/kontur.prisma`).

В `driver/kontur-1c/` остаётся автономная версия «Контура» для локального
стенда и истории. Она не является production-путём, но полностью собирается
и позволяет поднять стек `:3001` + `:3002` + роутер `:3000` без платформы.

Подробно: [docs/modules/kontur-1c.md](docs/modules/kontur-1c.md).

---

## 5. Нейропроверка документов

```
фото → платформа (sharp, 2400 px / JPEG 92%) → OCR-шлюз :3020
     → PaddleOCR :3031 (PP-OCRv5/v6, только localhost)
     → поля + уверенности → src/lib/verify.ts → вердикт
```

- очередь общая для всех пользователей, одновременно — не больше
  `nnParallel` фото (настройка под VRAM);
- кэш повторов по хэшу, таймауты, сжатие и повторные проходы;
- вердикты: `PASSED`, `REUPLOAD`, `REJECTED`, `MANUAL`;
- сканы хранятся на серверах АЭМЗ, облачных моделей нет;
- `tools/ocr-probe/` — ручные пробы на синтетических образцах, без реальных
  персональных данных.

Подробно: [docs/modules/ocr.md](docs/modules/ocr.md).

---

## 6. 1С и ЭДО

- REST-шина 1С: `/api/integration/1c/*`, ключ `ONEC_API_KEY` (сравнение за
  постоянное время), CORS только для разрешённых origin.
- Модули формы и симулятор — `docs/1c/`.
- ЭТрН: Диадок, титул Т1, статусы `SENT`/`SIGNED`; на стенде —
  `mini-services/diadoc-mock`.
- Реестр рейсов, статусы и уведомления возвращаются в 1С.

Подробно: [docs/integrations/1c.md](docs/integrations/1c.md).

---

## 7. Безопасность

- Секреты — только в `.env` / `.env.local`, не в git. В репозитории есть
  `.env.example` без значений.
- Пароли — scrypt-хеши; сессия — подписанная HttpOnly-кука + Bearer.
- Гранулярные права `section:*` и `own:*`; проверка на сервере, не только в UI.
- Файлы и сканы — по токену с проверкой доступа, без публичных ссылок.
- OCR-шлюз и PaddleOCR слушают только `127.0.0.1`; наружу — Caddy.
- В git не попадают runtime-БД, `upload/`, логи, модели, venv, `node_modules`,
  реальные паспорта и ключи. Демо-пароли стенда помечены как демонстрационные.
- APK подписан debug-ключом (пилот); для production нужна отдельная подпись.

Подробно: [docs/security.md](docs/security.md).

---

## 8. Структура монорепозитория

```text
LogistikSITE/
├── src/                          платформа Next.js + встроенный /kontur
├── prisma/                       schema.prisma + kontur.prisma
├── public/                       статика платформы
├── mini-services/
│   ├── ocr-service/              OCR-шлюз :3020
│   ├── paddle-ocr/               PaddleOCR :3031 + start-service.ps1
│   ├── ws-service/               real-time :3003
│   └── diadoc-mock/              ЭДО-стенд :3040
├── publish/                      Caddy, gateway, портал, сборка, запуск, статус
├── driver/                       модуль водителя (subtree, полная история)
│   ├── src/                      PWA и API водителя
│   ├── public/                   manifest, sw.js v10, worker MapLibre
│   ├── download/azmz-karkas/     Android-исходники + APK
│   ├── download/azmz-driver.apk  актуальный APK 0.3.2-pilot
│   ├── kontur-1c/                автономный «Контур 1С» (legacy local)
│   └── db/                       demo SQLite модуля
├── tools/
│   ├── android-build/            build-apk.ps1, publish-apk.ps1, CI
│   └── ocr-probe/                ручные OCR-пробы
├── docs/                         архитектура, модули, операции, история
├── .github/workflows/            сборка APK
├── worklog.md                    хронология разработки
└── README.md                     этот файл
```

---

## 9. Документация

| Документ | О чём |
|---|---|
| [docs/README.md](docs/README.md) | индекс всей документации |
| [docs/architecture/system-overview.md](docs/architecture/system-overview.md) | архитектура, потоки, отказоустойчивость |
| [docs/architecture/data-model.md](docs/architecture/data-model.md) | БД платформы, Dispatch, водителя |
| [docs/modules/platform.md](docs/modules/platform.md) | платформа, роли, API |
| [docs/modules/driver.md](docs/modules/driver.md) | PWA/APK, синхронизация, маршруты |
| [docs/modules/kontur-1c.md](docs/modules/kontur-1c.md) | диспетчерская и рейсы |
| [docs/modules/ocr.md](docs/modules/ocr.md) | OCR-конвейер и очередь |
| [docs/integrations/1c.md](docs/integrations/1c.md) | обмен с 1С |
| [docs/integrations/yandex-routes.md](docs/integrations/yandex-routes.md) | точная геометрия Яндекс.Карт |
| [docs/operations/deployment.md](docs/operations/deployment.md) | развёртывание, порты, TLS, автозапуск |
| [docs/operations/troubleshooting.md](docs/operations/troubleshooting.md) | симптомы и решения |
| [docs/operations/backup-restore.md](docs/operations/backup-restore.md) | резервные копии SQLite |
| [docs/development/monorepo.md](docs/development/monorepo.md) | правила монорепозитория |
| [docs/development/build-and-test.md](docs/development/build-and-test.md) | сборка и проверки |
| [docs/security.md](docs/security.md) | безопасность и секреты |
| [docs/history/legacy-and-archive.md](docs/history/legacy-and-archive.md) | старые репозитории и архив |
| [worklog.md](worklog.md) | вся история задач |

---

## 10. Проверенное состояние

На стенде 23–24.11.2026 проверено:

- `publish/status.ps1` — `RESULT: OK`: платформа, gateway, портал, WS, OCR,
  модуль водителя и публичный HTTPS отвечают.
- PWA `/driver` — service worker `aemz-driver-v10`, scope `/driver`;
  маршрут `ЗК-1042` (Абинск → Краснодар) с `routeSource=yandex`, 2 355
  координат, 94 394 м, 5 900 с; карта показывает полную оранжевую линию.
- `DISPATCH`-заявка принимается кнопкой «Взять заявку»; ETA, остаток и
  время в пути пересчитываются по активной линии.
- APK `0.3.2-pilot` (versionCode 6) — 38 119 513 байт, SHA-256
  `F90722580DF6EC1857491B88B94E34FC26861B780A6D6A325722F7C62980C953`.
- `driver` subtree содержит 473 файла и полную историю `Drivemobile`
  до `e7d65ee`.

Ограничение: физический телефон к ADB не подключён, установка APK на
устройстве в этом прогоне не проверялась. Публикация и веб-контур от этого
не зависят.

---

## 11. Лицензия и данные

Внутренний проект АЭМЗ. В репозитории нет реальных персональных данных,
ключей и runtime-баз. Демо-данные (Иванов С. П., ЗК-1042 и т. п.) вымышлены.
