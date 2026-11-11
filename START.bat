@echo off
title SAMURAI
set PYW=%~dp0.venv\Scripts\pythonw.exe
if not exist "%PYW%" (
  where pythonw >nul 2>nul || (echo Python not found. Run SETUP.bat first. & pause & exit /b 1)
  set PYW=pythonw
)
start "" "%PYW%" "%~dp0servers\samurai_panel.py" --autostart
