@echo off
title Desktop Pet - Bring On Screen
cd /d "%~dp0"

echo Checking for Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo  Node.js was not found on this computer.
  echo  Install it from https://nodejs.org - the "LTS" version - then run this file again.
  echo.
  goto :end
)

if not exist "node_modules" (
  echo  Installing dependencies for the first time. This can take a minute...
  echo.
  call npm install
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo  Electron did not install correctly. Try running launch.bat first -
  echo  it has more detailed troubleshooting steps.
  echo.
  goto :end
)

echo.
echo  Resetting your pet and summon button to the bottom-right corner...
echo  If the app is already running, it will just pop back into view.
echo.
call npm start -- --bring-on-screen
echo.
echo  Done. If nothing appeared, scroll up for any error messages.

:end
echo.
pause
