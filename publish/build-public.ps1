param(
    [switch]$KeepRunning
)

. "$PSScriptRoot\config.ps1"

$envPath = Join-Path $RepoRoot '.env.local'
if (-not (Test-Path $envPath)) {
    Write-Output "ERROR: .env.local not found: $envPath"
    exit 1
}

Write-Output "=== Build public LogistikSITE bundle ==="
Write-Output "Stopping the local platform before replacing .next ..."
& (Join-Path $PublishDir 'stop-platform.ps1')
if ((Get-PortOwner $PlatformPort) -gt 0) {
    Write-Output "ERROR: could not stop the platform"
    exit 1
}

$bak = "$envPath.bak-public-build"
Copy-Item $envPath $bak -Force
$buildLog = Join-Path $LogDir 'build.log'
$buildOk = $false

try {
    $lines = [System.IO.File]::ReadAllLines($envPath)
    $new = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        if ($line -match '^\s*NEXT_PUBLIC_WS_URL\s*=') {
            $new.Add('NEXT_PUBLIC_WS_URL=')
        } else {
            $new.Add($line)
        }
    }
    [System.IO.File]::WriteAllLines($envPath, $new, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "Public vars prepared for the build: NEXT_PUBLIC_WS_URL blanked, NEXT_PUBLIC_DEMO_PASSWORD kept (demo login button)."

    Remove-Item (Join-Path $RepoRoot '.next') -Recurse -Force -ErrorAction SilentlyContinue
    $env:NODE_ENV = 'production'
    $env:NEXT_TELEMETRY_DISABLED = '1'

    Push-Location $RepoRoot
    $prevEap = $ErrorActionPreference
    try {
        # Next.js пишет предупреждения Turbopack в stderr; при ErrorActionPreference=Stop
        # PowerShell 5.1 превращает их в terminating error, хотя сборка успешна.
        $ErrorActionPreference = 'Continue'
        & npx next build *> $buildLog
        $buildOk = ($LASTEXITCODE -eq 0)
    } finally {
        $ErrorActionPreference = $prevEap
        Pop-Location
    }

    if (-not $buildOk) {
        Write-Output "ERROR: next build failed. Log tail:"
        Get-LogTail $buildLog 40
        exit 1
    }

    $standalone = Join-Path $RepoRoot '.next\standalone'
    $staticDest = Join-Path $standalone '.next\static'
    $publicDest = Join-Path $standalone 'public'
    New-Item -ItemType Directory -Force -Path (Join-Path $standalone '.next') | Out-Null
    if (Test-Path $staticDest) { Remove-Item $staticDest -Recurse -Force }
    if (Test-Path $publicDest) { Remove-Item $publicDest -Recurse -Force }
    Copy-Item (Join-Path $RepoRoot '.next\static') $staticDest -Recurse -Force
    Copy-Item (Join-Path $RepoRoot 'public') $publicDest -Recurse -Force
    Write-Output "Standalone static and public assets copied."
} finally {
    Copy-Item $bak $envPath -Force
    Remove-Item $bak -Force -ErrorAction SilentlyContinue
}

$map = Import-DotEnv $envPath
$pw = $map['NEXT_PUBLIC_DEMO_PASSWORD']
if ($pw) {
    # Пароль намеренно присутствует в публичной сборке: на экране входа
    # должна быть кнопка «Демо-доступы» с логинами и паролем стенда.
    Write-Output "Demo access button enabled: NEXT_PUBLIC_DEMO_PASSWORD is embedded in the public build."
} else {
    Write-Output "WARNING: NEXT_PUBLIC_DEMO_PASSWORD is empty; the demo access button will be hidden."
}

Write-Output "Build complete: $(Join-Path $RepoRoot '.next\standalone\server.js')"

# Integrity manifest: hashes of build inputs and artifacts, checked by
# start-all.ps1 and status.ps1 before the site is considered healthy.
. (Join-Path $PublishDir 'build-manifest.ps1')
$manifest = Write-BuildManifest
if (-not $manifest.Ok) {
    Write-Output "ERROR: failed to write the build manifest"
    $manifest.Errors | ForEach-Object { Write-Output "  $_" }
    exit 1
}
Write-Output "Build manifest: $($manifest.Path) (BUILD_ID=$($manifest.BuildId), source=$($manifest.SourceFiles) files, artifacts=$($manifest.ArtifactFiles) files)"
Write-Output "Start: powershell -NoProfile -ExecutionPolicy Bypass -File `"$PublishDir\start-all.ps1`""
exit 0
