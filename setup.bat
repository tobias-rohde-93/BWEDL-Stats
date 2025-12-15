@echo off
title BWEDL Stats Installer
echo ==========================================
echo   BWEDL Stats Dashboard - Installation
echo ==========================================

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python was not found!
    echo Please install Python from https://www.python.org/downloads/
    echo and make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b
)

echo [1/3] Creating virtual environment...
if not exist venv (
    python -m venv venv
) else (
    echo Virtual environment already exists.
)

echo [2/3] Installing dependencies...
call venv\Scripts\activate
pip install -r requirements.txt

echo [3/3] Creating Desktop Shortcut...
set SCRIPT="%TEMP%\CreateShortcut.vbs"
echo Set oWS = WScript.CreateObject("WScript.Shell") > %SCRIPT%
echo sLinkFile = oWS.ExpandEnvironmentStrings("%%USERPROFILE%%\Desktop\BWEDL Stats.lnk") >> %SCRIPT%
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> %SCRIPT%
echo oLink.TargetPath = "%~dp0start.bat" >> %SCRIPT%
echo oLink.WorkingDirectory = "%~dp0" >> %SCRIPT%
echo oLink.Description = "Start BWEDL Dashboard" >> %SCRIPT%
echo oLink.Save >> %SCRIPT%
cscript /nologo %SCRIPT%
del %SCRIPT%

echo.
echo ==========================================
echo   Installation complete!
echo   You can now start the dashboard using the 
echo   "BWEDL Stats" shortcut on your Desktop.
echo ==========================================
pause
