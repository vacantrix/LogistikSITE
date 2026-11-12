param(
    [int]$TimeoutMinutes = 0,
    [int]$IntervalSeconds = 120
)

# Включает основной домен после того, как reg.ru применит зону:
# ждёт, пока vacantrix.ru и www.vacantrix.ru начнут резолвиться на этот ПК,
# затем перечитывает Caddyfile без остановки Caddy и проверяет HTTPS.
#
#   -TimeoutMinutes 0    — одна проверка (удобно для запуска по расписанию)
#   -TimeoutMinutes 1440 — ждать до 24 часов, проверяя каждые 2 минуты

. "$PSScriptRoot\config.ps1"

$script:logPath = Join-Path $LogDir 'main-domain.log'

function Write-Log {
    param([string]$Message)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message"
    Write-Output $line
    Add-Content -Path $script:logPath -Value $line -Encoding UTF8
}

function Get-PublicIp {
    try {
        return (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 10).ip
    } catch {
        return $null
    }
}

function Get-DohIps {
    param([string]$Name)
    foreach ($doh in @('https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve')) {
        try {
            $raw = curl.exe -sS --max-time 10 -H 'Accept: application/dns-json' "${doh}?name=${Name}&type=A" 2>$null
            if ($LASTEXITCODE -eq 0 -and $raw) {
                $json = $raw | ConvertFrom-Json
                $ips = @($json.Answer | Where-Object { $_.type -eq 1 } | ForEach-Object { $_.data })
                if ($json.Status -eq 0 -and $ips.Count -gt 0) { return $ips }
            }
        } catch { }
    }
    return @()
}

function Test-LocalHttps {
    param([string]$HostName)
    # config.ps1 включает ErrorActionPreference=Stop, а curl при неудачном
    # TLS-рукопожатии пишет в stderr. Для проверки это ожидаемый результат.
    $ErrorActionPreference = 'Continue'
    $code = curl.exe -sS --ssl-no-revoke --max-time 15 --resolve "${HostName}:443:127.0.0.1" "https://$HostName/" -o NUL -w "%{http_code}" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $code) { return $null }
    return [int]$code
}

function Test-MainDomainServed {
    $apex = Test-LocalHttps $MainHost
    $www = Test-LocalHttps "www.$MainHost"
    return ($apex -eq 200 -and $www -in @(301, 302, 307, 308))
}

function Wait-MainDomainServed {
    param([int]$TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-MainDomainServed) { return $true }
        Start-Sleep -Seconds 3
    }
    return $false
}

if (Test-MainDomainServed) {
    Write-Log "main domain already served: $MainUrl (apex 200, www redirect)"
    exit 0
}

$deadline = if ($TimeoutMinutes -gt 0) { (Get-Date).AddMinutes($TimeoutMinutes) } else { $null }

while ($true) {
    $publicIp = Get-PublicIp
    $apexIps = Get-DohIps $MainHost
    $wwwIps = Get-DohIps "www.$MainHost"

    $dnsReady = $publicIp -and ($apexIps -contains $publicIp) -and ($wwwIps -contains $publicIp)

    if ($dnsReady) {
        Write-Log "DNS ready: $MainHost=$($apexIps -join ',') www=$($wwwIps -join ',') ip=$publicIp"
        break
    }

    Write-Log "waiting DNS: $MainHost=$($apexIps -join ',') www=$($wwwIps -join ',') expected=$publicIp"
    if ($deadline -and (Get-Date) -ge $deadline) {
        Write-Log "timeout: DNS for $MainHost is still not pointed to this PC"
        exit 2
    }
    Start-Sleep -Seconds $IntervalSeconds
}

# Перечитываем конфиг на лету: Caddy не рвёт текущие соединения,
# а новые сертификаты для vacantrix.ru и www получает после применения DNS.
Write-Log "reloading caddy config: $Caddyfile"
# Caddy пишет info-лог в stderr; при ErrorActionPreference=Stop PowerShell
# принимает его за исключение и обрывает вызов.
$ErrorActionPreference = 'Continue'
$reloadOutput = & $CaddyExe reload --config $Caddyfile --adapter caddyfile 2>&1 | Out-String
$reloadCode = $LASTEXITCODE
if ($reloadOutput.Trim()) { Add-Content -Path $script:logPath -Value $reloadOutput.Trim() -Encoding UTF8 }

if ($reloadCode -ne 0) {
    Write-Log "reload failed (code=$reloadCode), restarting caddy"
    & (Join-Path $PSScriptRoot 'stop-caddy.ps1') | Out-Null
    & (Join-Path $PSScriptRoot 'start-caddy.ps1') | Out-Null
}

if (Wait-MainDomainServed -TimeoutSec 180) {
    Write-Log "main domain enabled: $MainUrl (apex 200, www redirect)"
    exit 0
}

Write-Log "ERROR: main domain is not served after reload; see caddy.err.log"
Get-LogTail (Join-Path $LogDir 'caddy.err.log') 30 | ForEach-Object { Add-Content -Path $script:logPath -Value $_ -Encoding UTF8 }
exit 1
