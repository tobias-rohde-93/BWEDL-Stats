@echo off
title BWEDL Stats Dashboard
echo Starting Dashboard...

:: Ensure venv exists
if not exist venv (
    echo Setup not found. Please run setup.bat first.
    pause
    exit /b
)

:: Activate environment
call venv\Scripts\activate

:: Open Browser
echo Opening http://localhost:8000 ...
start http://localhost:8000

:: Start Server
echo Starting Server (Close this window to stop)...
python server.py
pause
