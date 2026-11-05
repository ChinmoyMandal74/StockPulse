@echo off
rem Double-click this file to register the 'TickrLab onboard' scheduled task
rem (onboard-task.ps1), for anyone who would rather not open PowerShell.
rem Safe to run again: it updates the task in place.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0onboard-task.ps1"
echo.
echo Press any key to close this window.
pause >nul
