$ErrorActionPreference = 'Stop'
$deployDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $deployDir
$runtimeDir = Join-Path $deployDir 'runtime'
$logsDir = Join-Path $runtimeDir 'logs'
New-Item -ItemType Directory -Force -Path $runtimeDir, $logsDir | Out-Null
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeMajor = if ($nodeCommand) { [int]((& $nodeCommand.Source --version).TrimStart('v').Split('.')[0]) } else { 0 }
$npmExisting = Get-Command npm -ErrorAction SilentlyContinue
$npxExisting = Get-Command npx -ErrorAction SilentlyContinue
if ($nodeMajor -ge 24 -and $npmExisting -and $npxExisting) {
  $nodePath = $nodeCommand.Source
  $npmCommand = $npmExisting.Source
  $npxCommand = $npxExisting.Source
} else {
  $nodeVersion = 'v24.15.0'
  $nodeFolder = Join-Path $runtimeDir "node-$nodeVersion-win-x64"
  $nodeZipName = "node-$nodeVersion-win-x64.zip"
  $nodeZip = Join-Path $runtimeDir $nodeZipName
  $checksums = Join-Path $runtimeDir 'SHASUMS256.txt'
  Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/$nodeZipName" -OutFile $nodeZip
  Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/SHASUMS256.txt" -OutFile $checksums
  $expected = (Select-String -Path $checksums -Pattern "^(?<hash>[0-9a-fA-F]{64})\s+$([regex]::Escape($nodeZipName))$" | Select-Object -First 1).Matches.Groups['hash'].Value
  if (!$expected -or (Get-FileHash $nodeZip -Algorithm SHA256).Hash -ne $expected) { throw 'Node.js archive checksum validation failed.' }
  Expand-Archive -Path $nodeZip -DestinationPath $runtimeDir -Force
  Remove-Item $nodeZip, $checksums -Force
  $nodePath = Join-Path $nodeFolder 'node.exe'
  $npmCommand = Join-Path $nodeFolder 'npm.cmd'
  $npxCommand = Join-Path $nodeFolder 'npx.cmd'
}
$env:PATH = "$(Split-Path -Parent $nodePath);$env:PATH"
$browserCache = Join-Path $runtimeDir 'browsers'
$env:PLAYWRIGHT_BROWSERS_PATH = $browserCache
if (!(Test-Path (Join-Path $runtimeDir 'accounts.csv'))) {
  Copy-Item (Join-Path $deployDir 'accounts.csv') (Join-Path $runtimeDir 'accounts.csv')
}
$config = @{ node = $nodePath; browserCache = $browserCache; repo = $repoRoot; runtime = $runtimeDir } | ConvertTo-Json
Set-Content -Path (Join-Path $runtimeDir 'deployment.json') -Value $config -Encoding UTF8

Push-Location $repoRoot
try {
  & $npmCommand ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  & $npxCommand playwright install --only-shell chromium
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
