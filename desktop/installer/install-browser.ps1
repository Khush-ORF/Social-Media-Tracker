param(
  [Parameter(Mandatory = $true)][string]$ExecutablePath,
  [Parameter(Mandatory = $true)][string]$RuntimePath,
  [Parameter(Mandatory = $true)][string]$BrowserPath
)
$ErrorActionPreference = 'Stop'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:PLAYWRIGHT_BROWSERS_PATH = $BrowserPath
$env:PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT = '120000'
$cliPath = Join-Path $RuntimePath 'node_modules\playwright-core\cli.js'
if (!(Test-Path -LiteralPath $cliPath)) { throw 'The packaged Playwright installer is missing.' }
Write-Output 'Downloading the collection browser. Your records are not changed.'
& $ExecutablePath $cliPath install chromium | Out-Host
$downloadExitCode = $LASTEXITCODE
if ($downloadExitCode -ne 0) { exit $downloadExitCode }
$browserExecutable = Get-ChildItem -LiteralPath $BrowserPath -Filter chrome.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (!$browserExecutable) { throw 'The browser download finished without a usable Chromium executable.' }
Write-Output 'Collection browser installed successfully.'
exit 0
