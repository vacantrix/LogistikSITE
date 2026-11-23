$ErrorActionPreference = 'Stop'

$PublishDir = $PSScriptRoot
$RepoRoot = Split-Path -Parent $PublishDir
$PlatformPort = 3000
$OcrPort = 3031
$GatewayPort = 8080
$PortalAuthPort = 8090
$PublicHost = 'logistiksite.vacantrix.ru'
$PublicUrl = "https://$PublicHost"

# Основной домен: портал экосистемы; LogistikSITE — отдельный блок и демо на поддомене.
$MainHost = 'vacantrix.ru'
$MainUrl = "https://$MainHost"
$PortalCatalogUrl = "$MainUrl/apps"
$DemoUrl = "$PublicUrl/demo/"
$CaddyExe = Join-Path $PSScriptRoot 'bin\caddy.exe'
$Caddyfile = Join-Path $PSScriptRoot 'Caddyfile.publish'

# Tuna оставлена только для аварийного откката, в обычном запуске не используется.
$TunaSubdomain = 'wise-ibis-6779'
$TunaFallbackUrl = "https://$TunaSubdomain.a.tuna.free"
$LogDir = Join-Path $PublishDir 'logs'
$DbPath = Join-Path $RepoRoot 'db\combat.db'
$PortalDataDir = Join-Path $PublishDir 'data'
$PortalAuthScript = Join-Path $PublishDir 'portal-auth.mjs'
$TunaExe = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\tuna.exe'

# Диспетчерская «Контур» работает внутри платформы (маршрут /kontur на порту
# $PlatformPort). С этапа объединения баз её таблицы живут в общей базе
# платформы с префиксом Dispatch (см. prisma/kontur.prisma), поэтому отдельный
# файл базы не нужен. Исходный LogistikSITEnow2/db/custom.db остаётся резервом
# для отката: вернуть $KonturDb на него можно одной строкой.
$DrivemobileRoot = Join-Path (Split-Path -Parent $RepoRoot) 'Drivemobile'
$DispatcherRoot = Join-Path (Split-Path -Parent $RepoRoot) 'LogistikSITEnow2'
$DriverApiPort = 3102
$KonturUrl = "$MainUrl/kontur"
$DriverApiUrl = "$MainUrl/api/driver/v1/"
$KonturAuthUser = 'admin'
$KonturAuthPass = 'aemz2024'
$KonturDb = $DbPath
$DriverStandalone = Join-Path $DrivemobileRoot '.next\standalone'
$DriverDb = Join-Path $DrivemobileRoot 'db\custom.db'
$DriverPositionsFile = Join-Path $DrivemobileRoot 'db\positions.json'
$DriverIngestToken = 'azmz-stand-bridge-2026'
# appId водителя из демо-базы (таблица Driver); APK передаёт его в X-Driver-Id.
$DriverDemoAppId = '06c075d1-3088-45f2-a7ae-090e8c355447'

$NodeExe = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $NodeExe)) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) { $NodeExe = $node.Source }
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Get-PortOwner {
    param([int]$Port)
    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
    return 0
}

function Wait-HttpOk {
    param(
        [string]$Url,
        [int]$TimeoutSec = 60,
        [hashtable]$Headers = @{}
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 -Headers $Headers
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { return $true }
        } catch { }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Import-DotEnv {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path $Path)) { return $map }
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $key = $matches[1]
            $value = $matches[2].Trim()
            if ($value.Length -ge 2) {
                $q1 = $value.Substring(0, 1)
                $q2 = $value.Substring($value.Length - 1, 1)
                if (($q1 -eq '"' -and $q2 -eq '"') -or ($q1 -eq "'" -and $q2 -eq "'")) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
            }
            $map[$key] = $value
        }
    }
    return $map
}

function Get-LogTail {
    param([string]$Path, [int]$Lines = 30)
    if (Test-Path $Path) {
        Get-Content $Path -Tail $Lines -ErrorAction SilentlyContinue
    }
}

function Test-TunaSession {
    if (-not (Test-Path $TunaExe)) { return $false }
    $null = & $TunaExe whoami 2>&1
    return ($LASTEXITCODE -eq 0)
}
