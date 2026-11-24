param(
    [ValidateSet("debug", "release")][string]$Configuration = "debug"
)

$ErrorActionPreference = "Stop"

# Сборка Android-приложения водителя из монорепозитория.
# Требуется JDK 17, Android SDK (platform 34, build-tools 34.0.0) и Gradle 8.9.
# Пути можно задать переменными JAVA_HOME / ANDROID_SDK_ROOT / ANDROID_HOME,
# иначе скрипт ищет локальный toolchain в %USERPROFILE%\android-build
# (так он устроен на стенде АЭМЗ). В git toolchain не входит.

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$androidProject = Join-Path $repoRoot "driver\download\azmz-karkas\android"
if (-not (Test-Path (Join-Path $androidProject "settings.gradle.kts"))) {
    throw "Android project not found: $androidProject"
}

$toolRoot = if ($env:AEMZ_ANDROID_TOOLCHAIN) { $env:AEMZ_ANDROID_TOOLCHAIN } else { Join-Path $env:USERPROFILE "android-build" }
$jdk = if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) { $env:JAVA_HOME } else { Join-Path $toolRoot "jdk-17" }
$sdk = if ($env:ANDROID_SDK_ROOT -and (Test-Path $env:ANDROID_SDK_ROOT)) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) { $env:ANDROID_HOME } else { Join-Path $toolRoot "sdk" }
$gradleHome = Join-Path $toolRoot "gradle-home-test"
$initScript = Join-Path $PSScriptRoot "mirror.init.gradle"
$logPath = Join-Path $env:TEMP "azmz-build-apk.log"

if (-not (Test-Path (Join-Path $jdk "bin\java.exe"))) { throw "JDK 17 not found: $jdk (set JAVA_HOME)" }
if (-not (Test-Path (Join-Path $sdk "platforms\android-34\android.jar"))) { throw "Android platform 34 not found: $sdk (set ANDROID_SDK_ROOT)" }

$gradleBat = Join-Path $toolRoot "gradle-8.9\bin\gradle.bat"
$gradleCmd = $null
if (Test-Path $gradleBat) {
    $gradleCmd = $gradleBat
} else {
    $g = Get-Command gradle -ErrorAction SilentlyContinue
    if ($g) { $gradleCmd = $g.Source }
}
if (-not $gradleCmd) { throw "Gradle not found: $gradleBat (or add gradle to PATH)" }

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = (Join-Path $jdk "bin") + ";" + (Join-Path $sdk "build-tools\34.0.0") + ";" + (Join-Path $sdk "platform-tools") + ";" + $env:Path
$env:GRADLE_USER_HOME = $gradleHome

Write-Output "JAVA_HOME=$jdk"
Write-Output "ANDROID_SDK_ROOT=$sdk"
Write-Output "ANDROID_PROJECT=$androidProject"

$sdkForProperties = $sdk -replace "\\", "/"
Set-Content -Path (Join-Path $androidProject "local.properties") -Value "sdk.dir=$sdkForProperties" -Encoding ascii

$task = "assembleDebug"
if ($Configuration -eq "release") { $task = "assembleRelease" }

Push-Location $androidProject
try {
    $gradleArgs = @(
        "--no-daemon",
        "-g", $gradleHome,
        "-Dorg.gradle.internal.http.connectionTimeout=30000",
        "-Dorg.gradle.internal.http.socketTimeout=120000",
        $task,
        "--console=plain",
        "--stacktrace"
    )
    if (Test-Path $initScript) { $gradleArgs = @("-I", $initScript) + $gradleArgs }
    $quoted = $gradleArgs | ForEach-Object { if ($_ -match "\s") { '"' + $_ + '"' } else { $_ } }
    $cmdLine = '"' + $gradleCmd + '" ' + ($quoted -join ' ') + ' > "' + $logPath + '" 2>&1'
    Write-Output "running gradle $task..."
    & cmd.exe /c $cmdLine
    $code = $LASTEXITCODE
    Write-Output "GRADLE_EXIT=$code"
    if ($code -ne 0) {
        Write-Output "--- last 80 log lines ($logPath) ---"
        Get-Content $logPath -Tail 80 -ErrorAction SilentlyContinue
        throw "Gradle build failed: $code"
    }
} finally {
    Pop-Location
}

$apk = Join-Path $androidProject "app\build\outputs\apk\$Configuration\app-$Configuration.apk"
if (-not (Test-Path $apk)) { throw "APK not found: $apk" }

$target = Join-Path $repoRoot "driver\download\azmz-driver.apk"
Copy-Item $apk $target -Force
$file = Get-Item $target
$hash = (Get-FileHash $target -Algorithm SHA256).Hash
Write-Output ("APK: {0}" -f $target)
Write-Output ("size: {0:N0} bytes ({1:N1} MB)" -f $file.Length, ($file.Length / 1MB))
Write-Output "SHA256=$hash"
Write-Output "BUILD_OK"
Write-Output "Next: publish\publish-apk.ps1"
