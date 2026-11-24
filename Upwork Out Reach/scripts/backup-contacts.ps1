# Copies the Contacts app's contacts.json into ..\backups as a zip, only when it has changed.
# Keeps every copy from the last 48 hours, then one per day for 30 days.
$ErrorActionPreference = "Stop"
$source = Join-Path $env:APPDATA "Upwork Outreach\contacts.json"
$dest = Join-Path (Split-Path $PSScriptRoot -Parent) "backups"
$log = Join-Path $dest "backup.log"
New-Item -ItemType Directory -Force $dest | Out-Null

function Write-Log($msg) { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" -Encoding utf8 }

try {
  if (-not (Test-Path $source)) { Write-Log "contacts.json not found at $source"; exit 1 }

  $hash = (Get-FileHash $source -Algorithm SHA256).Hash
  $hashFile = Join-Path $dest ".last-hash"
  if ((Test-Path $hashFile) -and (Get-Content $hashFile -Raw).Trim() -eq $hash) { exit 0 }

  # Copy first so the app can keep writing while we zip.
  $stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
  $tmp = Join-Path $env:TEMP "contacts-$stamp.json"
  Copy-Item $source $tmp -Force
  $null = Get-Content $tmp -Raw | ConvertFrom-Json
  $zip = Join-Path $dest "contacts-$stamp.zip"
  Compress-Archive -Path $tmp -DestinationPath $zip -Force
  Remove-Item $tmp -Force
  Set-Content -Path $hashFile -Value $hash -Encoding ascii
  Write-Log "Saved $(Split-Path $zip -Leaf) ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)"

  $now = Get-Date
  $old = Get-ChildItem $dest -Filter "contacts-*.zip" | Where-Object { $_.LastWriteTime -lt $now.AddHours(-48) }
  foreach ($day in ($old | Group-Object { $_.LastWriteTime.Date })) {
    $keep = $day.Group | Sort-Object LastWriteTime | Select-Object -Last 1
    $day.Group | Where-Object { $_.FullName -ne $keep.FullName } | Remove-Item -Force
  }
  Get-ChildItem $dest -Filter "contacts-*.zip" | Where-Object { $_.LastWriteTime -lt $now.AddDays(-30) } | Remove-Item -Force
} catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  exit 1
}
