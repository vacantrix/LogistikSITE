. "$PSScriptRoot\config.ps1"

$pidFile = Join-Path $LogDir 'portal-auth.pid'
$healthUrl = "http://127.0.0.1:$PortalAuthPort/api/portal/health"

$owner = Get-PortOwner $PortalAuthPort
if ($owner -gt 0) {
    try {
        $h = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
        if ($h.ok) {
            Set-Content -Path $pidFile -Value $owner -Encoding ascii
            Write-Output "portal-auth already running: pid=$owner port=$PortalAuthPort"
            exit 0
        }
    } catch { }
    Write-Output "ERROR: port $PortalAuthPort is busy (pid=$owner), but portal-auth does not answer"
    exit 1
}

if (-not (Test-Path $PortalAuthScript)) {
    Write-Output "ERROR: portal auth script not found: $PortalAuthScript"
    exit 1
}
if (-not (Test-Path $NodeExe)) {
    Write-Output "ERROR: node.exe not found"
    exit 1
}

New-Item -ItemType Directory -Force -Path $PortalDataDir | Out-Null
$env:PORTAL_AUTH_HOST = '127.0.0.1'
$env:PORTAL_AUTH_PORT = "$PortalAuthPort"
$env:PORTAL_DATA_DIR = $PortalDataDir

$outLog = Join-Path $LogDir 'portal-auth.out.log'
$errLog = Join-Path $LogDir 'portal-auth.err.log'

$p = Start-Process -FilePath $NodeExe `
    -ArgumentList @($PortalAuthScript) `
    -WorkingDirectory $PublishDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Set-Content -Path $pidFile -Value $p.Id -Encoding ascii

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    try {
        $h = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
        if ($h.ok) {
            Write-Output "portal-auth started: pid=$($p.Id) http://127.0.0.1:$PortalAuthPort"
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}

Write-Output "ERROR: portal-auth did not answer on $healthUrl"
Get-LogTail $errLog 30
exit 1
