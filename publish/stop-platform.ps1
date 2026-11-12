. "$PSScriptRoot\config.ps1"

$stopped = @()
$pidFile = Join-Path $LogDir 'platform.pid'

if (Test-Path $pidFile) {
    $p = 0
    [void][int]::TryParse((Get-Content $pidFile -ErrorAction SilentlyContinue), [ref]$p)
    if ($p -gt 0) {
        $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq 'node') {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            $stopped += "pid=$p"
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$owner = Get-PortOwner $PlatformPort
if ($owner -gt 0) {
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    $stopped += "listener=$owner"
}

Start-Sleep -Seconds 1
$left = Get-PortOwner $PlatformPort
if ($left -gt 0) {
    Write-Output "ERROR: port $PlatformPort is still in use by pid=$left"
    exit 1
}

if ($stopped.Count -eq 0) {
    Write-Output "platform is not running"
} else {
    Write-Output "platform stopped: $($stopped -join ', ')"
}
exit 0
