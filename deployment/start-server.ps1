$ErrorActionPreference = 'Stop'
$runtimeDir = Join-Path $PSScriptRoot 'runtime'
$config = Get-Content (Join-Path $runtimeDir 'deployment.json') -Raw | ConvertFrom-Json
$env:TRACKER_DATA_ROOT = $runtimeDir
$env:PLAYWRIGHT_BROWSERS_PATH = $config.browserCache
$env:HOST = '127.0.0.1'
$env:PORT = '4173'
$log = Join-Path $runtimeDir 'logs/server.log'
$nodeScript = Join-Path $config.repo 'app/server.mjs'
$process = Start-Process -FilePath $config.node -ArgumentList @($nodeScript) -WorkingDirectory $config.repo -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError (Join-Path $runtimeDir 'logs/server-error.log')
Set-Content -Path (Join-Path $runtimeDir 'server.pid') -Value $process.Id
