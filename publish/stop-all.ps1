. "$PSScriptRoot\config.ps1"

Write-Output "=== LogistikSITE demo stop ==="

if (Test-Path (Join-Path $PublishDir 'stop-caddy.ps1')) {
    & (Join-Path $PublishDir 'stop-caddy.ps1')
}
if (Test-Path (Join-Path $PublishDir 'stop-gateway.ps1')) {
    & (Join-Path $PublishDir 'stop-gateway.ps1')
}
if (Test-Path (Join-Path $PublishDir 'stop-portal-auth.ps1')) {
    & (Join-Path $PublishDir 'stop-portal-auth.ps1')
}
if (Test-Path (Join-Path $PublishDir 'stop-platform.ps1')) {
    & (Join-Path $PublishDir 'stop-platform.ps1')
}

# Tuna больше не используется в штатной схеме, но старый туннель стоит погасить,
# если он остался с предыдущих запусков.
if (Test-Path (Join-Path $PublishDir 'stop-tunnel.ps1')) {
    & (Join-Path $PublishDir 'stop-tunnel.ps1') | Out-Null
}

$wsOwner = Get-PortOwner 3003
if ($wsOwner -gt 0) {
    Stop-Process -Id $wsOwner -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $LogDir 'ws.pid') -Force -ErrorAction SilentlyContinue
    Write-Output "real-time listener stopped: pid=$wsOwner"
}

$stopOcr = Join-Path $RepoRoot 'mini-services\paddle-ocr\bench-v6\stop-service.ps1'
if (Test-Path $stopOcr) {
    try {
        & $stopOcr -Port $OcrPort
    } catch {
        Write-Output "OCR stop failed: $($_.Exception.Message)"
    }
} else {
    $owner = Get-PortOwner $OcrPort
    if ($owner -gt 0) {
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
        Write-Output "OCR listener stopped: pid=$owner"
    }
}

Write-Output "Done."
exit 0
