@echo off
rem Saturday-SWMM portable launcher: starts the local server and opens your browser.
rem Keep this window open while you work; close it to stop Saturday-SWMM.
setlocal
cd /d "%~dp0"
title Saturday-SWMM
set PYTHONNOUSERSITE=1
set PYTHONDONTWRITEBYTECODE=
if not exist "%~dp0python\python.exe" (
  echo The "python" folder is missing. Unzip the whole Saturday-SWMM folder and try again.
  pause
  exit /b 1
)
echo Starting Saturday-SWMM - your browser will open in a moment...
"%~dp0python\python.exe" -m app.launcher %*
if errorlevel 1 (
  echo.
  echo Saturday-SWMM stopped with an error. See the messages above.
  pause
)
