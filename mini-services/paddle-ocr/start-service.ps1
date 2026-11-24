param(
    [int]$Port = 3031,
    [ValidateSet("0", "1", "auto")][string]$LowMemory = "auto"
)

# Запуск локального OCR-движка PaddleOCR (порт 3031 по умолчанию).
# Скрипт переносимый: работает из любого каталога и сам выбирает окружение.
#   .venv-v6 + .models-v6  — боевой набор PP-OCRv6 (если развёрнут);
#   .venv + .models        — обычный набор PP-OCRv5 после `pip install -r requirements.txt`.
# Модели и окружения в git не входят (см. README и .gitignore).

$ErrorActionPreference = "Stop"
$svc = $PSScriptRoot
$logDir = Join-Path $svc "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$existing = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    throw "Port $Port is already in use (PID $($existing.OwningProcess))"
}

$venvV6 = Join-Path $svc ".venv-v6\Scripts\python.exe"
$venv = Join-Path $svc ".venv\Scripts\python.exe"

if (Test-Path $venvV6) {
    $python = $venvV6
    $models = Join-Path $svc ".models-v6"
    $env:PADDLE_PDX_CACHE_HOME = $models
    $env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = "1"
    $env:OCR_DET_FAST = "PP-OCRv5_mobile_det"
    $env:OCR_DET_ACCURATE = "PP-OCRv6_medium_det"
    $env:OCR_REC_MODEL = "PP-OCRv6_medium_rec"
    $customRec = Join-Path $models "custom\metrika_PP-OCRv6_medium_rec_cyrillic"
    if (Test-Path $customRec) {
        $env:OCR_REC_MODEL_DIR = $customRec
    } else {
        Remove-Item Env:OCR_REC_MODEL_DIR -ErrorAction SilentlyContinue
    }
} elseif (Test-Path $venv) {
    $python = $venv
    $models = Join-Path $svc ".models"
    $env:PADDLE_PDX_CACHE_HOME = $models
} else {
    throw "Python venv not found: $venvV6 or $venv. Run: python -m venv .venv; .venv\Scripts\pip install -r requirements.txt"
}

$env:PADDLE_OCR_PORT = "$Port"
$env:OCR_TIME_BUDGET = "90"
$env:PYTHONIOENCODING = "utf-8"
if ($LowMemory -ne "auto") {
    $env:OCR_LOW_MEMORY = $LowMemory
} else {
    Remove-Item Env:OCR_LOW_MEMORY -ErrorAction SilentlyContinue
}

$outLog = Join-Path $logDir "service-$Port.log"
$errLog = Join-Path $logDir "service-$Port.err.log"
$pidFile = Join-Path $logDir "service-$Port.pid"

$p = Start-Process -FilePath $python `
    -ArgumentList "server.py" `
    -WorkingDirectory $svc `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Set-Content -Path $pidFile -Value $p.Id -Encoding ascii
"started pid=$($p.Id) port=$Port low_memory=$LowMemory python=$python"
"stdout=$outLog"
"stderr=$errLog"
