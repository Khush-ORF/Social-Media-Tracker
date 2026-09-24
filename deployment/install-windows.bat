@echo off
setlocal
set "SCRIPT=%~dp0install-windows.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','%SCRIPT%')"
if errorlevel 1 exit /b %errorlevel%
echo Deployment setup started with administrator rights.
