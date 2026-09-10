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
fi

echo ""
echo "  Resetting your pet and summon button to the bottom-right corner..."
echo "  If the app is already running, it will just pop back into view."
echo ""
npm start -- --bring-on-screen
echo ""
echo "  Done. If nothing appeared, scroll up for any error messages."
read -p "Press Enter to close..." _
