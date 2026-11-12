# Открывает входящий доступ для локального шлюза LogistikSITE:
#  - сеть Wi-Fi переводится в профиль Private (домашняя сеть);
#  - добавляются правила файрвола для node.exe на порты 80 и 443.
# Запускать с повышением прав (UAC).
$ErrorActionPreference = 'Stop'

$wifi = Get-NetConnectionProfile | Where-Object { $_.Name -eq 'TP-Link_4968_5G' } | Select-Object -First 1
if ($wifi -and $wifi.NetworkCategory -ne 'Private') {
    Set-NetConnectionProfile -InterfaceIndex $wifi.InterfaceIndex -NetworkCategory Private
    Write-Output "network profile -> Private ($($wifi.InterfaceAlias))"
} else {
    Write-Output "network profile already Private or wifi not found"
}

$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node).Source }
$caddy = Join-Path $PSScriptRoot 'bin\caddy.exe'

$targets = @(
    @{ Name = 'LogistikSITE gateway'; Program = $node; Ports = @(80, 443) },
    @{ Name = 'LogistikSITE caddy'; Program = $caddy; Ports = @(80, 443) }
)

foreach ($t in $targets) {
    if (-not (Test-Path $t.Program)) { Write-Output "skip (missing program): $($t.Program)"; continue }
    foreach ($port in $t.Ports) {
        $name = "$($t.Name) TCP $port"
        $existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
        if ($existing) {
            Write-Output "firewall rule exists: $name"
            continue
        }
        New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Program $t.Program -Profile Any | Out-Null
        Write-Output "firewall rule added: $name ($($t.Program))"
    }
}
