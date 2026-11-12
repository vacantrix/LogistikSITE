. "$PSScriptRoot\config.ps1"

$taskName = 'LogistikSITE-Demo'
$argument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PublishDir\start-all.ps1`""

Write-Output "=== Register autostart ==="

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument

$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
try { $logon.Delay = 'PT60S' } catch { }

$repeat = New-ScheduledTaskTrigger -Once `
    -At ((Get-Date).AddMinutes(2)) `
    -RepetitionInterval (New-TimeSpan -Minutes 10) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew

try {
    Register-ScheduledTask -TaskName $taskName `
        -Action $action `
        -Trigger @($logon, $repeat) `
        -Settings $settings `
        -Description 'LogistikSITE demo: OCR, Next.js and Tuna tunnel at logon, checked every 10 minutes' `
        -Force | Out-Null
    Write-Output "Scheduled task registered: $taskName"
} catch {
    Write-Output "ERROR: could not register scheduled task: $($_.Exception.Message)"
    Write-Output "Try running this script as administrator."
    exit 1
}

$info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue
if ($info) {
    Write-Output "next run: $($info.NextRunTime)"
    Write-Output "last result: $($info.LastTaskResult)"
}

# Power: keep the PC awake while the demo is published.
$powerSettings = @(
    @('standby-timeout-ac', '0'),
    @('hibernate-timeout-ac', '0'),
    @('disk-timeout-ac', '0'),
    @('monitor-timeout-ac', '15'),
    @('standby-timeout-dc', '0'),
    @('hibernate-timeout-dc', '0'),
    @('disk-timeout-dc', '0'),
    @('monitor-timeout-dc', '5')
)
$powerFailed = @()
foreach ($s in $powerSettings) {
    & powercfg /change $s[0] $s[1] 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $powerFailed += $s[0] }
}
if ($powerFailed.Count -eq 0) {
    Write-Output "Power: sleep and hibernation disabled (AC and battery), monitor timeout kept."
} else {
    Write-Output "Power: could not change: $($powerFailed -join ', ') (run as administrator)"
}

Write-Output ""
Write-Output "Start now: Start-ScheduledTask -TaskName $taskName"
exit 0
