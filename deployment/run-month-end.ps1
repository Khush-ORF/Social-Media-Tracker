$ErrorActionPreference = 'Stop'
$deployDir = $PSScriptRoot
$runtimeDir = Join-Path $deployDir 'runtime'
$config = Get-Content (Join-Path $runtimeDir 'deployment.json') -Raw | ConvertFrom-Json
$ist = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'India Standard Time')
if ($ist.Day -ne [DateTime]::DaysInMonth($ist.Year, $ist.Month)) { exit 0 }
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeDir 'logs') | Out-Null
$log = Join-Path $runtimeDir 'logs/collector.log'
$env:TRACKER_DATA_ROOT = $runtimeDir
$env:PLAYWRIGHT_BROWSERS_PATH = $config.browserCache
$env:PATH = "$(Split-Path -Parent $config.node);$env:PATH"
$env:COLLECT_RENDER = 'true'
Push-Location $config.repo
try {
  & $config.node (Join-Path $config.repo 'app/collect.mjs') --all --render --concurrency 4 *>> $log
  exit $LASTEXITCODE
} finally { Pop-Location }
