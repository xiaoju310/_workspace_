@echo off
setlocal
set "ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\launch-tailscale.ps1" %*
if errorlevel 1 (
  echo.
  echo Private sharing was not started. Read the message above.
  pause
  exit /b 1
)
echo.
echo Keep this computer powered on when teammates use the app.
pause
