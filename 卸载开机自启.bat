@echo off
chcp 65001 >nul
set "TASK=CourseNotesHelper"

schtasks /delete /tn "%TASK%" /f
if errorlevel 1 (
  echo Task "%TASK%" was not found.
) else (
  echo Removed. The app will no longer start automatically.
)
pause
