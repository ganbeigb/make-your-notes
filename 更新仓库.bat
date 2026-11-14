@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not exist ".git" (
  echo [ERROR] This folder is not a Git repository: %CD%
  echo Run this first:  git init -b main
  pause
  exit /b 1
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo [INFO] No remote configured, nothing to push to.
  echo Run:  git remote add origin https://github.com/USER/REPO.git
  pause
  exit /b 1
)

echo ==========================================
echo    Push update to GitHub
echo ==========================================
echo.
git status --short
echo.

set "MSG="
set /p "MSG=Commit message (press Enter for default): "
if "%MSG%"=="" set "MSG=update: sync latest changes"

git add -A
git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo [INFO] Nothing to commit, working tree clean.
  pause
  exit /b 0
)

git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo [ERROR] Commit failed. See the message above.
  pause
  exit /b 1
)

echo.
echo Pushing to GitHub...
git push
if errorlevel 1 (
  echo.
  echo [ERROR] Push failed. Common causes:
  echo   1. Not signed in - run "git push" again and sign in with browser
  echo   2. Wrong remote - check with "git remote -v"
  echo   3. Network issue - retry later
  pause
  exit /b 1
)

echo.
echo [DONE] Pushed. Last 5 commits:
git log --oneline -5
echo.
echo The teacher can see this update on the repository commits page.
pause
