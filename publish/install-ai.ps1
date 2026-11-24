# install-ai.ps1 — установка/обновление модуля «ИИ-помощник» платформы АЭМЗ Поток.
#
# Запуск из PowerShell (Windows) в каталоге проекта:
#   powershell -ExecutionPolicy Bypass -File .\publish\install-ai.ps1
#
# Что делает:
#   1) проверяет окружение (bun или node+npm);
#   2) ставит зависимости проекта — ИИ-модуль входит в состав (z-ai-web-dev-sdk
#      уже в package.json, отдельная подписка на установку не нужна);
#   3) генерирует Prisma-клиенты ОБЕИХ схем: основной и диспетчерской
#      (prisma/kontur.prisma → src/generated/kontur-client — без этого шага
#      после чистого клона сайт падает с ошибкой
#      "Module not found: Can't resolve '@/generated/kontur-client'");
#   4) (необязательно, -PushDb) применяет схему к базе — новые таблицы:
#      MemoryContact/MemoryDeal (память контактов), AiListItem/AiLog (список
#      и журнал нейросети);
#   5) проверяет .env: DATABASE_URL и переменные подключения нейросети
#      (по подписке Z.AI — при наличии ключей допишите их в .env.local).
#
# Нейросеть-консультант подключается серверной частью (src/lib/ai, /api/ai/*).
# Права жёстко ограничены: запись — только в свой список (AiListItem) и журнал
# (AiLog); контакты читает частично (без телефонов); менять что-либо на
# платформе не может.

param(
    [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [switch]$PushDb,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
Write-Host "== ИИ-помощник: установка ==" -ForegroundColor Cyan
Write-Host "Проект: $ProjectDir"

if (-not (Test-Path (Join-Path $ProjectDir 'package.json'))) {
    Write-Error 'В каталоге нет package.json — запустите скрипт из publish/ проекта LogistikSITE.'
}

Set-Location $ProjectDir

# --- 1. Окружение: bun (рекомендуется) или node+npm ---
$useBun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $useBun -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'Не найден ни bun, ни node. Установите bun: https://bun.sh (Windows: powershell -c "irm bun.sh/install.ps1 | iex")'
}

# --- 2. Зависимости (включая ИИ-модуль z-ai-web-dev-sdk) ---
if (-not $SkipInstall) {
    if ($useBun) {
        Write-Host '>> bun install' -ForegroundColor Yellow
        bun install
    } else {
        Write-Host '>> npm install' -ForegroundColor Yellow
        npm install
    }
}

# --- 3. Prisma-клиенты обеих схем (лечит Module not found @/generated/kontur-client) ---
Write-Host '>> prisma generate (основная схема)' -ForegroundColor Yellow
if ($useBun) { bunx prisma generate } else { npx prisma generate }

Write-Host '>> prisma generate (диспетчерская схема prisma/kontur.prisma)' -ForegroundColor Yellow
if ($useBun) { bunx prisma generate --schema prisma/kontur.prisma } else { npx prisma generate --schema prisma/kontur.prisma }

# --- 4. База: новые таблицы (по умолчанию НЕ применяем — данные не трогаем) ---
# ВАЖНО: у платформы и диспетчерской РАЗНЫЕ базы. Контурную схему (prisma/kontur.prisma)
# пушить нужно ТОЛЬКО в отдельную базу KONTUR_DATABASE_URL (db/kontur.db): prisma db push
# синхронизирует базу под схему и при пуше контура в общую базу удалит платформенные
# таблицы (и наоборот).
if ($PushDb) {
    Write-Host '>> prisma db push (основная схема: память контактов + список/журнал ИИ)' -ForegroundColor Yellow
    if ($useBun) { bunx prisma db push --accept-data-loss } else { npx prisma db push --accept-data-loss }

    # своя база диспетчерской — по умолчанию db/kontur.db
    $konturDir = Join-Path $ProjectDir 'db'
    if (-not (Test-Path $konturDir)) { New-Item -ItemType Directory -Path $konturDir | Out-Null }
    $konturUrl = 'file:' + (Join-Path $konturDir 'kontur.db')

    # KONTUR_DATABASE_URL — в .env.local (если ещё не задана): её читает сервер (src/lib/kontur/db.ts)
    $envLocal = Join-Path $ProjectDir '.env.local'
    $hasKontur = Select-String -Path @(Join-Path $ProjectDir '.env'), $envLocal -Pattern '^KONTUR_DATABASE_URL=' -ErrorAction SilentlyContinue
    if (-not $hasKontur) {
        Add-Content -Path $envLocal -Value "KONTUR_DATABASE_URL=$konturUrl"
        Write-Host ">> Добавлен KONTUR_DATABASE_URL=$konturUrl в .env.local" -ForegroundColor DarkYellow
    }

    # пуш контурной схемы — с временным оверрайдом DATABASE_URL на базу диспетчерской
    Write-Host '>> prisma db push (диспетчерская схема → отдельная база db/kontur.db)' -ForegroundColor Yellow
    $oldUrl = $env:DATABASE_URL
    $env:DATABASE_URL = $konturUrl
    if ($useBun) { bunx prisma db push --schema prisma/kontur.prisma --accept-data-loss } else { npx prisma db push --schema prisma/kontur.prisma --accept-data-loss }
    if ($null -ne $oldUrl) { $env:DATABASE_URL = $oldUrl } else { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
} else {
    Write-Host '>> Базу не трогаем. Чтобы создать таблицы (память контактов, ИИ, диспетчерская), перезапустите с -PushDb' -ForegroundColor DarkYellow
}

# --- 5. .env: подсказки по переменным ---
$envFile = Join-Path $ProjectDir '.env'
$envLocal = Join-Path $ProjectDir '.env.local'
if (-not (Test-Path $envFile) -and -not (Test-Path $envLocal)) {
    Write-Host '>> Нет .env: скопируйте .env.example и укажите DATABASE_URL' -ForegroundColor DarkYellow
}
$dbUrl = $null
foreach ($f in @($envLocal, $envFile)) {
    if (Test-Path $f) { $dbUrl = (Select-String -Path $f -Pattern '^DATABASE_URL=' -ErrorAction SilentlyContinue | Select-Object -First 1).Line }
}
if ($dbUrl) { Write-Host ">> DATABASE_URL найден: $($dbUrl.Substring(0, [Math]::Min(60, $dbUrl.Length)))" }
else { Write-Host '>> DATABASE_URL не задан — нейросеть и контакты потребуют базу (SQLite).' -ForegroundColor DarkYellow }

Write-Host ''
Write-Host '== Готово ==' -ForegroundColor Green
Write-Host 'Запуск дев-версии:  bun run dev   (порт 3000)'
Write-Host 'Раздел «ИИ-помощник» — в меню платформы (Собственный транспорт) и в боковом меню справа.'
Write-Host 'Кнопка «Найти с ИИ» — в разделе ATI.SU: окно поиска грузы/машины, разбор сохраняется в список нейросети.'
if (-not $PushDb) { Write-Host 'Не забудьте -PushDb при первом запуске, чтобы создать таблицы.' -ForegroundColor DarkYellow }
