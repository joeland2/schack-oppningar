#!/bin/sh
# The share image (og.png) and the home-screen icon (apple-touch-icon.png) from their HTML here, with Chrome.
cd "$(dirname "$0")/../.."
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$C" --headless --disable-gpu --hide-scrollbars --virtual-time-budget=5000 --window-size=1200,630 --screenshot="$PWD/og.png" "file://$PWD/tools/brand/og.html"
"$C" --headless --disable-gpu --hide-scrollbars --window-size=180,180 --screenshot="$PWD/apple-touch-icon.png" "file://$PWD/tools/brand/icon.html"
