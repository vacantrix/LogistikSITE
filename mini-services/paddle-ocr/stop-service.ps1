param(
    [int]$Port = 3031
)

# Останавливает OCR-движок, запущенный start-service.ps1.
$ErrorActionPreference = "Stop"
$svc = $PSScriptRoot
$pidFile = Join-Path $svc "logs\service-$Port.pid"

if (Test-Path $pidFile) {
    $servicePid = [int](Get-Content $pidFile -Raw).Trim()
    $proc = Get-Process -Id $servicePid -ErrorAction SilentlyContinue
    if ($proc) {
        Stop-Process -Id $servicePid -Force
        "stopped pid=$servicePid port=$Port"
    } else {
        "pid=$servicePid not running"
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    return
}

$conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force
    "stopped pid=$($conn.OwningProcess) port=$Port"
} else {
    "port $Port is not listening"
}
