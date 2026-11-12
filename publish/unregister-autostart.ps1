. "$PSScriptRoot\config.ps1"

$taskName = 'LogistikSITE-Demo'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Output "Scheduled task removed: $taskName"
} else {
    Write-Output "Scheduled task not found: $taskName"
}

Write-Output "Power settings were not changed back. Restore them manually if needed:"
Write-Output "  powercfg /change standby-timeout-ac 30"
Write-Output "  powercfg /change hibernate-timeout-ac 60"
exit 0
