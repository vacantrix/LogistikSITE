param(
    [switch]$SkipInstall,
    [switch]$WithKontur
)

. "$PSScriptRoot\config.ps1"

# Сборка модуля водителя из монорепозитория: driver/ -> driver/.next/standalone.
# Платформа и модуль водителя — два независимых Next.js-приложения, но живут
# в одном репозитории и запускаются одним набором скриптов publish/.

$ErrorActionPreference = 'Stop'
$driverRoot = $DrivemobileRoot
if (-not (Test-Path (Join-Path $driverRoot 'package.json'))) {
    throw "Driver package not found: $driverRoot"
}

$nodeModules = Join-Path $driverRoot 'node_modules'
if (-not (Test-Path $nodeModules)) {
    if ($SkipInstall) { throw "driver/node_modules not found; run npm install in driver/" }
    Write-Output 'Installing driver dependencies (npm install)...'
    Push-Location $driverRoot
    try {
        & npm.cmd install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install failed: $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

$env:NODE_ENV = 'production'
$env:NEXT_TELEMETRY_DISABLED = '1'
$log = Join-Path $LogDir 'build-driver.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Output '=== Build driver module (Next.js) ==='
Push-Location $driverRoot
try {
    & npx.cmd next build 2>&1 | Tee-Object -FilePath $log
    if ($LASTEXITCODE -ne 0) { throw "driver next build failed: $LASTEXITCODE (see $log)" }
} finally {
    Pop-Location
}

function Sync-StandaloneAssets {
    param([string]$AppDir, [string]$StandaloneDir, [string]$Name)
    if (-not (Test-Path (Join-Path $StandaloneDir 'server.js'))) {
        throw "standalone server.js not found: $StandaloneDir"
    }
    $staticSrc = Join-Path $AppDir '.next\static'
    $staticDst = Join-Path $StandaloneDir '.next\static'
    if (-not (Test-Path $staticSrc)) { throw "static not found: $staticSrc" }
    if (Test-Path $staticDst) { Remove-Item $staticDst -Recurse -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $staticDst) | Out-Null
    Copy-Item $staticSrc $staticDst -Recurse -Force
    $publicSrc = Join-Path $AppDir 'public'
    $publicDst = Join-Path $StandaloneDir 'public'
    if (Test-Path $publicDst) { Remove-Item $publicDst -Recurse -Force }
    if (Test-Path $publicSrc) { Copy-Item $publicSrc $publicDst -Recurse -Force }
    Write-Output "$Name assets: .next/static and public refreshed"
}

Sync-StandaloneAssets -AppDir $driverRoot -StandaloneDir $DriverStandalone -Name 'driver'

if ($WithKontur) {
    $konturRoot = Join-Path $driverRoot 'kontur-1c'
    if (-not (Test-Path (Join-Path $konturRoot 'package.json'))) {
        throw "Standalone Kontur not found: $konturRoot"
    }
    if (-not (Test-Path (Join-Path $konturRoot 'node_modules'))) {
        if ($SkipInstall) { throw "driver/kontur-1c/node_modules not found; run npm install there" }
        Write-Output 'Installing standalone Kontur dependencies (npm install)...'
        Push-Location $konturRoot
        try {
            & npm.cmd install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "npm install (kontur-1c) failed: $LASTEXITCODE" }
        } finally {
            Pop-Location
        }
    }
    Write-Output '=== Build standalone Kontur 1C (legacy local stack) ==='
    $konturLog = Join-Path $LogDir 'build-kontur-1c.log'
    Push-Location $konturRoot
    try {
        & npx.cmd next build 2>&1 | Tee-Object -FilePath $konturLog
        if ($LASTEXITCODE -ne 0) { throw "kontur-1c next build failed: $LASTEXITCODE (see $konturLog)" }
    } finally {
        Pop-Location
    }
}

Write-Output "BUILD_DRIVER_OK: $driverRoot"
Write-Output "standalone: $DriverStandalone"
