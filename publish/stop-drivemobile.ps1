. "$PSScriptRoot\config.ps1"

Write-Output "=== Drivemobile stop ==="

# Диспетчерская «Контур» работает внутри платформы и останавливается
# вместе с ней (stop-platform.ps1). Здесь только API приложения водителя.
$pidFile = Join-Path $LogDir 'driver-api.pid'
$procId = 0
if (Test-Path $pidFile) {
    [void][int]::TryParse((Get-Content $pidFile -ErrorAction SilentlyContinue), [ref]$procId)
}
if ($procId -gt 0) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Output "driver-api stopped: pid=$procId"
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$owner = Get-PortOwner $DriverApiPort
if ($owner -gt 0) {
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    Write-Output "driver-api listener stopped: pid=$owner port=$DriverApiPort"
}

Write-Output "Done."
exit 0
