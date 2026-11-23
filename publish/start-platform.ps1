. "$PSScriptRoot\config.ps1"

$pidFile = Join-Path $LogDir 'platform.pid'
$owner = Get-PortOwner $PlatformPort
if ($owner -gt 0) {
    Set-Content -Path $pidFile -Value $owner -Encoding ascii
    Write-Output "platform already running: pid=$owner http://127.0.0.1:$PlatformPort/"
    exit 0
}

$server = Join-Path $RepoRoot '.next\standalone\server.js'
if (-not (Test-Path $server)) {
    Write-Output "ERROR: standalone build not found: $server"
    Write-Output "Run: powershell -NoProfile -ExecutionPolicy Bypass -File `"$PublishDir\build-public.ps1`""
    exit 1
}
if (-not (Test-Path $DbPath)) {
    Write-Output "ERROR: database not found: $DbPath"
    exit 1
}
if (-not (Test-Path $NodeExe)) {
    Write-Output "ERROR: node.exe not found"
    exit 1
}

$envMap = Import-DotEnv (Join-Path $RepoRoot '.env.local')
foreach ($key in $envMap.Keys) {
    Set-Item -Path "env:$key" -Value $envMap[$key]
}
$env:NODE_ENV = 'production'
$env:PORT = "$PlatformPort"
$env:HOSTNAME = '127.0.0.1'
$env:DATABASE_URL = 'file:' + ($DbPath -replace '\\', '/')
# KONTUR: база диспетчерской. С этапа объединения баз это та же combat.db:
# таблицы Контура живут в ней с префиксом Dispatch (см. prisma/kontur.prisma).
$env:KONTUR_DATABASE_URL = 'file:' + ($KonturDb -replace '\\', '/')
$env:CONTOUR_AUDIT_FILE = (Join-Path $LogDir 'contour-audit.jsonl')
$env:NEXT_TELEMETRY_DISABLED = '1'
# Маршрут офиса → APK: дорожная линия строится через точки Яндекс.Карт,
# готовый рейс уходит в журнал сервиса водителя (:3102) для sync/long-poll.
$env:OSRM_BASE_URL = 'https://vacantrix.ru/osrm/route/v1/driving'
$env:DRIVER_APP_INGEST_URL = "http://127.0.0.1:$DriverApiPort/driver/api/driver/v1/ingest"
$env:DRIVER_APP_INGEST_TOKEN = $DriverIngestToken
$env:DRIVER_APP_DRIVER_ID = '06c075d1-3088-45f2-a7ae-090e8c355447'
# Пилот: один телефон, поэтому маршрут любого рейса уходит на демо-устройство.
# В парке поставить 0 — тогда работает точная карта DRIVER_APP_ID_MAP.
$env:DRIVER_APP_SINGLE_DRIVER = '1'
$env:DRIVER_APP_TRIP_ID = '7e6a1c2d-8a9b-4c3d-9e0f-112233445566'
$env:DRIVER_APP_POINT_LOADING_ID = 'p1-loading-0000-4000-8000-000000000001'
$env:DRIVER_APP_POINT_UNLOADING_ID = 'p2-unloading-0000-4000-8000-000000000002'

$outLog = Join-Path $LogDir 'platform.out.log'
$errLog = Join-Path $LogDir 'platform.err.log'
$p = Start-Process -FilePath $NodeExe `
    -ArgumentList '.next/standalone/server.js' `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Set-Content -Path $pidFile -Value $p.Id -Encoding ascii

if (-not (Wait-HttpOk -Url "http://127.0.0.1:$PlatformPort/" -TimeoutSec 45)) {
    Write-Output "ERROR: platform did not respond on http://127.0.0.1:$PlatformPort/"
    Write-Output "stderr tail:"
    Get-LogTail $errLog 30
    exit 1
}

Write-Output "platform started: pid=$($p.Id) http://127.0.0.1:$PlatformPort/"
