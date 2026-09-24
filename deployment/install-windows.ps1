$ErrorActionPreference = 'Stop'
$deployDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $deployDir
$runtimeDir = Join-Path $deployDir 'runtime'
$logsDir = Join-Path $runtimeDir 'logs'
$nodePath = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $runtimeDir, $logsDir | Out-Null
if (!(Test-Path (Join-Path $runtimeDir 'accounts.csv'))) {
  Copy-Item (Join-Path $deployDir 'accounts.csv') (Join-Path $runtimeDir 'accounts.csv')
}
$config = @{ node = $nodePath; browserCache = (Join-Path $env:LOCALAPPDATA 'ms-playwright'); repo = $repoRoot; runtime = $runtimeDir } | ConvertTo-Json
Set-Content -Path (Join-Path $runtimeDir 'deployment.json') -Value $config -Encoding UTF8

Push-Location $repoRoot
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  npx playwright install --only-shell chromium
  if ($LASTEXITCODE -ne 0) { throw 'Playwright browser installation failed' }
  $env:TRACKER_DATA_ROOT = $runtimeDir
  & $nodePath (Join-Path $repoRoot 'app/sync_sqlite.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'SQLite initialization failed' }
} finally { Pop-Location }

$pwsh = Join-Path $PSHOME 'powershell.exe'
$collectScript = Join-Path $deployDir 'run-month-end.ps1'
$serverScript = Join-Path $deployDir 'start-server.ps1'
$collectAction = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$collectScript`""
$serverAction = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$serverScript`""
$daily = New-ScheduledTaskTrigger -Daily -At '2:10 AM'
$boot = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'SocialFollowerTracker-MonthEnd' -Action $collectAction -Trigger $daily -Principal $principal -Settings $settings -Force | Out-Null
Register-ScheduledTask -TaskName 'SocialFollowerTracker-Server' -Action $serverAction -Trigger $boot -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'SocialFollowerTracker-Server'
Write-Host 'Installed. Dashboard: http://127.0.0.1:4173'
