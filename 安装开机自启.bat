@echo off
chcp 65001 >nul
set "TASK=CourseNotesHelper"

for %%F in ("%~dp0*.vbs") do set "VBS=%%~fF"
if not defined VBS (
  echo Cannot find the .vbs launcher next to this file.
  pause
  exit /b 1
)

echo Registering logon task "%TASK%" ...
schtasks /create /tn "%TASK%" /tr "wscript.exe \"%VBS%\"" /sc onlogon /rl limited /f

if errorlevel 1 (
  echo.
  echo Failed. Right-click this file and choose "Run as administrator", then try again.
) else (
  echo.
  echo Done. The app will start hidden in the background after you log in.
  echo To remove it, run 卸载开机自启.bat
)
pause
