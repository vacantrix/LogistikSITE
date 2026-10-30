# Аудит синхронизации: файлы ↔ платформа — 30.10.2026

Проверено: карта архитектуры (src/lib/architecture.ts) ↔ реальный код; 19 README-файлов ↔ модули; api.ts ↔ маршруты; журналы платформы; прогон вкладок в браузере. dev.log — 0 ошибок 4xx/5xx. Платформа работает логически корректно: чат обращений в обе стороны (№1, №2), пороги «Настроек» читаются из БД и применяются автопроверкой, NN-настройки с VRAM-семантикой и общей очередью (0/2 в обработке), лимит 20 фото, статусы 6/6 контуров.

## 1. Карта архитектуры ↔ код (были разногласия — исправлены 30.10)
1. api-intake: путь `/api/intake/{driver,vehicle}` не существует → реально `/api/drivers/intake` и `/api/vehicles/intake`.
2. api-perms: `/api/users` не существует (учётки — `/api/admin/users`); не был упомянут `/api/admin/access`.
3. api-files: `/api/files/document/[id]` неполно → реально `/api/files/[kind]/[id]` (kind: document, directory).
4. gateway-caddy: «?XTransformPort → сервис» устарело — наружу пропускается только WS :3003, остальные порты отдают 404 (Caddyfile), внешний порт :81 без HTTPS.
5. realtime-events: события `REQUEST_AWARDED` не существует → реальное `WINNER_AWARDED` (notify-users.ts:36).
6. Интеграция Диадок отсутствовала в карте: mini-services/diadoc-mock (:3040), src/lib/diadoc/*, /api/edo, модели EdoDocument/DiadocState.
7. Внутренний HTTP /notify шины WS (127.0.0.1:3004) не был отражён.
8. БД: не были отражены Ticket/TicketMessage/TicketAttachment и EdoDocument/DiadocState.
9. Не было в карте: /api/settings, /api/edo, /api/support/*, /api/platform-log, /api/reports, /api/admin/{db,users,access}, /api/ocr-jobs, /api/documents/check, /api/map-tile, /api/requests/[id]/* и др.
10. Мелочи desc: ui-apply «12 полей» (в форме 10 полей + 2 фото); api-suggest — подсказки из DaData/OSM, а не «гео-база»; api-onec пропущен /info; «carrier-a…g» — фактически 4 учётки (a, b, v, g); вложения обращений — «суммарно до 10 МБ на обращение».

## 2. README ↔ код (были расхождения — исправлены 30.10)
1. Порт Диадок-мока: README указывал 3080 → реально 3040 (README.md ×2, mini-services/README.md).
2. api/README: bulk-assign выполняет перевозчик (право crew:assign), а не логист; verify доступен и перевозчику-победителю; /api/integration/1c/info требует сессию, а не X-API-Key.
3. ws-service/README: REQUEST_AWARDED → WINNER_AWARDED.
4. src/app/README: instrumentation.ts находится в src/, а не в src/app/.
5. mini-services/README: клиент обращается к мини-сервисам только через WS-прокси :3003 (остальные порты закрыты шлюзом).
6. prisma/README: SEED_PASSWORD нигде не задан (демо-пароль задаётся NEXT_PUBLIC_DEMO_PASSWORD в .env).
7. src/lib/README: отсутствовал tickets.ts; api/README: отсутствовал admin/db.
8. README.md: «HTTPS» → шлюз слушает :81 по HTTP (стенд); «carrier-a…g» → carrier-a/b/v/g.
9. paddle-ocr/README: противоречие «модели ~200 МБ» vs «~105 МБ» (в песочнице модели не скачаны — NN на отдельном стенде, проверить фактический размер нечем; оставлено примечание).
10. download/README.md — англоязычная заглушка «Here are all the generated files.» — переписана по-русски с описанием содержимого.

## 3. Мусор
1. src/app/api/route.ts — boilerplate «Hello, world!», ничего не использует — УДАЛЁН 30.10.
2. download/ — 3 демо-скриншота прошлых задач (task5-directories.png, task6-logist2.png, task6-mobile-carrier.png) — кандидат на очистку, виден в файловом проводнике; пока оставлены, README приведён в порядок.
3. .zscripts/*.log, dev.pid, tool-results/ — служебные артефакты песочницы; от файлового проводника скрыты (EXCLUDED_DIRS) — не мусор в контексте стенда.
4. tests/*.sh (database-runtime-build.sh, python-runtime-*.sh) — копии инфраструктурных скриптов песочницы внутри tests/ — сомнительное место, отмечено на будущее.
5. Журнал платформы, разовое: «Uncaught ReferenceError: FileCheck2 is not defined» (30.10, 05:49) — артефакт горячей перезагрузки во время правки; все импорты FileCheck2 в коде корректны (status-pipeline.tsx:16, notification-bell.tsx:16, my-requests.tsx:13), не воспроизводится — действий не требует.
6. Журнал, 2 ошибки OCR 05:46/05:51 (Z-1048, bulk1.png/scan3.png): транзиентный недоступность узла распознавания во время e2e-теста; сейчас узел отвечает ~740 мс, документы доступны кнопке «Отправить на проверку» повторно — действий не требует.

## 4. Синхронизация подтверждена (работает корректно)
- api.ts ↔ маршруты: все вызовы клиента существуют на сервере (включая /api/ocr-jobs, /api/documents/check, /api/drivers|vehicles/intake, /api/support/*, /api/admin/*, /api/edo, /api/files).
- Вкладки: все 18 разделов рендерятся, живые статусы 6/6.
- Обращения: созданы чаты №1 и №2, статусы OPEN/ANSWERED переключаются сообщениями сторон, уведомления уходят, вложения 10 МБ.
- Вкладка «Настройки»: пороги 0.6/0.6/0.95/60 совпадают с DEFAULT_SETTINGS и реально применяются в /api/requests/[id]/verify (loadVerifySettings).
- Вкладка «Нейросеть»: «Максимум фото в обработке» под VRAM, таймаут, кэш, сжатие — читаются очередью каждый документ (кэш 5 с).
- Вкладка «Архитектура»: проводник (дерево файлов с README) + карта со стрелками потоков, без временных оценок.
- Диадок добавлен на визуальную схему карты (бокс «Диадок — мок-стенд ЭДО :3040» рядом с контуром сервера АЭМЗ).
