#!/bin/zsh
# pagi-on.sh — nyalakan lagi: Next.js dev + cron tick.
cd "$(dirname "$0")/.."
npm run dev > /tmp/kantor-dev.log 2>&1 &
sleep 10
launchctl load ~/Library/LaunchAgents/id.kantor.tick.plist 2>/dev/null
echo "kantor buka:"
echo "  office    http://localhost:3000/kantor"
echo "  dashboard http://localhost:3000/dashboard"
