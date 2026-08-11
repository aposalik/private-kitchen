#!/usr/bin/env bash
# Playtest launcher — starts the local dev stack and prints facilitator info.
# Usage: bash scripts/start-playtest.sh
# Requires: node >=18, npm >=9, network interface accessible to all 3 devices.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── detect LAN IP ────────────────────────────────────────────────────────────
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
CLIENT_PORT=5173
SERVER_PORT=2567

# ── build check ──────────────────────────────────────────────────────────────
echo ""
echo "=== Private Kitchen — Playtest Launcher ==="
echo ""
echo "Checking dependencies..."
npm install --silent

# ── start server ─────────────────────────────────────────────────────────────
echo "Starting Colyseus game server on :${SERVER_PORT}..."
npm run dev --workspace=apps/server &
SERVER_PID=$!

# ── start client ─────────────────────────────────────────────────────────────
echo "Starting Vite client on :${CLIENT_PORT}..."
VITE_SERVER_URL="ws://${LAN_IP}:${SERVER_PORT}" \
  npm run dev --workspace=apps/client -- --host &
CLIENT_PID=$!

# ── wait for both services ───────────────────────────────────────────────────
echo ""
echo "Waiting for services to start..."
sleep 4

# ── print facilitator info ───────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                   FACILITATOR CHECKLIST                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  Give each player this URL in a SEPARATE browser tab:   ║"
echo "║                                                          ║"
printf  "║    http://%-46s   ║\n"  "${LAN_IP}:${CLIENT_PORT}"
echo "║                                                          ║"
echo "║  Before starting:                                        ║"
echo "║    [ ] 3 devices on the same LAN (or same machine)      ║"
echo "║    [ ] Each device in its own isolated browser profile   ║"
echo "║    [ ] Landscape orientation + headsets connected        ║"
echo "║    [ ] Explain only: role title, objective, controls     ║"
echo "║    [ ] Do NOT reveal the private recipe to non-Keeper    ║"
echo "║                                                          ║"
echo "║  Rotation order (3 rounds = each role once each):       ║"
echo "║    Round 1:  P1=BlindCook  P2=RecipeKeeper  P3=Deaf     ║"
echo "║    Round 2:  P1=Deaf       P2=BlindCook     P3=Keeper   ║"
echo "║    Round 3:  P1=Keeper     P2=Deaf          P3=BlindCook║"
echo "║                                                          ║"
echo "║  After each round:                                       ║"
echo "║    [ ] Each player completes the on-device debrief form  ║"
echo "║    [ ] Each player clicks Export JSON                    ║"
echo "║    [ ] Collect all 3 JSON files                          ║"
echo "║    [ ] Each player clicks Clear local records            ║"
echo "║    [ ] Verify export now returns []                      ║"
echo "║                                                          ║"
echo "║  Protocol: docs/playtesting.md                           ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to stop both services."
echo ""

# ── keep alive ───────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "Stopping services..."
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  wait "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  echo "Done."
}
trap cleanup INT TERM

wait
