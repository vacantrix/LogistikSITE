# Создаёт ярлык «LogistikSITE — запуск» на рабочем столе.
# Ярлык запускает publish\start-production.ps1 без прав администратора.

param(
    [string]$Name = 'LogistikSITE — запуск'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\config.ps1"

$iconPath = Join-Path $PublishDir 'assets\logistiksite.ico'
if (-not (Test-Path $iconPath)) {
    & (Join-Path $PublishDir 'make-icon.ps1')
}
if (-not (Test-Path $iconPath)) {
    Write-Output "ERROR: icon not found: $iconPath"
    exit 1
}

$launcher = Join-Path $PublishDir 'start-production.ps1'
if (-not (Test-Path $launcher)) {
    Write-Output "ERROR: launcher not found: $launcher"
    exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "$Name.lnk"

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path $powershell)) { $powershell = 'powershell.exe' }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -NoLogo -ExecutionPolicy Bypass -File `"$launcher`""
$shortcut.WorkingDirectory = $PublishDir
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'LogistikSITE — боевой запуск: OCR, платформа, HTTPS и домен'
$shortcut.WindowStyle = 1
$shortcut.Save()

if (-not (Test-Path $shortcutPath)) {
    Write-Output "ERROR: shortcut was not created: $shortcutPath"
    exit 1
}

Write-Output "Shortcut created: $shortcutPath"
Write-Output "Target: $powershell"
Write-Output "Script: $launcher"
Write-Output "Icon:   $iconPath"
