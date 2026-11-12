# LogistikSITE — боевой запуск одним кликом.
# Поднимает OCR, платформу, локальный шлюз и Caddy, проверяет публичный HTTPS
# и открывает сайт в браузере. Запускается ярлыком с рабочего стола.

param(
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\config.ps1"

# Корректная кириллица в консоли Windows PowerShell 5.1.
try {
    chcp 65001 > $null
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }
try { $Host.UI.RawUI.WindowTitle = 'LogistikSITE — боевой запуск' } catch { }

$startAll = Join-Path $PublishDir 'start-all.ps1'
$statusScript = Join-Path $PublishDir 'status.ps1'
$launcherLog = Join-Path $LogDir 'launcher.log'
$startOut = Join-Path $LogDir 'launcher-start.out.log'
$startErr = Join-Path $LogDir 'launcher-start.err.log'
$statusOut = Join-Path $LogDir 'launcher-status.out.log'
$statusErr = Join-Path $LogDir 'launcher-status.err.log'

function Write-Step([string]$text) {
    Write-Host ""
    Write-Host "  $text" -ForegroundColor Cyan
}

function Write-Ok([string]$text) {
    Write-Host "  [OK] $text" -ForegroundColor Green
}

function Write-Warn([string]$text) {
    Write-Host "  [!] $text" -ForegroundColor Yellow
}

function Write-Fail([string]$text) {
    Write-Host "  [X] $text" -ForegroundColor Red
}

function Add-LauncherLog([string]$text) {
    try {
        Add-Content -Path $launcherLog -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text) -Encoding utf8
    } catch { }
}

function Show-Tail([string]$path, [int]$lines = 25) {
    if (Test-Path $path) {
        $tail = Get-Content $path -Tail $lines -ErrorAction SilentlyContinue
        if ($tail) {
            Write-Host ""
            Write-Host "  Последние строки $([System.IO.Path]::GetFileName($path)):" -ForegroundColor DarkGray
            $tail | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        }
    }
}

Clear-Host
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor DarkYellow
Write-Host "     Vacantrix + LogistikSITE — запуск" -ForegroundColor White
Write-Host "     Портал + демо + OCR + HTTPS" -ForegroundColor DarkGray
Write-Host "  ==============================================" -ForegroundColor DarkYellow
Write-Host ""
Write-Host "  Портал Vacantrix: $MainUrl" -ForegroundColor White
Write-Host "  Каталог:          $PortalCatalogUrl" -ForegroundColor White
Write-Host "  Демо LogistikSITE: $DemoUrl" -ForegroundColor White
Write-Host "  Локальный вход:  http://127.0.0.1:$GatewayPort/" -ForegroundColor DarkGray
Add-LauncherLog "=== launch ==="

# --- 1. Проверка окружения -------------------------------------------------
Write-Step "Проверяю окружение..."

$missing = @()
if (-not (Test-Path $startAll)) { $missing += $startAll }
if (-not (Test-Path $statusScript)) { $missing += $statusScript }
if (-not (Test-Path $PortalAuthScript)) { $missing += $PortalAuthScript }
if (-not (Test-Path $CaddyExe)) { $missing += $CaddyExe }
if (-not (Test-Path $Caddyfile)) { $missing += $Caddyfile }
$portalIndex = Join-Path $PublishDir 'portal\index.html'
$portalHh = Join-Path $PublishDir 'portal\dl\VacantrixHH.exe'
if (-not (Test-Path $portalIndex)) { $missing += $portalIndex }
if (-not (Test-Path $portalHh)) { $missing += $portalHh }
if (-not (Test-Path (Join-Path $RepoRoot '.next\standalone\server.js'))) { $missing += (Join-Path $RepoRoot '.next\standalone\server.js') }
$ocrStart = Join-Path $RepoRoot 'mini-services\paddle-ocr\bench-v6\start-service.ps1'
if (-not (Test-Path $ocrStart)) { $missing += $ocrStart }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $missing += 'node.exe' }

if ($missing.Count -gt 0) {
    Write-Fail "Не найдены обязательные компоненты:"
    $missing | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "  Если отсутствует сборка .next — выполните build-public.ps1." -ForegroundColor Yellow
    Add-LauncherLog "missing: $($missing -join '; ')"
    Write-Host ""
    if (-not $NoPause) { Read-Host "  Нажмите Enter, чтобы закрыть" }
    exit 1
}
Write-Ok "все файлы на месте"

$firewallOk = Get-NetFirewallRule -DisplayName 'LogistikSITE caddy TCP 443' -ErrorAction SilentlyContinue
if (-not $firewallOk) {
    Write-Warn "нет правила файрвола для Caddy TCP 443 — выполните open-inbound.ps1 от администратора"
} else {
    Write-Ok "правило файрвола TCP 443 есть"
}

# --- 2. Запуск стека --------------------------------------------------------
Write-Step "Запускаю портал, платформу, шлюз, OCR и Caddy..."
Write-Host "  Первый запуск OCR занимает до 3 минут. Не закрывайте окно." -ForegroundColor DarkGray

$started = Get-Date
$proc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $startAll) `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $startOut -RedirectStandardError $startErr

$spin = @('|', '/', '-', '\')
$i = 0
while (-not $proc.HasExited) {
    $elapsed = [int]((Get-Date) - $started).TotalSeconds
    Write-Host ("`r  {0} Идёт запуск... {1} с" -f $spin[$i % 4], $elapsed) -NoNewline -ForegroundColor Cyan
    $i++
    Start-Sleep -Milliseconds 500
}
$proc.WaitForExit()
Write-Host "`r  Запуск завершён за $([int]((Get-Date) - $started).TotalSeconds) с.          " -ForegroundColor Cyan

$startText = if (Test-Path $startOut) { Get-Content $startOut -Raw -ErrorAction SilentlyContinue } else { '' }
$startText -split "`r?`n" | Where-Object { $_.Trim() } | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
Add-LauncherLog $startText

$startExit = $proc.ExitCode
$startLooksOk = ($startText -match 'Portal: https://') -and ($startText -match 'Catalog: https://') -and ($startText -notmatch 'ERROR:')
if (($null -ne $startExit -and $startExit -ne 0) -or -not $startLooksOk) {
    $exitText = if ($null -eq $startExit) { 'нет кода' } else { $startExit }
    Write-Fail "Стек завершился с ошибкой (код $exitText)."
    Show-Tail $startErr 30
    Show-Tail (Join-Path $LogDir 'caddy.err.log') 20
    Show-Tail (Join-Path $RepoRoot 'mini-services\paddle-ocr\bench-v6\logs\service-3031.err.log') 20
    Write-Host ""
    if (-not $NoPause) { Read-Host "  Нажмите Enter, чтобы закрыть" }
    exit 1
}

# --- 3. Проверка состояния -------------------------------------------------
Write-Step "Проверяю состояние и публичный HTTPS..."

$statusProc = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $statusScript) `
    -WindowStyle Hidden -PassThru -Wait `
    -RedirectStandardOutput $statusOut -RedirectStandardError $statusErr

$statusText = if (Test-Path $statusOut) { Get-Content $statusOut -Raw -ErrorAction SilentlyContinue } else { '' }
$statusText -split "`r?`n" | Where-Object { $_.Trim() } | ForEach-Object {
    $line = $_
    if ($line -match 'UP|OK|200|RESULT: OK') { Write-Host "    $line" -ForegroundColor Green }
    elseif ($line -match 'FAIL|DOWN|MISMATCH|ATTENTION') { Write-Host "    $line" -ForegroundColor Yellow }
    else { Write-Host "    $line" -ForegroundColor Gray }
}
Add-LauncherLog $statusText

$ipMismatch = $statusText -match 'IP MISMATCH'
$allOk = $statusText -match 'RESULT: OK'

# --- 4. Итог ----------------------------------------------------------------
if ($allOk) {
    Write-Host ""
    Write-Host "  ==============================================" -ForegroundColor Green
    Write-Host "     Стенд работает в боевом режиме" -ForegroundColor Green
    Write-Host "  ==============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Портал:   $MainUrl" -ForegroundColor White
    Write-Host "  Каталог:  $PortalCatalogUrl" -ForegroundColor White
    Write-Host "  Демо:     $DemoUrl" -ForegroundColor White
    Write-Host "  Платформа локально: http://127.0.0.1:$PlatformPort/" -ForegroundColor DarkGray
    Write-Host "  OCR:      локально, 127.0.0.1:$OcrPort" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Открываю портал Vacantrix в браузере..." -ForegroundColor Cyan
    try { Start-Process $MainUrl } catch { Write-Warn "не удалось открыть браузер: $($_.Exception.Message)" }
    Add-LauncherLog "result: OK"
} elseif ($ipMismatch) {
    Write-Host ""
    Write-Host "  ==============================================" -ForegroundColor Yellow
    Write-Host "     Стек запущен, но IP изменился" -ForegroundColor Yellow
    Write-Host "  ==============================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Локально всё работает: http://127.0.0.1:$GatewayPort/" -ForegroundColor White
    Write-Host "  Но домен $PublicHost указывает на старый IP." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Обновите A-записи в reg.ru:" -ForegroundColor White
    Write-Host "    Домен → DNS-серверы и управление зоной → A logistiksite и A @ (vacantrix.ru)" -ForegroundColor Gray
    Write-Host ""
    Add-LauncherLog "result: IP MISMATCH"
    try { Start-Process 'https://www.reg.ru/user/account/card/120565341/nss/' } catch { }
    try { Start-Process "http://127.0.0.1:$GatewayPort/" } catch { }
} else {
    Write-Host ""
    Write-Host "  ==============================================" -ForegroundColor Red
    Write-Host "     Требуется внимание" -ForegroundColor Red
    Write-Host "  ==============================================" -ForegroundColor Red
    Write-Host ""
    Show-Tail (Join-Path $LogDir 'caddy.err.log') 25
    Show-Tail (Join-Path $LogDir 'platform.err.log') 20
    Show-Tail (Join-Path $RepoRoot 'mini-services\paddle-ocr\bench-v6\logs\service-3031.err.log') 20
    Write-Host ""
    Write-Host "  Полный отчёт: $statusOut" -ForegroundColor DarkGray
    Add-LauncherLog "result: ATTENTION"
}

Write-Host ""
Write-Host "  Окно можно закрыть — сервисы продолжат работать." -ForegroundColor DarkGray
Write-Host "  Повторный запуск безопасен: скрипт не создаёт дубликаты." -ForegroundColor DarkGray
Write-Host ""
if (-not $NoPause) { Read-Host "  Нажмите Enter, чтобы закрыть" }
exit $(if ($allOk -or $ipMismatch) { 0 } else { 1 })
