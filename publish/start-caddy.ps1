. "$PSScriptRoot\config.ps1"

function Get-LocalHttpsCode {
    param([string]$Name)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $code = curl.exe -sS --ssl-no-revoke --max-time 10 --resolve "${Name}:443:127.0.0.1" "https://$Name/" -o NUL -w "%{http_code}" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $code) { return $null }
        return [string]$code
    } finally {
        $ErrorActionPreference = $previous
    }
}

$pidFile = Join-Path $LogDir 'caddy.pid'
if (Test-Path $pidFile) {
    $old = 0
    [void][int]::TryParse((Get-Content $pidFile -ErrorAction SilentlyContinue), [ref]$old)
    if ($old -gt 0) {
        $proc = Get-Process -Id $old -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq 'caddy') {
            Write-Output "caddy already running: pid=$old $PublicUrl"
            exit 0
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path $CaddyExe)) {
    Write-Output "ERROR: caddy not found: $CaddyExe"
    exit 1
}
if (-not (Test-Path $Caddyfile)) {
    Write-Output "ERROR: Caddyfile not found: $Caddyfile"
    exit 1
}

# Локальный резолвер провайдера может держать отрицательный кэш дольше, чем
# публичные DNS, поэтому проверяем запись через DoH Cloudflare/Google.
$dnsOk = $false
foreach ($doh in @('https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve')) {
    try {
        $raw = curl.exe -sS --max-time 10 -H 'Accept: application/dns-json' "${doh}?name=${PublicHost}&type=A" 2>$null
        if ($LASTEXITCODE -eq 0 -and $raw) {
            $json = $raw | ConvertFrom-Json
            if ($json.Status -eq 0 -and @($json.Answer | Where-Object { $_.type -eq 1 }).Count -gt 0) {
                $dnsOk = $true
                break
            }
        }
    } catch { }
}
if (-not $dnsOk) {
    Write-Output "ERROR: $PublicHost has no public A record yet. Add it at reg.ru or wait for DNS propagation."
    exit 1
}

$outLog = Join-Path $LogDir 'caddy.out.log'
$errLog = Join-Path $LogDir 'caddy.err.log'

$p = Start-Process -FilePath $CaddyExe `
    -ArgumentList @('run', '--config', $Caddyfile, '--adapter', 'caddyfile') `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Set-Content -Path $pidFile -Value $p.Id -Encoding ascii

# Проверяем локально по HTTPS с подменой резолва на 127.0.0.1: так проверяется и сертификат,
# и маршрутизация, ещё до того как DNS разойдётся по миру.
$deadline = (Get-Date).AddSeconds(150)
while ((Get-Date) -lt $deadline) {
    curl.exe -sS --ssl-no-revoke --max-time 10 --resolve "${PublicHost}:443:127.0.0.1" "https://$PublicHost/" -o NUL 2>$null
    if ($LASTEXITCODE -eq 0) {
        # Если основной домен уже указывает на этот ПК, дожидаемся и его
        # сертификата: иначе status.ps1 сразу после запуска увидит ошибку.
        $ErrorActionPreference = 'Continue'
        $mainDnsIp = $null
        try {
            $dohMain = curl.exe -sS --max-time 10 -H 'Accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=${MainHost}&type=A" 2>$null | ConvertFrom-Json
            $mainDnsIp = (@($dohMain.Answer | Where-Object { $_.type -eq 1 }) | Select-Object -First 1).data
        } catch { }
        $publicIp = $null
        try {
            $publicIp = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 10).ip
        } catch { }
        if ($mainDnsIp -and $publicIp -and $mainDnsIp -eq $publicIp) {
            $mainDeadline = (Get-Date).AddSeconds(120)
            while ((Get-Date) -lt $mainDeadline) {
                $apex = Get-LocalHttpsCode $MainHost
                $www = Get-LocalHttpsCode "www.$MainHost"
                if ($apex -eq '200' -and $www -in @('301', '302', '307', '308')) { break }
                Start-Sleep -Seconds 2
            }
        }
        Write-Output "caddy started: pid=$($p.Id) $PublicUrl"
        exit 0
    }
    Start-Sleep -Seconds 2
}

Write-Output "ERROR: https://$PublicHost did not answer locally"
Get-LogTail $errLog 40
exit 1
