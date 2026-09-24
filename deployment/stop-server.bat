@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$pidFile='%~dp0runtime\server.pid'; if (Test-Path $pidFile) { $trackerPid=Get-Content $pidFile; Stop-Process -Id $trackerPid -Force -ErrorAction SilentlyContinue; Remove-Item $pidFile -Force }"
