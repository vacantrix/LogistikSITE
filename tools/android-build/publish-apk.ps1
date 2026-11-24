$ErrorActionPreference = "Stop"

# Копирует собранный APK из driver/download в публичные точки:
#   publish/portal/dl/Drivemobile.apk  -> https://.../dl/Drivemobile.apk
#   .next/standalone/publish/portal/dl/Drivemobile.apk (если платформа собрана)
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
& (Join-Path $repoRoot "publish\publish-apk.ps1")
