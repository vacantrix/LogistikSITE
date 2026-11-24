# ensure-ai-tables.ps1 — безопасно добавить таблицы ИИ в общую базу платформы.
#
# Зачем: платформа и диспетчерская используют одну SQLite-базу (db/combat.db,
# диспетчерские таблицы с префиксом Dispatch). `prisma db push` синхронизирует
# базу под ОДНУ схему и удаляет таблицы другой — на рабочей базе это недопустимо.
#
# Скрипт создаёт временную пустую базу по prisma/schema.prisma, берёт из неё
# DDL только недостающих таблиц ИИ (MemoryContact, MemoryDeal, AiListItem,
# AiFavorite, AiFavoriteMessage, AiLog, AiChatMessage, AiRight) и добавляет их
# в рабочую базу. Существующие таблицы и данные не изменяются.
#
# Запуск:
#   powershell -ExecutionPolicy Bypass -File .\publish\ensure-ai-tables.ps1

param(
    [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'config.ps1')

if (-not (Test-Path $DbPath)) {
    Write-Output "ERROR: база платформы не найдена: $DbPath"
    Write-Output 'Сначала создайте её: npm run db:push (только на чистой базе)'
    exit 1
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Output 'ERROR: не найден python (нужен для безопасного добавления таблиц)'
    exit 1
}

$npx = if ($env:OS -eq 'Windows_NT') { 'npx.cmd' } else { 'npx' }
$tmp = Join-Path $ProjectDir ("db\.ai-schema-tmp-{0}.db" -f $PID)
$oldUrl = $env:DATABASE_URL

try {
    Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    $env:DATABASE_URL = 'file:' + ($tmp -replace '\\', '/')

    Write-Output '=== Временная схема платформы (только для DDL таблиц ИИ) ==='
    & $npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss
    if ($LASTEXITCODE -ne 0) {
        Write-Output 'ERROR: не удалось создать временную схему'
        exit 1
    }

    Write-Output '=== Добавляем недостающие таблицы ИИ в рабочую базу ==='
    & $python (Join-Path $PSScriptRoot 'add-ai-tables.py') --source $tmp --target $DbPath
    if ($LASTEXITCODE -ne 0) {
        Write-Output 'ERROR: таблицы ИИ не добавлены'
        exit 1
    }
} finally {
    if ($null -ne $oldUrl) { $env:DATABASE_URL = $oldUrl }
    else { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
}

Write-Output "AI_TABLES_READY: $DbPath"
