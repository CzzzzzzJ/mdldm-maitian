@echo off
set "ROOT=%HOWIEIP_STUDIO_HOME%"
if not defined ROOT set "ROOT=%USERPROFILE%\howieip-studio"
if not exist "%ROOT%\howieip-studio\src\hub.mjs" (
  echo [STOP] howieip-studio is NOT installed yet - %ROOT% not found.
  echo Please run install-windows.ps1 FIRST.
  pause
  exit /b 1
)
if not exist "%ROOT%\howieip-studio\data" mkdir "%ROOT%\howieip-studio\data"
cd /d "%ROOT%\howieip-studio"
echo This opens howieip-studio's DEDICATED Chrome (separate profile).
echo Log in to each platform yourself, then close it and run 3-doctor.bat.
node src\hub.mjs login
pause
