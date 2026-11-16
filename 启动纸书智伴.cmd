@echo off
setlocal
set "ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\launch.ps1" %*
if errorlevel 1 (
  echo.
  echo Startup failed. Please read the message above.
  pause
  exit /b 1
)
