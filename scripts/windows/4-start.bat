@echo off
set "ROOT=%MAITIAN_HOME%"
if not defined ROOT set "ROOT=%USERPROFILE%\maitian"
if not exist "%ROOT%\mdldm-maitian\src\hub.mjs" (
  echo [STOP] Maitian is NOT installed yet - %ROOT% not found.
  echo Please run install-windows.ps1 FIRST.
  pause
  exit /b 1
)
if not exist "%ROOT%\mdldm-maitian\data" mkdir "%ROOT%\mdldm-maitian\data"
cd /d "%ROOT%\mdldm-maitian"
echo Maitian daemon starting. Dashboard: http://127.0.0.1:8787/ (this machine only). Login key is web.key in config.json. The wizard showed it once; logs and Feishu do not.
echo Keep this window open - closing it stops Maitian.
node src\hub.mjs daemon
pause
