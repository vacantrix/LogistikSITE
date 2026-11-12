. "$PSScriptRoot\config.ps1"

$stopped = @()
$pidFile = Join-Path $LogDir 'tuna.pid'

if (Test-Path $pidFile) {
    $p = 0
    [void][int]::TryParse((Get-Content $pidFile -ErrorAction SilentlyContinue), [ref]$p)
    if ($p -gt 0) {
        $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq 'tuna') {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            $stopped += "pid=$p"
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# Sweep leftovers of this tunnel (same subdomain in the command line)
try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='tuna.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$TunaSubdomain*" }
    foreach ($proc in $procs) {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        $stopped += "sweep=$($proc.ProcessId)"
    }
} catch { }

if ($stopped.Count -eq 0) {
    Write-Output "tunnel is not running"
} else {
    Write-Output "tunnel stopped: $($stopped -join ', ')"
}
exit 0
