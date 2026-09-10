@echo off
title Desktop Pet
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

node -v
npm -v
echo.

if not exist "node_modules" (
  echo  Installing dependencies for the first time. This can take a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  npm install failed - see the error above.
    echo  Most common cause: no internet connection, or a firewall/antivirus blocking npm.
    echo.
    goto :end
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo  Electron did not install correctly last time - this can happen behind a
  echo  firewall, VPN, or antivirus that blocks the Electron binary download.
  echo  Trying to reinstall just Electron...
  echo.
  call npm install electron@33.2.0
  echo.
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo  Electron still did not install. This is almost always a network/firewall
  echo  issue on this machine, not a problem with the app itself. Try:
  echo   1. Turning off VPN/proxy temporarily and running this file again
  echo   2. Checking antivirus logs for a blocked download
  echo   3. Running:  npm install --verbose   from a Command Prompt in this folder
  echo      to see exactly where it fails
  echo.
  goto :end
)

echo  Starting your desktop pet...
echo  A small window may flash briefly - that is normal. The pet then lives
echo  in the system tray, near your clock at the bottom-right of the screen.
echo.
call npm start
echo.
echo  The app has closed. If that was not expected, scroll up to see if there
echo  was an error message above.

:end
echo.
pause
