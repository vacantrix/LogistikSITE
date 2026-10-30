# src/app/api/ — REST API платформы

Route Handlers Next.js. Все вызовы клиента — относительные (`/api/...`), сессия —
Bearer-токен или подписанная кука. Права проверяются на сервере (`requireUser`).

## Группы маршрутов

| Маршрут | Методы | Доступ | Назначение |
|---|---|---|---|
| `auth/login · logout · me` | POST/POST/GET | все | вход (Bearer), выход, текущий пользователь |
| `requests` · `requests/[id]` | GET/POST/PATCH | логист, перевозчик, админ | заявки: список, создание, детали, ставки, победа |
| `requests/[id]/verify` | POST | логист, админ, перевозчик-победитель | автопроверка комплекта документов нейросетью |
| `requests/[id]/action` | POST | по действию | assign / publish / take / confirm / close… |
| `requests/[id]/files · documents` | GET/POST | участники | сканы заявки и статусы документов |
| `requests/bulk-assign` | POST | перевозчик (право `crew:assign`) | массовое назначение экипажей |
| `documents/check` | POST | перевозчик | мгновенная проверка одного скана при загрузке |
| `vehicles/intake · drivers/intake` | POST | перевозчик | нейрозаполнение карточек ТС/водителя из сканов |
| `ocr-jobs · ocr/status` | GET | все | реестр долгих распознаваний; статус цепочки OCR |
| `directory · directory/photos · bulk` | CRUD | по правам | справочники водителей/ТС/прицепов |
| `files/[kind]/[id]` | GET | по доступу | выдача сканов по токену, без публичных ссылок |
| `notifications · events` | GET | все | колокольчик, лента журнала |
| `reports · reports/export` | GET/POST | логист, админ | сводные отчёты + DOCX-выгрузка |
| `edo` | GET/POST | логист, админ | ЭТрН: формирование, отправка, Диадок-синк |
| `suggest` | GET | все | подсказки адресов и «кем выдан» |
| `map-tile/[z]/[x]/[y]` | GET | все | тайлы карты доставки (прокси с кэшем) |
| `settings` | GET/PUT | логист, админ | пороги уверенности и правила проверки |
| `admin/nn` | GET/PUT/POST | **админ** | настройки нейросети (пропуск документов), статус, тестовый прогон |
| `admin/files` | GET/PUT | **админ** | файловый проводник: дерево, чтение, сохранение |
| `admin/users · access` | GET/POST | **админ** | учётки, роли, шаблоны доступа |
| `admin/db` | GET/POST | **админ** | просмотр и правка таблиц БД |
| `permissions · profile` | GET/PUT | все | матрица прав, свой профиль |
| `platform-log · /client` | GET/POST | логист+ | техжурнал платформы; клиентские ошибки |
| `support/tickets[/id]` | GET/POST/PATCH | все | обращения и чаты: перевозчик — в поддержку, логист/админ пишут перевозчику первыми (`targetCarrierId`) |
| `support/carriers` | GET | логист, админ | адресаты чатов персонала (компании-перевозчики) |
| `integration/1c/*` | GET/POST | **X-API-Key** (info — по сессии платформы) | шина 1С: ping, dictionaries, requests, etrn, info |
| `architecture/status` | GET | **админ** | живые статусы всех контуров |

## Правила

- Ответы ошибок — `{ error: 'человекочитаемый текст' }` с корректным HTTP-кодом;
  401 → клиент показывает экран входа.
- Каждый маршрут — `export const dynamic = 'force-dynamic'` (SQLite, без кэша).
- Тяжёлая логика — в `src/lib/*`; маршрут остаётся тонким.
- Внешние системы авторизуются заголовками: 1С — `X-API-Key` (`ONEC_API_KEY`),
  OCR-шлюз — `X-OCR-Token` (`OCR_SERVICE_TOKEN`).
