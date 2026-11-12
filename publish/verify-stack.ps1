# Stack verification for the Vacantrix + LogistikSITE startup.
#
# Three independent checks:
#   architecture - component topology: loopback-only service ports, public Caddy
#                  on 443, database, Caddy routing rules, HTTP health.
#   access       - live permission engine: admin can open "Profiles and access",
#                  a non-admin gets 403, templates/users/effective rights load.
#   build        - production bundle matches current source and its artifacts
#                  match publish\build-manifest.json (no stale/corrupt build).
#
# Modes:
#   -Mode build    only the build integrity check (used by start-all before boot)
#   -Mode runtime  architecture + access (used by start-all after boot)
#   -Mode all      all three checks (used by status.ps1)
#
# Exit code 0 = all selected checks passed; 1 = at least one failed.

param(
    [ValidateSet('build', 'runtime', 'all')]
    [string]$Mode = 'all',
    [switch]$NoResult
)

. "$PSScriptRoot\config.ps1"
. "$PSScriptRoot\build-manifest.ps1"

$StackPlatformBase = "http://127.0.0.1:$PlatformPort"
$StackCaddyPidFile = Join-Path $LogDir 'caddy.pid'

function New-StackCheck {
    param([string]$Name)
    return [pscustomobject]@{
        Name = $Name
        Ok = $true
        Summary = ''
        Errors = (New-Object System.Collections.Generic.List[string])
    }
}

function Get-StackHttpCode {
    param([string]$Url, [hashtable]$Headers = @{})
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 -Headers $Headers
        return [int]$response.StatusCode
    } catch {
        $response = $_.Exception.Response
        if ($response -and $response.StatusCode) { return [int]$response.StatusCode }
        return 0
    }
}

function Get-StackJson {
    param([string]$Url, [hashtable]$Headers = @{})
    try {
        $data = Invoke-RestMethod -Uri $Url -Headers $Headers -TimeoutSec 20
        return [pscustomobject]@{ Ok = $true; Data = $data; Error = $null }
    } catch {
        return [pscustomobject]@{ Ok = $false; Data = $null; Error = $_.Exception.Message }
    }
}

function Invoke-StackLogin {
    param([string]$Login, [string]$Password)
    $body = @{ login = $Login; password = $Password } | ConvertTo-Json -Compress
    try {
        $response = Invoke-RestMethod -Uri "$StackPlatformBase/api/auth/login" `
            -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
        if ($response.token) { return [string]$response.token }
    } catch { }
    return $null
}

function Get-StackListener {
    param([int]$Port)
    $connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($connections.Count -eq 0) {
        return [pscustomobject]@{ Up = $false; Addresses = @(); Pid = 0; Process = '' }
    }
    $addresses = @($connections | ForEach-Object { [string]$_.LocalAddress } | Sort-Object -Unique)
    $ownerPid = [int]($connections[0].OwningProcess)
    $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
    $processName = if ($proc) { $proc.ProcessName } else { '?' }
    return [pscustomobject]@{ Up = $true; Addresses = $addresses; Pid = $ownerPid; Process = $processName }
}

function Test-StackArchitecture {
    $check = New-StackCheck 'architecture'
    $listenerParts = @()

    # Internal services must listen on loopback only: the internet-facing edge
    # is Caddy on 443, and OCR must never be published directly.
    $loopback = @(
        @{ Port = $PlatformPort; Name = 'platform' },
        @{ Port = $OcrPort; Name = 'OCR' },
        @{ Port = $GatewayPort; Name = 'gateway' },
        @{ Port = $PortalAuthPort; Name = 'portal-auth' }
    )
    foreach ($item in $loopback) {
        $listener = Get-StackListener -Port $item.Port
        if (-not $listener.Up) {
            $check.Errors.Add("$($item.Name) port $($item.Port) is DOWN")
            continue
        }
        $exposed = @($listener.Addresses | Where-Object { $_ -notin @('127.0.0.1', '::1', '::ffff:127.0.0.1') })
        if ($exposed.Count -gt 0) {
            $check.Errors.Add("$($item.Name) port $($item.Port) is exposed on $($exposed -join ', ')")
        }
        $listenerParts += "$($item.Port)/$($listener.Process)"
    }

    $caddyListener = Get-StackListener -Port 443
    if (-not $caddyListener.Up) {
        $check.Errors.Add('public HTTPS port 443 is DOWN (Caddy is not listening)')
    } elseif ($caddyListener.Process -ne 'caddy') {
        $check.Errors.Add("port 443 is owned by $($caddyListener.Process), expected caddy")
    } else {
        $listenerParts += "443/$($caddyListener.Process)"
    }

    $platformCode = Get-StackHttpCode -Url "$StackPlatformBase/"
    if ($platformCode -ne 200) {
        $check.Errors.Add("platform HTTP is $platformCode (expected 200)")
    }
    $gatewayCode = Get-StackHttpCode -Url "http://127.0.0.1:$GatewayPort/"
    if ($gatewayCode -ne 200) {
        $check.Errors.Add("gateway HTTP is $gatewayCode (expected 200)")
    }

    $portalHealth = Get-StackJson -Url "http://127.0.0.1:$PortalAuthPort/api/portal/health"
    if (-not $portalHealth.Ok) {
        $check.Errors.Add("portal-auth health failed: $($portalHealth.Error)")
    } elseif (-not $portalHealth.Data.ok) {
        $check.Errors.Add('portal-auth health returns ok=false')
    }

    $ocrHealth = Get-StackJson -Url "http://127.0.0.1:$OcrPort/health"
    if (-not $ocrHealth.Ok) {
        $check.Errors.Add("OCR health failed: $($ocrHealth.Error)")
    } elseif (-not $ocrHealth.Data.ready) {
        $check.Errors.Add('OCR health returns ready=false')
    }

    $dbMb = 0
    if (-not (Test-Path -LiteralPath $DbPath)) {
        $check.Errors.Add("database is missing: $DbPath")
    } else {
        $dbMb = [Math]::Round((Get-Item -LiteralPath $DbPath).Length / 1MB, 1)
        if ($dbMb -le 0) { $check.Errors.Add('database file is empty') }
    }

    $portalIndex = Join-Path $PublishDir 'portal\index.html'
    if (-not (Test-Path -LiteralPath $portalIndex)) {
        $check.Errors.Add("portal index is missing: $portalIndex")
    }

    if (-not (Test-Path -LiteralPath $Caddyfile)) {
        $check.Errors.Add("Caddyfile is missing: $Caddyfile")
    } else {
        $caddyText = Get-Content -LiteralPath $Caddyfile -Raw
        $portalRoot = (Join-Path $PublishDir 'portal') -replace '\\', '/'
        $routes = @(
            @{ Name = 'gateway 8080'; Pattern = 'reverse_proxy\s+127\.0\.0\.1:8080' },
            @{ Name = 'portal-auth 8090'; Pattern = 'reverse_proxy\s+127\.0\.0\.1:8090' },
            @{ Name = 'portal API handler'; Pattern = 'handle\s+/api/portal/\*' },
            @{ Name = 'installers handler'; Pattern = 'handle\s+/dl/\*' },
            @{ Name = 'portal file_server'; Pattern = 'file_server' },
            @{ Name = 'portal root'; Pattern = [regex]::Escape($portalRoot) }
        )
        foreach ($route in $routes) {
            if (-not [regex]::IsMatch($caddyText, $route.Pattern)) {
                $check.Errors.Add("Caddy route missing: $($route.Name)")
            }
        }
        if ([regex]::IsMatch($caddyText, 'reverse_proxy\s+127\.0\.0\.1:3031')) {
            $check.Errors.Add('OCR port 3031 must not be published through Caddy')
        }
    }

    $check.Ok = ($check.Errors.Count -eq 0)
    if ($check.Ok) {
        $internalListeners = @($listenerParts | Where-Object { $_ -notlike '443/*' }) -join ', '
        $check.Summary = "internal $internalListeners loopback; 443/caddy public; Caddy routes OK; DB $dbMb MB"
    }
    return $check
}

function Test-StackAccess {
    $check = New-StackCheck 'access'

    $envPath = Join-Path $RepoRoot '.env.local'
    $envMap = Import-DotEnv $envPath
    $password = $envMap['NEXT_PUBLIC_DEMO_PASSWORD']
    if (-not $password) { $password = $envMap['SEED_PASSWORD'] }
    if (-not $password) {
        $check.Errors.Add('demo password is not configured (NEXT_PUBLIC_DEMO_PASSWORD)')
        $check.Ok = $false
        return $check
    }

    $anonymousCode = Get-StackHttpCode -Url "$StackPlatformBase/api/admin/access"
    if ($anonymousCode -ne 401) {
        $check.Errors.Add("admin/access without a token is $anonymousCode (expected 401)")
    }

    $adminToken = Invoke-StackLogin -Login 'admin' -Password $password
    if (-not $adminToken) {
        $check.Errors.Add('admin login failed')
        $check.Ok = $false
        return $check
    }
    $adminHeaders = @{ Authorization = "Bearer $adminToken" }

    $accessResponse = Get-StackJson -Url "$StackPlatformBase/api/admin/access" -Headers $adminHeaders
    if (-not $accessResponse.Ok) {
        $check.Errors.Add("admin/access failed: $($accessResponse.Error)")
        $check.Ok = $false
        return $check
    }

    $access = $accessResponse.Data
    $templates = @($access.templates)
    $users = @($access.users)
    $journal = @($access.journal)

    if ($templates.Count -lt 9) {
        $check.Errors.Add("access templates: $($templates.Count) (expected at least 9)")
    }
    if ($users.Count -lt 8) {
        $check.Errors.Add("access users: $($users.Count) (expected at least 8)")
    }

    foreach ($template in $templates) {
        if ($template.contour -notin @('admin', 'logist', 'carrier')) {
            $check.Errors.Add("template $($template.id): invalid contour $($template.contour)")
        }
        if ($null -eq $template.perms) {
            $check.Errors.Add("template $($template.id): perms are missing")
        }
    }
    foreach ($contour in @('admin', 'logist', 'carrier')) {
        $defaults = @($templates | Where-Object { $_.contour -eq $contour -and $_.isDefault -eq $true })
        if ($defaults.Count -ne 1) {
            $check.Errors.Add("contour $contour has $($defaults.Count) default templates (expected 1)")
        }
    }

    $exceptionTotal = 0
    foreach ($user in $users) {
        if ($user.role -notin @('admin', 'logist', 'carrier')) {
            $check.Errors.Add("user $($user.login): invalid role $($user.role)")
        }
        if ($null -eq $user.effective) {
            $check.Errors.Add("user $($user.login): effective rights are missing")
        }
        $exceptionTotal += @($user.exceptions).Count
    }

    $adminRow = @($users | Where-Object { $_.login -eq 'admin' })
    if ($adminRow.Count -eq 0) {
        $check.Errors.Add('admin user is missing from access data')
    } elseif (@($adminRow[0].effective) -notcontains 'admin:users') {
        $check.Errors.Add('admin user has no admin:users right')
    }

    $adminPermissions = Get-StackJson -Url "$StackPlatformBase/api/permissions" -Headers $adminHeaders
    $adminPermCount = 0
    if (-not $adminPermissions.Ok) {
        $check.Errors.Add("admin permissions failed: $($adminPermissions.Error)")
    } else {
        $adminMine = @($adminPermissions.Data.mine)
        $adminPermCount = $adminMine.Count
        if ($adminMine -notcontains 'admin:users') {
            $check.Errors.Add('admin /api/permissions does not include admin:users')
        }
    }

    $candidates = @($users | Where-Object { $_.login -eq 'logist2' }) +
        @($users | Where-Object { $_.role -eq 'logist' -and $_.login -ne 'logist2' }) +
        @($users | Where-Object { $_.role -eq 'carrier' -and $_.login })
    $nonAdminLogin = $null
    $nonAdminToken = $null
    foreach ($candidate in $candidates) {
        $token = Invoke-StackLogin -Login $candidate.login -Password $password
        if ($token) {
            $nonAdminLogin = [string]$candidate.login
            $nonAdminToken = $token
            break
        }
    }

    $nonAdminPermCount = 0
    if (-not $nonAdminToken) {
        $check.Errors.Add('could not log in as any non-admin demo user')
    } else {
        $nonAdminHeaders = @{ Authorization = "Bearer $nonAdminToken" }
        $nonAdminPermissions = Get-StackJson -Url "$StackPlatformBase/api/permissions" -Headers $nonAdminHeaders
        if (-not $nonAdminPermissions.Ok) {
            $check.Errors.Add("permissions for $nonAdminLogin failed: $($nonAdminPermissions.Error)")
        } else {
            $nonAdminMine = @($nonAdminPermissions.Data.mine)
            $nonAdminPermCount = $nonAdminMine.Count
            if ($nonAdminMine -contains 'admin:users') {
                $check.Errors.Add("permissions for ${nonAdminLogin} include admin:users")
            }
            if ($null -eq $nonAdminPermissions.Data.sources) {
                $check.Errors.Add("permissions for ${nonAdminLogin}: sources are missing")
            }
        }
        $deniedCode = Get-StackHttpCode -Url "$StackPlatformBase/api/admin/access" -Headers $nonAdminHeaders
        if ($deniedCode -ne 403) {
            $check.Errors.Add("admin/access for $nonAdminLogin is $deniedCode (expected 403)")
        }
    }

    $check.Ok = ($check.Errors.Count -eq 0)
    if ($check.Ok) {
        $check.Summary = "$($templates.Count) templates / $($users.Count) users / $exceptionTotal exceptions / $($journal.Count) journal rows; admin $adminPermCount perms; $nonAdminLogin $nonAdminPermCount perms and HTTP 403 on admin/access"
    }
    return $check
}

function Write-StackResult {
    param($Name, $Ok, $Summary, $Errors)
    $label = ([string]$Name).PadRight(12)
    if ($Ok) {
        Write-Output "$label : OK - $Summary"
        return
    }
    Write-Output "$label : FAIL"
    foreach ($err in $Errors) {
        if ($err) { Write-Output "  - $err" }
    }
}

Write-Output "=== Stack verification (mode=$Mode) ==="

$allOk = $true

if ($Mode -eq 'runtime' -or $Mode -eq 'all') {
    $architecture = Test-StackArchitecture
    Write-StackResult -Name 'architecture' -Ok $architecture.Ok -Summary $architecture.Summary -Errors $architecture.Errors
    if (-not $architecture.Ok) { $allOk = $false }

    $access = Test-StackAccess
    Write-StackResult -Name 'access' -Ok $access.Ok -Summary $access.Summary -Errors $access.Errors
    if (-not $access.Ok) { $allOk = $false }
}

if ($Mode -eq 'build' -or $Mode -eq 'all') {
    $build = Test-BuildIntegrity
    Write-StackResult -Name 'build' -Ok $build.Ok -Summary $build.Summary -Errors $build.Errors
    if (-not $build.Ok) { $allOk = $false }
}

if ($NoResult) {
    if ($allOk) { exit 0 }
    exit 1
}
Write-Output ""
if ($allOk) {
    Write-Output "RESULT: OK"
    exit 0
}
Write-Output "RESULT: FAIL"
exit 1
