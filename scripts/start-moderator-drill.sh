#!/usr/bin/env bash
# Moderator drill launcher — starts the dev stack with moderation access enabled.
# Usage: bash scripts/start-moderator-drill.sh
# Override the moderator username: MOD_USERNAME=my-mod bash scripts/start-moderator-drill.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MOD_USERNAME="${MOD_USERNAME:-drill-moderator}"

detect_ip() {
  if command -v ip &>/dev/null; then
    ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") print $(i+1)}' | head -1
  elif command -v ifconfig &>/dev/null; then
    ifconfig | awk '/inet / && !/127\.0\.0\.1/{print $2; exit}'
  else
    echo "127.0.0.1"
  fi
}

LAN_IP=$(detect_ip)
SERVER_PORT=2567
CLIENT_PORT=5173

echo ""
echo "=== Private Kitchen — Moderator Drill Launcher ==="
echo ""
echo "Checking dependencies..."
npm install --silent

echo "Starting Colyseus server on :${SERVER_PORT} (moderator: ${MOD_USERNAME})..."
MODERATOR_USERNAMES="${MOD_USERNAME}" \
  npm run dev --workspace=apps/server &
SERVER_PID=$!

echo "Starting Vite client on :${CLIENT_PORT}..."
VITE_SERVER_URL="ws://${LAN_IP}:${SERVER_PORT}" \
  npm run dev --workspace=apps/client -- --host &
CLIENT_PID=$!

echo ""
echo "Waiting for services to start..."
sleep 4

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║            MODERATOR DRILL FACILITATOR GUIDE             ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
printf  "║  Client URL:         http://%-29s ║\n" "${LAN_IP}:${CLIENT_PORT}"
printf  "║  Moderator username: %-36s ║\n" "${MOD_USERNAME}"
echo "║                                                          ║"
echo "║  Step 1 — Three browser sessions:                        ║"
printf  "║    Session A: register as %-31s ║\n" "${MOD_USERNAME}"
echo "║    Session B: register as any username (recipe owner)    ║"
echo "║    Session C: register as any username (reporter)        ║"
echo "║                                                          ║"
echo "║  Step 2 — Owner (Session B):                             ║"
echo "║    [ ] Create a recipe in Recipe Studio                  ║"
echo "║    [ ] Validate the recipe                               ║"
echo "║    [ ] Select a CC0 license and click Publish            ║"
echo "║                                                          ║"
echo "║  Step 3 — Reporter (Session C):                          ║"
echo "║    [ ] Search for the recipe                             ║"
echo "║    [ ] Expand the Report section, fill in details        ║"
echo "║    [ ] Click Send report                                  ║"
echo "║                                                          ║"
echo "║  Step 4 — Moderator (Session A, browser console):        ║"
echo "║    [ ] Review open reports:                              ║"
echo "║          fetch('/api/moderation/recipe-reports',         ║"
echo "║            {credentials:'include'}).then(r=>r.json())    ║"
echo "║    [ ] Note the recipe id from the response              ║"
echo "║    [ ] Remove the recipe:                                ║"
echo "║          fetch('/api/moderation/recipes/<id>/remove',    ║"
echo "║            {method:'POST',credentials:'include',         ║"
echo "║             headers:{'content-type':'application/json'}, ║"
echo '║             body:JSON.stringify({reason:"details"})})    ║'
echo "║    [ ] Verify removal: reporter searches — 0 results     ║"
echo "║    [ ] Restore the recipe:                               ║"
echo "║          fetch('/api/moderation/recipes/<id>/restore',   ║"
echo "║            {method:'POST',credentials:'include',         ║"
echo "║             headers:{'content-type':'application/json'}, ║"
echo "║             body:'{}'})                                  ║"
echo "║    [ ] Verify restore: reporter searches — 1 result      ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

cleanup() {
  echo ""
  echo "Stopping services..."
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  wait "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  echo "Done."
}
trap cleanup INT TERM

wait
