#!/bin/zsh
# malam-off.sh — matikan semua service Kantor AI (tidur nyenyak, laptop ringan).
# Yang dihentikan: Next.js dev, cron tick 5-menit, sisa proses `opencode run`.
# TIDAK menyentuh: opencode background service (dipakai harness/chat ini).
cd "$(dirname "$0")/.."
pkill -f "opencode run" 2>/dev/null
pkill -f "next-server (v15" 2>/dev/null
launchctl unload ~/Library/LaunchAgents/id.kantor.tick.plist 2>/dev/null
echo "kantor tidur. 🌙"
