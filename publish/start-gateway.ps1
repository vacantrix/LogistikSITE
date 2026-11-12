. "$PSScriptRoot\config.ps1"

$pidFile = Join-Path $LogDir 'gateway.pid'
$owner = Get-PortOwner $GatewayPort
if ($owner -gt 0) {
    Write-Output "gateway already running: pid=$owner port=$GatewayPort"
    exit 0
}

$server = Join-Path $PublishDir 'landing-server.mjs'
if (-not (Test-Path $server)) {
    Write-Output "ERROR: gateway script not found: $server"
    exit 1
}

$env:GATEWAY_PORT = "$GatewayPort"
$env:GATEWAY_HOST = '127.0.0.1'
$outLog = Join-Path $LogDir 'gateway.out.log'
$errLog = Join-Path $LogDir 'gateway.err.log'

$p = Start-Process -FilePath $NodeExe `
    -ArgumentList @($server) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Set-Content -Path $pidFile -Value $p.Id -Encoding ascii

$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$GatewayPort/" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) {
            Write-Output "gateway started: pid=$($p.Id) http://127.0.0.1:$GatewayPort"
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}

Write-Output "ERROR: gateway did not answer on http://127.0.0.1:$GatewayPort"
Get-LogTail $errLog 20
exit 1
