# Build manifest for the production standalone bundle.
#
# Records SHA-256 fingerprints of build inputs (src, public, root configs) and
# build artifacts (.next/standalone server, static and public trees). start-all
# and status use this to detect a stale source tree or a damaged bundle without
# rebuilding. The manifest is written by build-public.ps1 at the end of a build.
#
# Next.js writes runtime ISR data under .next/standalone/.next/server/route-cache
# on the first request. That directory is not part of the build and is excluded
# from the server fingerprint; otherwise a healthy build would fail verification
# as soon as the site is opened.
#
# Usage:
#   powershell -File publish\build-manifest.ps1 -Write    # (re)generate
#   powershell -File publish\build-manifest.ps1 -Verify   # check current build
# Dot-source the file to use Write-BuildManifest / Test-BuildIntegrity.

param(
    [switch]$Write,
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'

$BuildManifestRepo = Split-Path -Parent $PSScriptRoot
$BuildManifestPath = Join-Path $PSScriptRoot 'build-manifest.json'
$BuildManifestConfigFiles = @(
    'package.json',
    'bun.lock',
    'next.config.ts',
    'tsconfig.json',
    'postcss.config.mjs',
    'tailwind.config.ts',
    'components.json',
    'prisma/schema.prisma',
    '.env.local'
)

# Runtime-only directories inside the compiled server tree. Next.js creates them
# on demand (ISR page cache); they are not build outputs and stay out of the hash.
$BuildManifestRuntimeServerSegments = @('route-cache')

function Get-BmBytesSha256 {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($Bytes)
        return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-BmFileSha256 {
    param([string]$Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        # ReadWrite sharing: the platform may keep build files open while status runs.
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $hash = $sha.ComputeHash($stream)
        } finally {
            $stream.Dispose()
        }
        return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-BmRelativePath {
    param([string]$BasePath, [string]$FullName)
    $base = [System.IO.Path]::GetFullPath($BasePath)
    if (-not $base.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $base += [System.IO.Path]::DirectorySeparatorChar
    }
    return ($FullName.Substring($base.Length) -replace '\\', '/')
}

function Get-BmFileListSignature {
    param([string]$BasePath, [System.IO.FileInfo[]]$Files)
    $sb = New-Object System.Text.StringBuilder
    [long]$bytes = 0
    foreach ($f in $Files) {
        $rel = Get-BmRelativePath -BasePath $BasePath -FullName $f.FullName
        $hash = Get-BmFileSha256 -Path $f.FullName
        [void]$sb.Append($rel)
        [void]$sb.Append('|')
        [void]$sb.Append($f.Length)
        [void]$sb.Append('|')
        [void]$sb.Append($hash)
        [void]$sb.Append("`n")
        $bytes += $f.Length
    }
    $textBytes = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
    return [pscustomobject]@{
        Files = $Files.Count
        Bytes = $bytes
        Hash  = (Get-BmBytesSha256 -Bytes $textBytes)
    }
}

function Get-BmTreeSignature {
    param([string]$Root, [string[]]$ExcludeSegments = @())
    $full = [System.IO.Path]::GetFullPath($Root)
    if (-not (Test-Path -LiteralPath $full -PathType Container)) {
        return [pscustomobject]@{
            Ok = $false; Files = 0; Bytes = 0; Hash = $null
            Error = "missing directory: $Root"
        }
    }
    $files = @(Get-ChildItem -LiteralPath $full -Recurse -File -Force -ErrorAction Stop |
        Sort-Object -Property FullName -CaseSensitive)
    if ($ExcludeSegments.Count -gt 0) {
        $files = @($files | Where-Object {
            $rel = Get-BmRelativePath -BasePath $full -FullName $_.FullName
            $skip = $false
            foreach ($part in ($rel -split '/')) {
                if ($ExcludeSegments -contains $part) { $skip = $true; break }
            }
            -not $skip
        })
    }
    $sig = Get-BmFileListSignature -BasePath $full -Files $files
    return [pscustomobject]@{
        Ok = $true; Files = $sig.Files; Bytes = $sig.Bytes; Hash = $sig.Hash; Error = $null
    }
}

function Get-BmConfigSignature {
    $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
    $missing = New-Object System.Collections.Generic.List[string]
    foreach ($rel in $BuildManifestConfigFiles) {
        $path = Join-Path $BuildManifestRepo ($rel -replace '/', '\')
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            $files.Add((Get-Item -LiteralPath $path))
        } else {
            $missing.Add($rel)
        }
    }
    if ($missing.Count -gt 0) {
        return [pscustomobject]@{
            Ok = $false; Files = $files.Count; Bytes = 0; Hash = $null
            Error = "missing config files: $($missing -join ', ')"
        }
    }
    $sorted = @($files | Sort-Object -Property FullName -CaseSensitive)
    $sig = Get-BmFileListSignature -BasePath $BuildManifestRepo -Files $sorted
    return [pscustomobject]@{
        Ok = $true; Files = $sig.Files; Bytes = $sig.Bytes; Hash = $sig.Hash; Error = $null
    }
}

function Get-BmFileArtifact {
    param([string]$RelativePath)
    $path = Join-Path $BuildManifestRepo ($RelativePath -replace '/', '\')
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return [pscustomobject]@{
            Ok = $false; Path = $RelativePath; Files = 0; Bytes = 0; Hash = $null
            Error = "missing file: $RelativePath"
        }
    }
    $item = Get-Item -LiteralPath $path
    return [pscustomobject]@{
        Ok = $true; Path = $RelativePath; Files = 1; Bytes = $item.Length
        Hash = (Get-BmFileSha256 -Path $path); Error = $null
    }
}

function Write-BuildManifest {
    $errors = New-Object System.Collections.Generic.List[string]

    $required = @(
        '.next/BUILD_ID',
        '.next/standalone/server.js',
        '.next/standalone/.next/BUILD_ID',
        '.next/standalone/.next/server',
        '.next/standalone/.next/static',
        '.next/standalone/public'
    )
    foreach ($rel in $required) {
        $path = Join-Path $BuildManifestRepo ($rel -replace '/', '\')
        if (-not (Test-Path -LiteralPath $path)) { $errors.Add("missing $rel") }
    }
    if ($errors.Count -gt 0) {
        return [pscustomobject]@{
            Ok = $false; Path = $BuildManifestPath; BuildId = $null
            SourceFiles = 0; ArtifactFiles = 0; Errors = $errors
        }
    }

    $buildId = (Get-Content -LiteralPath (Join-Path $BuildManifestRepo '.next\BUILD_ID') -Raw).Trim()
    $standaloneBuildId = (Get-Content -LiteralPath (Join-Path $BuildManifestRepo '.next\standalone\.next\BUILD_ID') -Raw).Trim()
    if ($buildId -ne $standaloneBuildId) {
        $errors.Add("BUILD_ID mismatch: .next=$buildId, standalone=$standaloneBuildId")
    }
    if (-not $buildId) { $errors.Add('BUILD_ID is empty') }

    $src = Get-BmTreeSignature -Root (Join-Path $BuildManifestRepo 'src')
    $pub = Get-BmTreeSignature -Root (Join-Path $BuildManifestRepo 'public')
    $cfg = Get-BmConfigSignature
    $server = Get-BmTreeSignature -Root (Join-Path $BuildManifestRepo '.next\standalone\.next\server') -ExcludeSegments $BuildManifestRuntimeServerSegments
    $static = Get-BmTreeSignature -Root (Join-Path $BuildManifestRepo '.next\standalone\.next\static')
    $spub = Get-BmTreeSignature -Root (Join-Path $BuildManifestRepo '.next\standalone\public')
    $serverJs = Get-BmFileArtifact -RelativePath '.next/standalone/server.js'

    foreach ($pair in @(
        @{ Name = 'src'; Sig = $src },
        @{ Name = 'public'; Sig = $pub },
        @{ Name = 'config'; Sig = $cfg },
        @{ Name = 'server'; Sig = $server },
        @{ Name = 'static'; Sig = $static },
        @{ Name = 'standalonePublic'; Sig = $spub },
        @{ Name = 'server.js'; Sig = $serverJs }
    )) {
        if (-not $pair.Sig.Ok) { $errors.Add("$($pair.Name): $($pair.Sig.Error)") }
    }
    if ($errors.Count -gt 0) {
        return [pscustomobject]@{
            Ok = $false; Path = $BuildManifestPath; BuildId = $buildId
            SourceFiles = 0; ArtifactFiles = 0; Errors = $errors
        }
    }

    $groups = [ordered]@{}
    $groups['src'] = [ordered]@{ root = 'src'; files = $src.Files; bytes = $src.Bytes; hash = $src.Hash }
    $groups['public'] = [ordered]@{ root = 'public'; files = $pub.Files; bytes = $pub.Bytes; hash = $pub.Hash }
    $groups['config'] = [ordered]@{ root = '.'; files = $cfg.Files; bytes = $cfg.Bytes; hash = $cfg.Hash }
    $groups['server'] = [ordered]@{ root = '.next/standalone/.next/server'; files = $server.Files; bytes = $server.Bytes; hash = $server.Hash }
    $groups['static'] = [ordered]@{ root = '.next/standalone/.next/static'; files = $static.Files; bytes = $static.Bytes; hash = $static.Hash }
    $groups['standalonePublic'] = [ordered]@{ root = '.next/standalone/public'; files = $spub.Files; bytes = $spub.Bytes; hash = $spub.Hash }

    $artifacts = [ordered]@{}
    $artifacts['buildId'] = [ordered]@{ path = '.next/BUILD_ID'; value = $buildId }
    $artifacts['serverJs'] = [ordered]@{
        path = '.next/standalone/server.js'; files = $serverJs.Files
        bytes = $serverJs.Bytes; hash = $serverJs.Hash
    }

    $manifest = [ordered]@{
        schema = 1
        algorithm = 'sha256:utf8(sorted "relpath|bytes|sha256" lines)'
        buildId = $buildId
        createdAt = (Get-Date).ToUniversalTime().ToString('o')
        groups = $groups
        artifacts = $artifacts
    }

    $json = $manifest | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($BuildManifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))

    return [pscustomobject]@{
        Ok = $true; Path = $BuildManifestPath; BuildId = $buildId
        SourceFiles = ($src.Files + $pub.Files + $cfg.Files)
        ArtifactFiles = ($server.Files + $static.Files + $spub.Files + $serverJs.Files)
        Errors = $errors
    }
}

function Compare-BmGroup {
    param([string]$Name, [object]$Expected, [object]$Actual)
    if ($null -eq $Expected -or -not $Expected.hash) {
        return "${Name}: manifest entry is missing"
    }
    if (-not $Actual.Ok) {
        return "${Name}: $($Actual.Error)"
    }
    if ($Actual.Hash -ne $Expected.hash) {
        $was = ([string]$Expected.hash).Substring(0, 12)
        $now = ([string]$Actual.Hash).Substring(0, 12)
        return "${Name}: content changed since build (manifest $was, now $now)"
    }
    return $null
}

function Test-BuildIntegrity {
    $errors = New-Object System.Collections.Generic.List[string]
    $result = [pscustomobject]@{
        Ok = $true; BuildId = $null; Summary = ''
        SourceFiles = 0; ArtifactFiles = 0
        ManifestPath = $BuildManifestPath; Errors = $errors
    }

    if (-not (Test-Path -LiteralPath $BuildManifestPath -PathType Leaf)) {
        $errors.Add('build manifest not found: run publish\build-public.ps1')
        $result.Ok = $false
        return $result
    }

    try {
        $m = Get-Content -LiteralPath $BuildManifestPath -Raw | ConvertFrom-Json
    } catch {
        $errors.Add("build manifest is unreadable: $($_.Exception.Message)")
        $result.Ok = $false
        return $result
    }

    if ($null -eq $m.schema -or [int]$m.schema -ne 1) {
        $errors.Add("unsupported manifest schema: $($m.schema)")
    }

    $buildIdPath = Join-Path $BuildManifestRepo '.next\BUILD_ID'
    $standaloneBuildIdPath = Join-Path $BuildManifestRepo '.next\standalone\.next\BUILD_ID'
    $currentBuildId = $null
    if (-not (Test-Path -LiteralPath $buildIdPath -PathType Leaf)) {
        $errors.Add('missing .next/BUILD_ID: production build is absent')
    } else {
        $currentBuildId = (Get-Content -LiteralPath $buildIdPath -Raw).Trim()
    }
    if ($currentBuildId) {
        if ($m.buildId -ne $currentBuildId) {
            $errors.Add("BUILD_ID mismatch: manifest=$($m.buildId), .next=$currentBuildId")
        }
        if (-not (Test-Path -LiteralPath $standaloneBuildIdPath -PathType Leaf)) {
            $errors.Add('missing .next/standalone/.next/BUILD_ID: standalone bundle is incomplete')
        } else {
            $standaloneBuildId = (Get-Content -LiteralPath $standaloneBuildIdPath -Raw).Trim()
            if ($standaloneBuildId -ne $currentBuildId) {
                $errors.Add("standalone BUILD_ID mismatch: standalone=$standaloneBuildId, .next=$currentBuildId")
            }
        }
    }

    $src = Get-BmTreeSignature -Root (Join-Path $BuildManifestRepo 'src')
    $pub = Get-BmTreeSignature -Root (Join-Path $BuildManifestRepo 'public')
    $cfg = Get-BmConfigSignature
    $server = Get-BmTreeSignature -Root (Join-Path $BuildManifestRepo '.next\standalone\.next\server') -ExcludeSegments $BuildManifestRuntimeServerSegments
    $static = Get-BmTreeSignature -Root (Join-Path $BuildManifestRepo '.next\standalone\.next\static')
    $spub = Get-BmTreeSignature -Root (Join-Path $BuildManifestRepo '.next\standalone\public')
    $serverJs = Get-BmFileArtifact -RelativePath '.next/standalone/server.js'

    $groupChecks = @(
        @{ Name = 'src'; Key = 'src'; Actual = $src },
        @{ Name = 'public'; Key = 'public'; Actual = $pub },
        @{ Name = 'config'; Key = 'config'; Actual = $cfg },
        @{ Name = 'server'; Key = 'server'; Actual = $server },
        @{ Name = 'static'; Key = 'static'; Actual = $static },
        @{ Name = 'standalonePublic'; Key = 'standalonePublic'; Actual = $spub }
    )
    foreach ($check in $groupChecks) {
        $expected = $null
        if ($m.groups) { $expected = $m.groups.($check.Key) }
        $err = Compare-BmGroup -Name $check.Name -Expected $expected -Actual $check.Actual
        if ($err) { $errors.Add($err) }
    }

    if (-not $serverJs.Ok) {
        $errors.Add("serverJs: $($serverJs.Error)")
    } elseif ($null -eq $m.artifacts -or $null -eq $m.artifacts.serverJs -or $m.artifacts.serverJs.hash -ne $serverJs.Hash) {
        $errors.Add('serverJs: server.js changed since build')
    }

    $result.BuildId = $m.buildId
    if ($m.groups) {
        $result.SourceFiles = [int]$m.groups.src.files + [int]$m.groups.public.files + [int]$m.groups.config.files
        $result.ArtifactFiles = [int]$m.groups.server.files + [int]$m.groups.static.files + [int]$m.groups.standalonePublic.files + 1
    }

    if ($errors.Count -gt 0) {
        $result.Ok = $false
        return $result
    }

    $result.Ok = $true
    $result.Summary = "BUILD_ID=$($m.buildId), source=$($result.SourceFiles) files, artifacts=$($result.ArtifactFiles) files, matches publish\build-manifest.json"
    return $result
}

if ($MyInvocation.InvocationName -ne '.') {
    if ($Verify) {
        $check = Test-BuildIntegrity
        if ($check.Ok) {
            Write-Output "build : OK - $($check.Summary)"
            exit 0
        }
        Write-Output "build : FAIL"
        foreach ($err in $check.Errors) { Write-Output "  - $err" }
        exit 1
    }

    $written = Write-BuildManifest
    if (-not $written.Ok) {
        Write-Output "ERROR: build manifest was not written"
        foreach ($err in $written.Errors) { Write-Output "  - $err" }
        exit 1
    }
    Write-Output "build manifest: $($written.Path) (BUILD_ID=$($written.BuildId), source=$($written.SourceFiles) files, artifacts=$($written.ArtifactFiles) files)"
    exit 0
}
