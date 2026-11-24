. "$PSScriptRoot\config.ps1"

# Публикация APK модуля водителя.
# Источник — driver/download/azmz-driver.apk (актуальная сборка 0.3.2-pilot,
# versionCode 6). Цели: публичный /dl/Drivemobile.apk и standalone-копия
# платформы. Сам APK не хранится в publish/portal (эта папка в .gitignore).

$ErrorActionPreference = 'Stop'
$source = Join-Path $DrivemobileRoot 'download\azmz-driver.apk'
if (-not (Test-Path $source)) {
    $source = Join-Path $DrivemobileRoot 'download\azmz-karkas\android\app\build\outputs\apk\debug\app-debug.apk'
}
if (-not (Test-Path $source)) {
    throw "APK not found. Build it first: tools\android-build\build-apk.ps1"
}

$targets = @(
    (Join-Path $PublishDir 'portal\dl\Drivemobile.apk'),
    (Join-Path $RepoRoot '.next\standalone\publish\portal\dl\Drivemobile.apk')
)

$apk = Get-Item $source
Write-Output ("source: {0}  {1:N1} MB" -f $apk.FullName, ($apk.Length / 1MB))
foreach ($target in $targets) {
    $dir = Split-Path -Parent $target
    if (-not (Test-Path $dir)) {
        Write-Output "skip (no dir): $target"
        continue
    }
    Copy-Item $source $target -Force
    $f = Get-Item $target
    $hash = (Get-FileHash $target -Algorithm SHA256).Hash
    Write-Output ("copied {0}  {1:N0} bytes  SHA256={2}" -f $target, $f.Length, $hash)
}
Write-Output 'DONE'
