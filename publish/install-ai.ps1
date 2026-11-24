# install-ai.ps1 — установка/обновление модуля «ИИ-помощник» платформы АЭМЗ Поток.
#
# Запуск из PowerShell (Windows) в каталоге проекта:
#   powershell -ExecutionPolicy Bypass -File .\publish\install-ai.ps1
#
# Что делает:
#   1) проверяет окружение (bun или node+npm);
#   2) ставит зависимости проекта — ИИ-модуль входит в состав;
#   3) генерирует Prisma-клиенты ОБЕИХ схем: основной и диспетчерской
#      (prisma/kontur.prisma → src/generated/kontur-client — без этого шага
#      после чистого клона сайт падает с ошибкой
#      "Module not found: Can't resolve '@/generated/kontur-client'");
#   4) (необязательно, -PushDb) БЕЗОПАСНО добавляет недостающие таблицы ИИ:
#      MemoryContact/MemoryDeal (память контактов), AiListItem/AiFavorite/
#      AiFavoriteMessage/AiLog/AiChatMessage/AiRight (ИИ-помощник). Обычный
#      `prisma db push` на общей базе запрещён — он удаляет таблицы Dispatch*;
#   5) проверяет .env: DATABASE_URL и ключи GigaChat
#      (GIGACHAT_CLIENT_ID / GIGACHAT_CLIENT_SECRET — в .env.local).
#
# Нейросеть-консультант подключается серверной частью (src/lib/ai, /api/ai/*).
# Движок — GigaChat (Сбер). Права жёстко ограничены: запись — только в свой
# список (AiListItem), избранное (AiFavorite) и журнал (AiLog); контакты
# читает частично (без телефонов); менять что-либо на платформе не может.

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
# ВАЖНО: платформа и диспетчерская используют ОДНУ базу (db/combat.db);
# диспетчерские таблицы имеют префикс Dispatch. Обычный `prisma db push`
# синхронизирует базу под одну схему и удаляет таблицы другой, поэтому здесь
# он запрещён. ensure-ai-tables.ps1 создаёт временную схему и переносит в
# рабочую базу только DDL недостающих таблиц ИИ, не трогая данные.
if ($PushDb) {
    Write-Host '>> Безопасное добавление таблиц ИИ (без удаления Dispatch*)' -ForegroundColor Yellow
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'ensure-ai-tables.ps1') -ProjectDir $ProjectDir
    if ($LASTEXITCODE -ne 0) {
        Write-Error 'Не удалось добавить таблицы ИИ. База не изменена.'
    }
} else {
    Write-Host '>> Базу не трогаем. Для добавления таблиц ИИ запустите с -PushDb (безопасно, без drop).' -ForegroundColor DarkYellow
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
Write-Host 'Ключи GigaChat: GIGACHAT_CLIENT_ID и GIGACHAT_CLIENT_SECRET в .env.local (см. docs/ai-helper.md).'
if (-not $PushDb) { Write-Host 'Таблицы ИИ на существующей базе уже добавлены; -PushDb безопасно добавит недостающие.' -ForegroundColor DarkYellow }
