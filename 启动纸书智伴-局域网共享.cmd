@echo off
setlocal
set "ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\launch.ps1" -Share -Port 8001 %*
if errorlevel 1 (
  echo.
  echo LAN sharing was not started. Read the message above.
  pause
  exit /b 1
)
echo.
echo Keep this computer powered on for other users. Close this window at any time.
pause
