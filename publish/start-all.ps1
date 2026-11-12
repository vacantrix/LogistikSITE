. "$PSScriptRoot\config.ps1"

Write-Output "=== Vacantrix + LogistikSITE start ==="

# 0. Build integrity first: the production bundle must match current source
# and its artifacts must match publish\build-manifest.json. Starting a stale
# or damaged bundle would silently serve old code, so fail before any boot.
$verifyScript = Join-Path $PublishDir 'verify-stack.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $verifyScript -Mode build
if ($LASTEXITCODE -ne 0) {
    Write-Output "ERROR: production build does not match current source or artifacts are damaged."
    Write-Output "Rebuild: powershell -NoProfile -ExecutionPolicy Bypass -File `"$PublishDir\build-public.ps1`""
    exit 1
}

# 0.1 Проверяем, что публичная конфигурация портала на месте: сам сайт,
# каталог приложений и установщики. Иначе Caddy поднимет пустую витрину.
$portalDir = Join-Path $PublishDir 'portal'
$requiredPortal = @(
    (Join-Path $portalDir 'index.html'),
    (Join-Path $portalDir 'js\appdata.js'),
    (Join-Path $portalDir 'js\apps.js'),
    (Join-Path $portalDir 'js\appdetail.js'),
    (Join-Path $portalDir 'css\main.css'),
    (Join-Path $portalDir 'dl\VacantrixSetup.exe'),
    (Join-Path $portalDir 'dl\VacantrixHH.exe'),
    (Join-Path $portalDir 'dl\VacantrixAvito.exe'),
    (Join-Path $portalDir 'dl\VacantrixPublisher.exe'),
    (Join-Path $portalDir 'dl\VacantrixMonitor.exe'),
    (Join-Path $portalDir 'dl\VacantrixAnalytics.exe')
)
$missingPortal = @($requiredPortal | Where-Object { -not (Test-Path $_) })
if ($missingPortal.Count -gt 0) {
    Write-Output "ERROR: portal files are missing:"
    $missingPortal | ForEach-Object { Write-Output "  $_" }
    exit 1
}
Write-Output "portal files: OK (catalog, previews, 6 installers)"

# 1. OCR service (localhost only)
$ocrOwner = Get-PortOwner $OcrPort
if ($ocrOwner -gt 0) {
    Write-Output "OCR already running: pid=$ocrOwner port=$OcrPort"
} else {
    $startOcr = Join-Path $RepoRoot 'mini-services\paddle-ocr\bench-v6\start-service.ps1'
    if (-not (Test-Path $startOcr)) {
        Write-Output "ERROR: OCR start script not found: $startOcr"
        exit 1
    }
    try {
        & $startOcr -Port $OcrPort
    } catch {
        Write-Output "ERROR: failed to start OCR: $($_.Exception.Message)"
        exit 1
    }
}

$ocrUrl = "http://127.0.0.1:$OcrPort/health"
$deadline = (Get-Date).AddSeconds(180)
$ocrReady = $false
$ocrInfo = $null
while ((Get-Date) -lt $deadline) {
    try {
        $ocrInfo = Invoke-RestMethod -Uri $ocrUrl -TimeoutSec 5
        if ($ocrInfo.ok -and $ocrInfo.ready) {
            $ocrReady = $true
            break
        }
    } catch { }
    Start-Sleep -Seconds 3
}
if (-not $ocrReady) {
    Write-Output "ERROR: OCR is not ready on $ocrUrl"
    Get-LogTail (Join-Path $RepoRoot 'mini-services\paddle-ocr\bench-v6\logs\service-3031.err.log') 30
    exit 1
}
$ocrEngine = if ($ocrInfo.activeEngine) { $ocrInfo.activeEngine } else { $ocrInfo.engines.paddle.engine }
Write-Output "OCR ready: engine=$ocrEngine version=$($ocrInfo.version)"

# 2. Next.js platform on 127.0.0.1
& (Join-Path $PublishDir 'start-platform.ps1')
if ((Get-PortOwner $PlatformPort) -eq 0) {
    Write-Output "ERROR: platform is not listening on port $PlatformPort"
    exit 1
}

# 2.1 Real-time bus (socket.io, localhost:3003) — Caddy forwards ?XTransformPort=3003
$wsOwner = Get-PortOwner 3003
if ($wsOwner -gt 0) {
    Write-Output "WS already running: pid=$wsOwner port=3003"
} else {
    $wsOut = Join-Path $LogDir 'ws.out.log'
    $wsErr = Join-Path $LogDir 'ws.err.log'
    $wsProc = Start-Process -FilePath $NodeExe -ArgumentList @(
        '--env-file-if-exists=.env',
        '--env-file-if-exists=.env.local',
        'mini-services/ws-service/index.ts'
    ) -WorkingDirectory $RepoRoot -RedirectStandardOutput $wsOut -RedirectStandardError $wsErr -PassThru -WindowStyle Hidden
    Set-Content -Path (Join-Path $LogDir 'ws.pid') -Value $wsProc.Id -Encoding ascii
    $wsDeadline = (Get-Date).AddSeconds(30)
    $wsUp = $false
    while ((Get-Date) -lt $wsDeadline) {
        if ((Get-PortOwner 3003) -gt 0) { $wsUp = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $wsUp) {
        Write-Output "ERROR: real-time service is not listening on port 3003"
        Get-LogTail $wsErr 30
        exit 1
    }
    Write-Output "real-time service started: pid=$($wsProc.Id) port=3003"
}

# 3. Local gateway: landing + /demo
& (Join-Path $PublishDir 'start-gateway.ps1')
if ((Get-PortOwner $GatewayPort) -eq 0) {
    Write-Output "ERROR: gateway is not listening on port $GatewayPort"
    exit 1
}

# 4. Локальный вход портала (SQLite, без писем)
& (Join-Path $PublishDir 'start-portal-auth.ps1')
if ((Get-PortOwner $PortalAuthPort) -eq 0) {
    Write-Output "ERROR: portal-auth is not listening on port $PortalAuthPort"
    exit 1
}

# 5. Public HTTPS entry (Caddy, Let's Encrypt)
& (Join-Path $PublishDir 'start-caddy.ps1')
if ((Get-PortOwner 443) -eq 0) {
    Write-Output "ERROR: caddy is not listening on 443"
    exit 1
}

# 5.1 Runtime verification: architecture (loopback-only topology, Caddy routes,
# DB, HTTP health) and access (permission engine: admin can open Profiles and
# access, non-admin is denied, templates/users/effective rights load).
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $verifyScript -Mode runtime
if ($LASTEXITCODE -ne 0) {
    Write-Output "ERROR: runtime architecture/access verification failed."
    exit 1
}

# 6. Динамический IP: A-запись в reg.ru должна совпадать с текущим внешним адресом.
try {
    $doh = curl.exe -sS --max-time 10 -H 'Accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=${PublicHost}&type=A" 2>$null | ConvertFrom-Json
    $dnsIp = (@($doh.Answer | Where-Object { $_.type -eq 1 }) | Select-Object -First 1).data
    $publicIp = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 10).ip
} catch {
    $dnsIp = $null
    $publicIp = $null
}

$publicWorks = $false
try {
    $pubCheck = Invoke-WebRequest -Uri "$PublicUrl/" -UseBasicParsing -TimeoutSec 30
    $publicWorks = ($pubCheck.StatusCode -eq 200)
} catch { }

if ($dnsIp -and $publicIp -and $dnsIp -ne $publicIp -and -not $publicWorks) {
    Write-Output "WARNING: public IP is $publicIp, but DNS A record is $dnsIp"
    Write-Output "Update A $PublicHost at reg.ru."

    # Не спамим уведомлением: не чаще одного раза в 6 часов.
    $stamp = Join-Path $LogDir 'ip-warning.last'
    $notify = $true
    if (Test-Path $stamp) {
        if (((Get-Date) - (Get-Item $stamp).LastWriteTime).TotalHours -lt 6) { $notify = $false }
    }
    if ($notify) {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing
            $icon = New-Object System.Windows.Forms.NotifyIcon
            $icon.Icon = [System.Drawing.SystemIcons]::Warning
            $icon.Visible = $true
            $icon.ShowBalloonTip(15000, 'LogistikSITE', "IP изменился: $publicIp. Обновите A $PublicHost в reg.ru (сейчас $dnsIp).", [System.Windows.Forms.ToolTipIcon]::Warning)
            Start-Sleep -Seconds 3
            $icon.Dispose()
        } catch { }
        Set-Content -Path $stamp -Value (Get-Date -Format o) -Encoding ascii
    }
} elseif ($dnsIp -and $publicIp) {
    if ($dnsIp -ne $publicIp -and $publicWorks) {
        Write-Output "DNS/IP check: OK (outbound $publicIp is VPN/NAT; public HTTPS 200)"
    } else {
        Write-Output "DNS/IP check: OK ($publicIp)"
    }
}

Write-Output ""
Write-Output "Portal: $MainUrl"
Write-Output "Catalog: $PortalCatalogUrl"
Write-Output "LogistikSITE demo: $DemoUrl"
Write-Output "Platform local: http://127.0.0.1:$PlatformPort/"
Write-Output "Status: powershell -NoProfile -ExecutionPolicy Bypass -File `"$PublishDir\status.ps1`""
exit 0
