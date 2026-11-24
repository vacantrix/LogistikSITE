# Резервное копирование и восстановление

В системе две SQLite-базы и каталог файлов. В git они не входят, поэтому
резервная копия — единственный способ восстановить данные.

| Что | Путь | Размер (стенд) | В git |
|---|---|---:|---|
| Платформа + «Контур» | `db/combat.db` | ~42 МБ | нет |
| Модуль водителя | `driver/db/custom.db` | ~0,3 МБ | демо-версия |
| Позиции водителя | `driver/db/positions.json` | мало | демо-версия |
| Файлы и фото | `upload/` | зависит | нет |
| Логи | `publish/logs/`, `mini-services/paddle-ocr/logs/` | зависит | нет |
| Конфигурация | `.env`, `.env.local` | мало | нет (только `.env.example`) |

## 1. Безопасная копия

SQLite в режиме WAL нельзя копировать «на ходу»: часть данных может быть в
`-wal`. Правильный порядок:

```powershell
powershell -File publish\stop-all.ps1

New-Item -ItemType Directory -Force db\backups | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
Copy-Item db\combat.db "db\backups\combat-$stamp.db" -Force
Copy-Item driver\db\custom.db "driver\db\backups\custom-$stamp.db" -Force

powershell -File publish\start-all.ps1
```

Если остановить сервисы нельзя, используйте онлайн-копию через SQLite:

```powershell
sqlite3 db\combat.db ".backup 'db\backups\combat-online.db'"
```

`VACUUM INTO` тоже делает согласованный снимок:

```powershell
sqlite3 db\combat.db "VACUUM INTO 'db/backups/combat-vacuum.db';"
```

Не копируйте только `combat.db`, если рядом есть `combat.db-wal` — снимок
будет неполным.

## 2. Файлы

`upload/` содержит документы и фото. Копируйте каталог целиком, сохраняя
структуру:

```powershell
robocopy upload "backups\upload-$stamp" /E /R:1 /W:1
```

Файлы связаны с записями `Document`/`RequestFile`; без базы они бесполезны,
поэтому база и `upload/` копируются одной парой.

## 3. Конфигурация

Скопируйте `.env`, `.env.local`, `publish/credentials.local.txt` (если есть) в
защищённое место. **Не** кладите их в git и не пересылайте в чат.

## 4. Ротация

Рекомендуемый минимум для стенда:

- ежедневно — база + `upload/` (можно в конце дня);
- перед каждым `db:push`, обновлением или пересборкой — внеплановая копия;
- хранить 7 ежедневных и 4 недельных копий;
- одну копию держать вне этого ПК (сетевой диск/защищённый архив);
- раз в месяц проверять восстановление на копии.

## 5. Восстановление

```powershell
powershell -File publish\stop-all.ps1

# сохранить текущее состояние на случай отката
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
Move-Item db\combat.db "db\combat.before-restore-$stamp.db"
Remove-Item db\combat.db-wal, db\combat.db-shm -Force -ErrorAction SilentlyContinue

Copy-Item "db\backups\combat-20261124-1200.db" db\combat.db -Force
# при необходимости — upload/
# robocopy "backups\upload-20261124-1200" upload /E

powershell -File publish\start-all.ps1
powershell -File publish\status.ps1
```

После восстановления проверьте: вход логиста, список заявок, `/kontur`,
документы (фото открываются), реестр рейсов, `/driver` и журнал синхронизации.

## 6. Восстановление только модуля водителя

```powershell
powershell -File publish\stop-drivemobile.ps1
Copy-Item driver\db\backups\custom-20261124-1200.db driver\db\custom.db -Force
powershell -File publish\start-drivemobile.ps1
```

Если база модуля потеряна, её можно создать заново (`cd driver; npx prisma db
push`) и повторно отправить рейс из «Контура» — снимок придёт через
`driver-bridge.ts`. История чата и отметок при этом пропадёт.

## 7. Что не восстанавливается из git

- runtime-базы (`db/*.db`), `upload/`, логи;
- модели OCR (`.models`, `.models-v6`) и venv;
- `node_modules`, `.next`, standalone;
- `publish/portal`, `publish/bin`, `publish/data`;
- APK-артефакты, кроме канонического `driver/download/azmz-driver.apk`.

Всё это пересоздаётся сборкой/установкой, кроме пользовательских данных.
