. "$PSScriptRoot\config.ps1"

$pidFile = Join-Path $LogDir 'gateway.pid'
$stopped = @()

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

try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*landing-server.mjs*' }
    foreach ($proc in $procs) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        $stopped += "sweep=$($proc.ProcessId)"
    }
} catch { }

if ($stopped.Count -eq 0) {
    Write-Output "gateway is not running"
} else {
    Write-Output "gateway stopped: $($stopped -join ', ')"
}
exit 0
