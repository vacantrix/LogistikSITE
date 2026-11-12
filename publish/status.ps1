. "$PSScriptRoot\config.ps1"

$healthy = $true

Write-Output "=== LogistikSITE demo status ==="
Write-Output "public URL: $PublicUrl"
Write-Output "main URL:   $MainUrl"
Write-Output ""

$pOwner = Get-PortOwner $PlatformPort
if ($pOwner -gt 0) {
    Write-Output "platform port $PlatformPort : UP (pid=$pOwner)"
} else {
    Write-Output "platform port $PlatformPort : DOWN"
    $healthy = $false
}

try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$PlatformPort/" -UseBasicParsing -TimeoutSec 10
    Write-Output "platform HTTP        : $($r.StatusCode), $($r.Content.Length) bytes"
} catch {
    Write-Output "platform HTTP        : FAIL ($($_.Exception.Message))"
    $healthy = $false
}

$gOwner = Get-PortOwner $GatewayPort
if ($gOwner -gt 0) {
    Write-Output "gateway port $GatewayPort : UP (pid=$gOwner)"
} else {
    Write-Output "gateway port $GatewayPort : DOWN"
    $healthy = $false
}

try {
    $l = Invoke-WebRequest -Uri "http://127.0.0.1:$GatewayPort/" -UseBasicParsing -TimeoutSec 10
    Write-Output "landing HTTP         : $($l.StatusCode), $($l.Content.Length) bytes"
} catch {
    Write-Output "landing HTTP         : FAIL ($($_.Exception.Message))"
    $healthy = $false
}

# Локальный вход портала: без него не работают регистрация и кабинет vacantrix.ru.
$wsOwner = Get-PortOwner 3003
if ($wsOwner -gt 0) {
    Write-Output "real-time port 3003  : UP (pid=$wsOwner)"
    $wsCode = curl.exe -sS --max-time 5 -o NUL -w "%{http_code}" "http://127.0.0.1:3003/socket.io/?EIO=4&transport=polling" 2>$null
    if ($wsCode -in @('200', '403')) {
        Write-Output "real-time polling    : OK (code=$wsCode)"
    } else {
        Write-Output "real-time polling    : FAIL (code=$wsCode)"
        $healthy = $false
    }
} else {
    Write-Output "real-time port 3003  : DOWN"
    $healthy = $false
}

$paOwner = Get-PortOwner $PortalAuthPort
if ($paOwner -gt 0) {
    Write-Output "portal auth port $PortalAuthPort : UP (pid=$paOwner)"
} else {
    Write-Output "portal auth port $PortalAuthPort : DOWN"
    $healthy = $false
}
try {
    $pa = Invoke-RestMethod -Uri "http://127.0.0.1:$PortalAuthPort/api/portal/health" -TimeoutSec 5
    Write-Output "portal auth health   : ok=$($pa.ok) users=$($pa.users)"
    if (-not $pa.ok) { $healthy = $false }
} catch {
    Write-Output "portal auth health   : FAIL ($($_.Exception.Message))"
    $healthy = $false
}

$caddyPid = 0
$caddyPidFile = Join-Path $LogDir 'caddy.pid'
if (Test-Path $caddyPidFile) {
    [void][int]::TryParse((Get-Content $caddyPidFile -ErrorAction SilentlyContinue), [ref]$caddyPid)
}
$caddyProc = if ($caddyPid -gt 0) { Get-Process -Id $caddyPid -ErrorAction SilentlyContinue } else { $null }
if ($caddyProc -and $caddyProc.ProcessName -eq 'caddy') {
    Write-Output "caddy process        : UP (pid=$caddyPid)"
} else {
    Write-Output "caddy process        : DOWN"
    $healthy = $false
}

$httpsPath = Join-Path $LogDir 'caddy-local-https.code'
curl.exe -sS --ssl-no-revoke --max-time 15 --resolve "${PublicHost}:443:127.0.0.1" "https://$PublicHost/" -o NUL -w "%{http_code}" 2>$null | Set-Content $httpsPath -Encoding ascii
$httpsCode = Get-Content $httpsPath -ErrorAction SilentlyContinue
if ($httpsCode -eq '200') {
    Write-Output "HTTPS local          : 200 (certificate OK)"
} else {
    Write-Output "HTTPS local          : FAIL (code=$httpsCode)"
    $healthy = $false
}

# Динамический IP: сверяем A-запись с текущим внешним адресом.
$dnsIp = $null
try {
    $doh = curl.exe -sS --max-time 10 -H 'Accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=${PublicHost}&type=A" 2>$null | ConvertFrom-Json
    $dnsIp = (@($doh.Answer | Where-Object { $_.type -eq 1 }) | Select-Object -First 1).data
} catch { }
$publicIp = $null
try {
    $publicIp = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 10).ip
} catch { }

if ($dnsIp) {
    Write-Output "DNS A record         : $dnsIp"
} else {
    Write-Output "DNS A record         : NOT FOUND"
    $healthy = $false
}
if ($publicIp) {
    Write-Output "current public IP    : $publicIp (outbound; VPN/NAT may differ from WAN)"
    if ($dnsIp -and $publicIp -ne $dnsIp) {
        Write-Output "IP NOTE              : outbound IP differs from DNS; checking actual public HTTPS"
    }
}

$publicReachable = $false
try {
    $pub = Invoke-WebRequest -Uri "$PublicUrl/" -UseBasicParsing -TimeoutSec 30
    Write-Output "public HTTPS         : $($pub.StatusCode), $($pub.Content.Length) bytes"
    $publicReachable = $true
} catch {
    Write-Output "public HTTPS         : FAIL ($($_.Exception.Message))"
    $healthy = $false
}
if ($publicReachable -and $dnsIp -and $publicIp -and $dnsIp -ne $publicIp) {
    Write-Output "IP OK                : DNS $dnsIp serves this PC (outbound $publicIp is VPN/NAT)"
}

# Основной домен начинает проверяться по HTTPS, как только его A-запись
# указывает на эту машину. До переключения DNS проверка пропускается.
$mainDnsIp = $null
try {
    $dohMain = curl.exe -sS --max-time 10 -H 'Accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=${MainHost}&type=A" 2>$null | ConvertFrom-Json
    $mainDnsIp = (@($dohMain.Answer | Where-Object { $_.type -eq 1 }) | Select-Object -First 1).data
} catch { }

if ($mainDnsIp) {
    Write-Output "main DNS A record    : $mainDnsIp"
} else {
    Write-Output "main DNS A record    : NOT FOUND"
}

if ($mainDnsIp -and $dnsIp -and $mainDnsIp -eq $dnsIp) {
    $mainPath = Join-Path $LogDir 'caddy-main-https.code'
    curl.exe -sS --ssl-no-revoke --max-time 15 --resolve "${MainHost}:443:127.0.0.1" "https://$MainHost/" -o NUL -w "%{http_code}" 2>$null | Set-Content $mainPath -Encoding ascii
    $mainCode = Get-Content $mainPath -ErrorAction SilentlyContinue
    if ($mainCode -eq '200') {
        Write-Output "HTTPS main domain    : 200 (certificate OK)"
    } else {
        Write-Output "HTTPS main domain    : FAIL (code=$mainCode)"
        $healthy = $false
    }

    # Каталог и установщики: проверяем именно боевую конфигурацию портала,
    # а не только главную страницу. /dl/* должен отдавать файл, а удалённый
    # Tasks — честный 404 (без SPA-фолбэка на index.html).
    $appsCode = curl.exe -sS --ssl-no-revoke --max-time 20 --resolve "${MainHost}:443:127.0.0.1" -o NUL -w "%{http_code}" "https://$MainHost/apps" 2>$null
    if ($appsCode -eq '200') {
        Write-Output "portal catalog       : 200"
    } else {
        Write-Output "portal catalog       : FAIL (code=$appsCode)"
        $healthy = $false
    }

    $dlHh = curl.exe -sS --ssl-no-revoke --max-time 30 -I --resolve "${MainHost}:443:127.0.0.1" "https://$MainHost/dl/VacantrixHH.exe" -o NUL -w "%{http_code}" 2>$null
    $dlTasks = curl.exe -sS --ssl-no-revoke --max-time 20 -I --resolve "${MainHost}:443:127.0.0.1" "https://$MainHost/dl/VacantrixTasks.exe" -o NUL -w "%{http_code}" 2>$null
    if ($dlHh -eq '200' -and $dlTasks -eq '404') {
        Write-Output "portal downloads     : OK (HH 200, Tasks 404)"
    } else {
        Write-Output "portal downloads     : FAIL (HH=$dlHh, Tasks=$dlTasks)"
        $healthy = $false
    }

    $wwwPath = Join-Path $LogDir 'caddy-www-https.code'
    curl.exe -sS --ssl-no-revoke --max-time 15 --resolve "www.${MainHost}:443:127.0.0.1" "https://www.$MainHost/" -o NUL -w "%{http_code}" 2>$null | Set-Content $wwwPath -Encoding ascii
    $wwwCode = Get-Content $wwwPath -ErrorAction SilentlyContinue
    if ($wwwCode -in @('301', '308')) {
        Write-Output "HTTPS www redirect   : $wwwCode -> $MainUrl"
    } else {
        Write-Output "HTTPS www redirect   : FAIL (code=$wwwCode)"
        $healthy = $false
    }
} else {
    Write-Output "HTTPS main domain    : skipped (DNS not pointed to this PC yet)"
}

$oOwner = Get-PortOwner $OcrPort
if ($oOwner -gt 0) {
    Write-Output "OCR port $OcrPort      : UP (pid=$oOwner)"
} else {
    Write-Output "OCR port $OcrPort      : DOWN"
    $healthy = $false
}

try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$OcrPort/health" -TimeoutSec 5
    $ocrEngine = if ($h.activeEngine) { $h.activeEngine } else { $h.engines.paddle.engine }
    Write-Output "OCR health           : ok=$($h.ok) ready=$($h.ready) engine=$ocrEngine processed=$($h.processed)"
    if (-not $h.ready) {
        $healthy = $false
    }
} catch {
    Write-Output "OCR health           : FAIL ($($_.Exception.Message))"
    $healthy = $false
}

if (Test-Path $DbPath) {
    $mb = [Math]::Round((Get-Item $DbPath).Length / 1MB, 1)
    Write-Output "database             : $mb MB"
} else {
    Write-Output "database             : MISSING ($DbPath)"
    $healthy = $false
}

Write-Output "logs                 : $LogDir"

# Mandatory startup checks: architecture, rights/access, build integrity.
# The verifier prints one line per check and returns non-zero on any failure.
$verifyScript = Join-Path $PublishDir 'verify-stack.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $verifyScript -Mode all -NoResult
if ($LASTEXITCODE -ne 0) { $healthy = $false }

if ($healthy) {
    Write-Output ""
    Write-Output "RESULT: OK"
    exit 0
} else {
    Write-Output ""
    Write-Output "RESULT: ATTENTION REQUIRED"
    exit 1
}
