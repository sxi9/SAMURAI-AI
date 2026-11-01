@echo off
title SAMURAI
where pythonw >nul 2>nul
if errorlevel 1 (
  echo Python not found. Run SETUP.bat first.
  pause
  exit /b 1
)
start "" pythonw "%~dp0samurai_dashboard.py" --autostart
