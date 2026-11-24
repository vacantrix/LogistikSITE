# Развёртывание

Стенд АЭМЗ — один Windows-ПК, на котором работают платформа, модуль водителя,
OCR, WS-шина, шлюз, портал и Caddy. Все внутренние сервисы слушают
`127.0.0.1`; наружу открыт только 443.

## 1. Требования

| Компонент | Версия / примечание |
|---|---|
| Windows | 10/11, PowerShell 5.1+ |
| Node.js | 20+ (в `publish/config.ps1` ищется `C:\Program Files\nodejs\node.exe`) |
| Bun | 1.x — зависимости и сборка платформы |
| Python | 3.10+ для PaddleOCR, venv и модели локально |
| Caddy | `publish/bin/caddy.exe` (в git не входит) |
| Android SDK | только для сборки APK: JDK 17, platform 34, build-tools 34.0.0, Gradle 8.9 |
| Диск | ~2 ГБ на зависимости и сборки, плюс место под базы и фото |

## 2. Первичная установка

```powershell
git clone https://github.com/vacantrix/LogistikSITE.git
cd LogistikSITE
bun install

# секреты
Copy-Item .env.example .env.local
notepad .env.local      # DATABASE_URL, AUTH_SECRET, ONEC_API_KEY, OCR_*, DIADOC_*

# база и учётные записи
npm run db:push
npm run db:generate
npm run auth:seed

# сборка платформы и модуля водителя
powershell -NoProfile -ExecutionPolicy Bypass -File publish\build-public.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File publish\build-driver.ps1
```

`build-public.ps1` собирает standalone-бандл платформы, синхронизирует
`.next/static` и `public`, пишет `publish/build-manifest.json`.
`build-driver.ps1` делает то же для `driver/` и (по флагу `-WithKontur`)
для автономного «Контура».

## 3. OCR

```powershell
cd mini-services\paddle-ocr
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
powershell -File .\start-service.ps1 -Port 3031
```

Модели скачиваются при первом запуске в `.models` (или `.models-v6` для
набора v6). Держите их рядом с сервисом, не в `%TEMP%`. Шлюз:

```powershell
cd mini-services\ocr-service
bun install
bun run dev
```

Проверка: `http://127.0.0.1:3031/health`, `http://127.0.0.1:3020/health`.

## 4. Запуск всего стека

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File publish\start-all.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File publish\status.ps1
```

`start-all.ps1`:

1. проверяет обязательные файлы и `build-manifest.json`;
2. поднимает OCR :3031 и ждёт `ready`;
3. поднимает платформу :3000;
4. поднимает WS :3003;
5. поднимает gateway :8080 и portal-auth :8090;
6. поднимает модуль водителя :3102;
7. поднимает Caddy :443;
8. запускает runtime-проверку архитектуры и прав;
9. сверяет DNS A-запись с внешним IP и предупреждает при расхождении.

Остановка:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File publish\stop-all.ps1
```

## 5. Порты

| Сервис | Порт | Доступ |
|---|---:|---|
| Caddy | 443 (81 admin) | интернет |
| Gateway / лендинг | 8080 | только localhost |
| Portal auth | 8090 | только localhost |
| Платформа | 3000 | только localhost |
| Модуль водителя | 3102 | только localhost |
| WS-шина | 3003 | только localhost (через Caddy `?XTransformPort=3003`) |
| OCR-шлюз | 3020 | только localhost |
| PaddleOCR | 3031 | только localhost |
| Диадок-мок | 3040 | только localhost |
| Автономный «Контур» | 3001 | только localhost (legacy) |

## 6. Домены и TLS

| Домен | Что отдаёт |
|---|---|
| `logistiksite.vacantrix.ru` | лендинг и демо-платформа через gateway :8080 |
| `vacantrix.ru` | портал, каталог, `/dl/*`, `/api/portal/*`, `/kontur` |
| `www.vacantrix.ru` | редирект на `vacantrix.ru` |

Порт 80 у провайдера закрыт, поэтому Let's Encrypt получает сертификаты по
TLS-ALPN-01 на 443. Caddy — единственный процесс, смотрящий в интернет.
A-записи доменов должны указывать на внешний IP; при динамическом IP
обновите запись в reg.ru (start-all предупредит).

Caddyfile содержит абсолютные пути к `publish/portal` и логам. Если репозиторий
перенесён в другой каталог, обновите их (или задайте `PORTAL_ROOT`/`LOG_DIR`
и используйте плейсхолдеры Caddy).

## 7. Автозапуск

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File publish\register-autostart.ps1
```

Создаёт задачу `LogistikSITE-Demo`: запуск при входе (задержка 60 с) и
повтор каждые 10 минут, `MultipleInstances=IgnoreNew`. Скрипт также
отключает сон и гибернацию на питании от сети.

Удаление: `publish\unregister-autostart.ps1`.

## 8. APK

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\android-build\build-apk.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File publish\publish-apk.ps1
```

`build-apk.ps1` пишет `local.properties`, запускает Gradle, копирует APK в
`driver/download/azmz-driver.apk` и печатает SHA-256. `publish-apk.ps1`
копирует его в `publish/portal/dl/Drivemobile.apk` (публичная ссылка
`/dl/Drivemobile.apk`) и в standalone-бандл платформы.

## 9. Обновление

```powershell
# 1. Резервная копия баз
powershell -File publish\stop-all.ps1
Copy-Item db\combat.db db\backups\combat-$(Get-Date -f yyyyMMdd-HHmm).db
Copy-Item driver\db\custom.db driver\db\backups\custom-$(Get-Date -f yyyyMMdd-HHmm).db

# 2. Код
git pull --ff-only
bun install
npm run db:push
npm run db:generate

# 3. Сборка и запуск
powershell -File publish\build-public.ps1
powershell -File publish\build-driver.ps1
powershell -File publish\start-all.ps1
powershell -File publish\status.ps1
```

## 10. Проверка после запуска

```powershell
powershell -File publish\status.ps1          # ожидается RESULT: OK
powershell -File publish\verify-stack.ps1    # архитектура, права, маршруты
```

Публичные проверки:

```powershell
curl.exe -sS https://logistiksite.vacantrix.ru/driver/sw.js | Select-String VERSION
curl.exe -sS -o NUL -w "%{http_code}" https://logistiksite.vacantrix.ru/driver
curl.exe -sS -o NUL -w "%{http_code}" https://logistiksite.vacantrix.ru/dl/Drivemobile.apk
```
