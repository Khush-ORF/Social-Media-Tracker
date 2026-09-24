@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Unregister-ScheduledTask -TaskName 'SocialFollowerTracker-MonthEnd' -Confirm:$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'SocialFollowerTracker-Server' -Confirm:$false -ErrorAction SilentlyContinue"
