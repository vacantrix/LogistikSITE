# Документация «АЭМЗ Поток»

Единая документация монорепозитория. Начните с [../README.md](../README.md),
если нужен быстрый запуск; здесь — системное описание.

## Архитектура

| Документ | Содержание |
|---|---|
| [architecture/system-overview.md](architecture/system-overview.md) | компоненты, порты, потоки данных, отказоустойчивость |
| [architecture/data-model.md](architecture/data-model.md) | схема платформы, Dispatch-контура и модуля водителя |
| [modules/platform.md](modules/platform.md) | платформа: роли, разделы, API, проверки |
| [ai-helper.md](ai-helper.md) | ИИ-помощник GigaChat, память контактов, избранное, права |
| [modules/kontur-1c.md](modules/kontur-1c.md) | диспетчерская, собственный парк, рейсы |
| [modules/driver.md](modules/driver.md) | PWA/APK, синхронизация, офлайн, карта |
| [modules/ocr.md](modules/ocr.md) | OCR-конвейер, очередь, модели, вердикты |

## Интеграции

| Документ | Содержание |
|---|---|
| [integrations/1c.md](integrations/1c.md) | REST-шина 1С, статусы, модули форм |
| [integrations/yandex-routes.md](integrations/yandex-routes.md) | `rtext`, точная геометрия, OSRM-резерв |
| [1c/README.md](1c/README.md) | исходные модули 1С и симулятор (как было) |

## Эксплуатация

| Документ | Содержание |
|---|---|
| [operations/deployment.md](operations/deployment.md) | сборка, запуск, порты, TLS, автозапуск |
| [operations/troubleshooting.md](operations/troubleshooting.md) | симптомы и исправления |
| [operations/backup-restore.md](operations/backup-restore.md) | SQLite: копирование и восстановление |
| [security.md](security.md) | секреты, доступ, ПДн, аудит |

## Разработка и история

| Документ | Содержание |
|---|---|
| [development/monorepo.md](development/monorepo.md) | layout, subtree, правила, артефакты |
| [development/build-and-test.md](development/build-and-test.md) | сборка, typecheck, smoke, APK, OCR |
| [history/legacy-and-archive.md](history/legacy-and-archive.md) | старые репозитории и что с ними |
| [history/consolidation-2026-11-24.md](history/consolidation-2026-11-24.md) | акт объединения и проверки |
| [materials/](materials/) | паспорт проекта, презентация, речь |
| [../worklog.md](../worklog.md) | хронология задач |

## Материалы интеграций 1С (как было)

Папка `docs/1c/` публикуется на GitHub Pages: кода платформы и секретов здесь
нет, только материалы 1С и внутренний отчёт аудита.

| Папка/файл | Содержание |
|---|---|
| `audit-report.md` | внутренний отчёт аудита синхронизации (файлы ↔ платформа, мусор/баги) |
| `1c/README.md` | схема обмена 1С ↔ платформа, поля, curl-примеры, развёртывание, модули |
| `1c/orders-form-web-logistic.bsl` | модуль формы «Заказы грузоотправителей»: кнопка «в Веб-Логистик», рейсы, статусы |
| `1c/send-request-form-module.bsl` | модуль документа «Заявка на перевозку» |
| `1c/onec-check.mjs` | проверка обмена с сервера или ПК, без 1С и браузера |
| `1c/simulator/` | HTML-симулятор формы 1С для GitHub Pages + инструкция |
| `.nojekyll` | GitHub Pages: отдавать файлы как есть |

Установленная копия симулятора, которую раздаёт платформа по `/1c-simulator/`,
лежит в `public/1c-simulator/`; после правки `1c/simulator/index.html`
скопируйте файл туда ещё раз (см. `1c/README.md`).

## Статусы

- **Production-путь:** `src/` → платформа :3000, встроенный `/kontur`,
  `driver/` → модуль водителя :3102, `publish/` → gateway/Caddy.
- **Автономный стенд:** `driver/scripts/start-stack.sh` → «Контур 1С» :3001,
  водитель :3002, роутер :3000. Оставлен для локальной демонстрации и истории.
- **Исторические репозитории:** `LogistikSITEnow2` (старая диспетчерская) и
  `LogistikSITE-next-security` (снимок платформы) не дублируются в монорепо;
  см. [history/legacy-and-archive.md](history/legacy-and-archive.md).
