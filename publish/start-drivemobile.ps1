. "$PSScriptRoot\config.ps1"

Write-Output "=== Drivemobile start ==="

# Standalone-сборка Next.js не содержит .next/static и public — их нужно
# докладывать после каждого билда. Делаем это автоматически.
function Sync-StandaloneAssets {
    param([string]$AppDir, [string]$StandaloneDir, [string]$Name)
    if (-not (Test-Path (Join-Path $StandaloneDir 'server.js'))) {
        return "server.js not found: $StandaloneDir"
    }
    $staticSrc = Join-Path $AppDir '.next\static'
    $staticDst = Join-Path $StandaloneDir '.next\static'
    if (-not (Test-Path $staticSrc)) { return "static not found: $staticSrc" }
    # Копируем всегда: после пересборки в .next/static новые хэши, а старые
    # файлы остаются — без обновления standalone отдаёт прошлую версию.
    if (Test-Path $staticDst) { Remove-Item $staticDst -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $staticDst) | Out-Null
    Copy-Item $staticSrc $staticDst -Recurse -Force
    Write-Host "$Name assets: .next/static refreshed"
    $publicSrc = Join-Path $AppDir 'public'
    $publicDst = Join-Path $StandaloneDir 'public'
    if (Test-Path $publicSrc) {
        if (Test-Path $publicDst) { Remove-Item $publicDst -Recurse -Force }
        Copy-Item $publicSrc $publicDst -Recurse -Force
        Write-Host "$Name assets: public refreshed"
    }
    return $null
}

$errors = @()
$errors += @(
    (Sync-StandaloneAssets -AppDir $DrivemobileRoot -StandaloneDir $DriverStandalone -Name 'driver-api')
) | Where-Object { $_ }

if (-not (Test-Path $DriverDb)) { $errors += "driver DB not found: $DriverDb" }
if (-not (Test-Path $NodeExe)) { $errors += "node.exe not found" }
if ($errors.Count -gt 0) {
    Write-Output 'ERROR: Drivemobile is not ready:'
    $errors | ForEach-Object { Write-Output "  $_" }
    Write-Output "Build: cd driver && npx next build, then retry (or run publish\build-driver.ps1)."
    exit 1
}

function Start-DrService {
    param(
        [string]$Name,
        [int]$Port,
        [string]$WorkDir,
        [hashtable]$Env,
        [string]$PidFile,
        [string]$HealthUrl,
        [int]$TimeoutSec = 90
    )

    $owner = Get-PortOwner $Port
    if ($owner -gt 0) {
        Set-Content -Path $PidFile -Value $owner -Encoding ascii
        Write-Host "$Name already running: pid=$owner port=$Port"
        return $true
    }

    foreach ($key in $Env.Keys) { Set-Item -Path "env:$key" -Value $Env[$key] }
    $outLog = Join-Path $LogDir "$Name.out.log"
    $errLog = Join-Path $LogDir "$Name.err.log"
    $proc = Start-Process -FilePath $NodeExe -ArgumentList 'server.js' `
        -WorkingDirectory $WorkDir -WindowStyle Hidden `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    foreach ($key in $Env.Keys) { Remove-Item -Path "env:$key" -ErrorAction SilentlyContinue }

    Set-Content -Path $PidFile -Value $proc.Id -Encoding ascii
    Write-Host "$Name started: pid=$($proc.Id) port=$Port"

    if (-not (Wait-HttpOk -Url $HealthUrl -TimeoutSec $TimeoutSec)) {
        Write-Host "ERROR: $Name is not responding on $HealthUrl"
        Get-LogTail $errLog 40
        return $false
    }
    Write-Host "$Name health: OK ($HealthUrl)"
    return $true
}

$driverPid = Join-Path $LogDir 'driver-api.pid'

$driverEnv = @{
    NODE_ENV               = 'production'
    PORT                   = "$DriverApiPort"
    HOSTNAME               = '127.0.0.1'
    DATABASE_URL           = 'file:' + ($DriverDb -replace '\\', '/')
    DRIVER_INGEST_TOKEN    = $DriverIngestToken
    # Диспетчерская теперь внутри платформы: 1С-контракты живут на :3000/kontur.
    KONTUR_1C_URL          = "http://127.0.0.1:$PlatformPort/kontur"
    POSITIONS_FILE         = ($DriverPositionsFile -replace '\\', '/')
    CONTOUR_AUDIT_FILE     = (Join-Path $LogDir 'contour-audit.jsonl')
    NEXT_TELEMETRY_DISABLED = '1'
}

# Сначала сервер водителя: APK синхронизируется независимо от диспетчерской.
$driverOk = Start-DrService -Name 'driver-api' -Port $DriverApiPort -WorkDir $DriverStandalone `
    -Env $driverEnv -PidFile $driverPid `
    -HealthUrl "http://127.0.0.1:$DriverApiPort/driver/api/driver/v1/sync/pull?cursor=0"
if (-not $driverOk) { exit 1 }

Write-Output "Dispatcher (monolith): http://127.0.0.1:$PlatformPort/kontur"
Write-Output "Driver API: $DriverApiUrl"
exit 0
