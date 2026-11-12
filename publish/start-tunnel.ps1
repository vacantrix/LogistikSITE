. "$PSScriptRoot\config.ps1"

$pidFile = Join-Path $LogDir 'tuna.pid'
if (Test-Path $pidFile) {
    $old = 0
    [void][int]::TryParse((Get-Content $pidFile -ErrorAction SilentlyContinue), [ref]$old)
    if ($old -gt 0) {
        $proc = Get-Process -Id $old -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq 'tuna') {
            Write-Output "tunnel already running: pid=$old $PublicUrl"
            exit 0
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path $TunaExe)) {
    Write-Output "ERROR: tuna CLI not found: $TunaExe"
    exit 1
}
if (-not (Test-TunaSession)) {
    Write-Output "ERROR: tuna is not logged in."
    Write-Output "Run once: `"$TunaExe`" login"
    exit 1
}

$env:TUNA_FORCE_IPV4 = '1'
$outLog = Join-Path $LogDir 'tuna.out.log'
$errLog = Join-Path $LogDir 'tuna.err.log'

$p = Start-Process -FilePath $TunaExe `
    -ArgumentList @('http', "$PlatformPort", "--subdomain=$TunaSubdomain", '--https-redirect', '--inspect=false', '--no-colors') `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Set-Content -Path $pidFile -Value $p.Id -Encoding ascii

$headers = @{ 'tuna-skip-browser-warning' = 'true' }
if (-not (Wait-HttpOk -Url "$PublicUrl/" -TimeoutSec 75 -Headers $headers)) {
    Write-Output "ERROR: public URL did not become reachable: $PublicUrl"
    Write-Output "stderr tail:"
    Get-LogTail $errLog 30
    exit 1
}

Write-Output "tunnel started: pid=$($p.Id) $PublicUrl"
