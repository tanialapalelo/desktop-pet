#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js was not found on this computer."
  echo "  Install it from https://nodejs.org (the \"LTS\" version), then run this file again."
  echo ""
  read -p "Press Enter to close..." _
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo ""
  echo "  Setting things up for the first time. This can take a minute..."
  echo ""
  npm install
  if [ $? -ne 0 ]; then
    echo ""
    echo "  npm install failed - check your internet connection and try again."
    read -p "Press Enter to close..." _
    exit 1
  fi
fi

if [ ! -d "node_modules/electron/dist/Electron.app" ] && [ ! -f "node_modules/electron/dist/electron" ]; then
  echo ""
  echo "  Electron did not install correctly. Trying to reinstall it..."
  npm install electron@33.2.0
fi

echo ""
echo "  Starting your desktop pet..."
echo "  A small window may flash briefly - that's normal. The pet then lives"
echo "  in the menu bar at the top of your screen."
echo ""
npm start
echo ""
echo "  The app has closed. If that wasn't expected, scroll up for any errors."
read -p "Press Enter to close..." _
