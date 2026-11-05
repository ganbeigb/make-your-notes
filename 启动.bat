@echo off
chcp 65001 >nul
title Course Notes Helper
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found.
  echo   Please install Node.js 18+ first: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node "server\server.js"

if errorlevel 1 (
  echo.
  echo   Startup failed. Please check the message above.
  pause
)
