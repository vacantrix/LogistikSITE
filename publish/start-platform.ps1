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
$env:NEXT_TELEMETRY_DISABLED = '1'

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
