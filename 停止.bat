@echo off
chcp 65001 >nul
set "PIDFILE=%~dp0data\server.pid"

if not exist "%PIDFILE%" (
  echo Server is not running.
  pause
  exit /b 0
)

set /p PID=<"%PIDFILE%"
echo Stopping server process %PID% ...
taskkill /PID %PID% /F >nul 2>&1
if exist "%PIDFILE%" del "%PIDFILE%" >nul 2>&1
echo Done.
pause
