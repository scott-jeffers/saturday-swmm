@echo off
rem Saturday-SWMM portable launcher: starts the local server and opens your browser.
rem Keep this window open while you work; close it to stop Saturday-SWMM.
setlocal
cd /d "%~dp0"
title Saturday-SWMM
set PYTHONNOUSERSITE=1
set PYTHONDONTWRITEBYTECODE=
"%~dp0python\python.exe" -m app.launcher %*
if errorlevel 1 (
  echo.
  echo Saturday-SWMM stopped with an error. See the messages above.
  pause
)
