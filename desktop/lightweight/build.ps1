$ErrorActionPreference = 'Stop'
$lightDir = $PSScriptRoot
$desktopDir = Split-Path -Parent $lightDir
$repoRoot = Split-Path -Parent $desktopDir
$version = '0.3.0'
$outputRoot = Join-Path $lightDir 'build'
$payloadRoot = Join-Path $outputRoot 'payload'
$hostOutput = Join-Path $outputRoot 'host'
$payloadZip = Join-Path $outputRoot 'SocialFollowerTracker.Payload.zip'
$bootstrapOutput = Join-Path $outputRoot 'bootstrap'
$publishDir = Join-Path $desktopDir 'dist'
$exeName = "Social-Follower-Tracker-$version-Windows-x64.exe"

foreach ($target in @($payloadRoot, $hostOutput, $bootstrapOutput)) {
  $resolvedTarget = [System.IO.Path]::GetFullPath($target)
  $resolvedRoot = [System.IO.Path]::GetFullPath($outputRoot) + [System.IO.Path]::DirectorySeparatorChar
  if (!$resolvedTarget.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to clean path outside build output: $resolvedTarget" }
  if (Test-Path $resolvedTarget) { Remove-Item -LiteralPath $resolvedTarget -Recurse -Force }
  New-Item -ItemType Directory -Path $resolvedTarget -Force | Out-Null
}

dotnet publish (Join-Path $lightDir 'host/SocialFollowerTracker.Host.csproj') -c Release -o $hostOutput
if ($LASTEXITCODE -ne 0) { throw 'Native WebView host build failed.' }
$vulnerabilityReport = & dotnet list (Join-Path $lightDir 'host/SocialFollowerTracker.Host.csproj') package --vulnerable --include-transitive 2>&1
if ($LASTEXITCODE -ne 0) { throw ($vulnerabilityReport -join "`n") }
if (($vulnerabilityReport -join "`n") -match '(?i)has the following vulnerable packages|severity:\s*(moderate|high|critical)') { throw ($vulnerabilityReport -join "`n") }

$runtime = Join-Path $payloadRoot 'runtime'
foreach ($folder in @('app', 'public', 'sql', 'data')) {
  Copy-Item (Join-Path $repoRoot $folder) (Join-Path $runtime $folder) -Recurse -Force
}
Copy-Item (Join-Path $repoRoot 'accounts.csv') (Join-Path $runtime 'accounts.csv')
Copy-Item (Join-Path $repoRoot 'node_modules') (Join-Path $runtime 'node_modules') -Recurse -Force
foreach ($path in @((Join-Path $runtime 'node_modules/.bin'), (Join-Path $runtime 'node_modules/.package-lock.json'), (Join-Path $runtime 'public/data'))) {
  if (Test-Path $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
foreach ($file in Get-ChildItem (Join-Path $runtime 'data') -File -Recurse | Where-Object { $_.Name.EndsWith('-wal') -or $_.Name.EndsWith('-shm') }) {
  Remove-Item -LiteralPath $file.FullName -Force
}
Copy-Item (Join-Path $hostOutput '*') $payloadRoot -Recurse -Force

$installedBytes = (Get-ChildItem $payloadRoot -File -Recurse | Measure-Object Length -Sum).Sum
if ($installedBytes -ge 100MB) { throw "Extracted application payload is $([math]::Round($installedBytes / 1MB, 1)) MB; limit is under 100 MB." }
if (Test-Path $payloadZip) { Remove-Item -LiteralPath $payloadZip -Force }
Compress-Archive -Path (Join-Path $payloadRoot '*') -DestinationPath $payloadZip -CompressionLevel Optimal

dotnet publish (Join-Path $lightDir 'bootstrap/Bootstrap.csproj') -c Release -o $bootstrapOutput -p:PayloadZip="$payloadZip"
if ($LASTEXITCODE -ne 0) { throw 'Desktop bootstrap build failed.' }
$exe = Join-Path $bootstrapOutput 'Social-Follower-Tracker.exe'
if (!(Test-Path $exe)) { throw "Expected launcher was not created: $exe" }
if ((Get-Item $exe).Length -ge 50MB) { throw "Installer exceeds 50 MB: $([math]::Round((Get-Item $exe).Length / 1MB, 1)) MB" }
New-Item -ItemType Directory -Force -Path $publishDir | Out-Null
Copy-Item $exe (Join-Path $publishDir $exeName) -Force
Write-Host "Installer: $(Join-Path $publishDir $exeName)"
Write-Host "Installer size: $([math]::Round((Get-Item (Join-Path $publishDir $exeName)).Length / 1MB, 2)) MB"
Write-Host "Installed application payload: $([math]::Round($installedBytes / 1MB, 2)) MB"
