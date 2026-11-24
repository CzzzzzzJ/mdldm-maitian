@echo off
set "ROOT=%HOWIEIP_STUDIO_HOME%"
if not defined ROOT set "ROOT=%USERPROFILE%\howieip-studio"
if not exist "%ROOT%\howieip-studio\src\demo.mjs" (
  echo [STOP] howieip-studio is NOT installed yet - %ROOT% not found.
  echo Please run install-windows.ps1 FIRST, then double-click this file.
  pause
  exit /b 1
)
cd /d "%ROOT%\howieip-studio"
echo howieip-studio DEMO mode - fake data, no real accounts touched.
echo Open in browser: http://localhost:8788/?key=demo
echo Press Ctrl+C in this window to stop.
node src\demo.mjs
pause
