@echo off
title SAMURAI SETUP
where python >nul 2>nul
if errorlevel 1 (
  echo Python is not installed or not in PATH.
  echo Install Python 3.8+ from https://www.python.org/downloads/
  echo IMPORTANT: tick "Add Python to PATH" during install, then run SETUP.bat again.
  pause
  exit /b 1
)
python "%~dp0samurai_setup.py"
