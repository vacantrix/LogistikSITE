# Монорепозиторий: правила

`https://github.com/vacantrix/LogistikSITE` — единственный источник истины.
Платформа, модуль водителя, сервисы, скрипты и документация живут в одном
дереве и собираются вместе.

## 1. Layout

```text
LogistikSITE/
├── src/                     платформа Next.js + /kontur
├── prisma/                  schema.prisma, kontur.prisma
├── public/                  статика платформы
├── mini-services/
│   ├── ocr-service/         шлюз OCR
│   ├── paddle-ocr/          движок + start/stop-service.ps1
│   ├── ws-service/          real-time
│   └── diadoc-mock/         ЭДО-стенд
├── publish/                 Caddy, gateway, портал, сборка, запуск
├── driver/                  модуль водителя (git subtree)
│   ├── src/, public/        PWA и API
│   ├── prisma/              схема модуля
│   ├── download/            Android-исходники и канонический APK
│   └── kontur-1c/           автономный «Контур» (legacy)
├── tools/
│   ├── android-build/       сборка/публикация APK
│   └── ocr-probe/           ручные OCR-пробы
├── docs/                    системная документация
├── .github/workflows/       CI сборки APK
├── worklog.md               хронология
└── README.md
```

## 2. Модуль водителя как subtree

`driver/` импортирован с полной историей `vacantrix/Drivemobile`:

```bash
git subtree add --prefix=driver ../Drivemobile main
```

Обновление из источника (если он ещё ведётся):

```bash
git subtree pull --prefix=driver https://github.com/vacantrix/Drivemobile.git main
```

Изменения, сделанные в монорепо, можно отправить обратно:

```bash
git subtree push --prefix=driver https://github.com/vacantrix/Drivemobile.git main
```

Но основной поток — **только здесь**. Отдельный `Drivemobile` считается
зеркалом/архивом; не создавайте в нём новую функциональность, которую потом
придётся вручную переносить.

## 3. Пути

- Все скрипты `publish/` используют `$RepoRoot` и `$DrivemobileRoot =
  Join-Path $RepoRoot 'driver'`.
- Никаких ссылок на `..\Drivemobile` или `..\LogistikSITEnow2` в новом коде.
  `LogistikSITEnow2` упоминается только в исторических комментариях и как
  резервная копия для отката.
- Android-проект: `driver/download/azmz-karkas/android`.
- APK: `driver/download/azmz-driver.apk` (единственная каноническая копия).
- Сборка APK: `tools/android-build/build-apk.ps1`; публикация:
  `publish/publish-apk.ps1`.

## 4. Что не коммитим

| Категория | Примеры |
|---|---|
| зависимости | `node_modules/`, `.venv/`, `.pnp.*` |
| сборки | `.next/`, `out/`, `build/`, standalone |
| runtime-данные | `db/*.db`, `db/backups/`, `upload/`, `driver/db/*.db-wal` |
| секреты | `.env`, `.env.local`, `publish/credentials.local.txt`, `*.pem` |
| OCR | `.models/`, `.models-v6/`, `bench-v6/`, логи |
| Android | `.gradle/`, `.kotlin/`, `local.properties`, `build/` |
| APK-дубли | `driver/public/azmz-driver.apk`, `driver/download/Drivemobile.apk`, старые версии |
| ПДн | реальные паспорта, ВУ, СТС, `samples_real/`, `out_real/` |
| мусор | `*.log`, `*.bak-*`, `tool-results/`, `agent-ctx/` |

Канонический APK — исключение: он хранится в
`driver/download/azmz-driver.apk`, потому что это публичный артефакт сборки.

## 5. Коммиты

- Один коммит — одна законченная мысль; сообщение по-русски, в повелительном
  наклонении («Добавить…», «Исправить…»).
- В коммит не попадают сгенерированные файлы и секреты; перед `git add`
  проверяйте `git status`.
- Крупные изменения — с обновлением `worklog.md` и профильного документа в
  `docs/`.
- Ветки: `main` — рабочая; эксперименты — отдельная ветка с PR.

## 6. CI

`.github/workflows/android-apk.yml` собирает debug-APK на `ubuntu-latest`
(JDK 17, Gradle 8.9) и выкладывает артефакт `azmz-driver-apk`. Секреты для
сборки не нужны. Публикация APK на стенд — вручную через
`publish/publish-apk.ps1`.

## 7. Связь с историческими репозиториями

`LogistikSITEnow2` и `LogistikSITE-next-security` — архивы, не часть сборки.
Их содержимое не копировалось, чтобы не дублировать код и не тащить `.env`/БД.
Подробно — [../history/legacy-and-archive.md](../history/legacy-and-archive.md).
