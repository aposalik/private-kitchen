#!/usr/bin/env bash
# Physical device test launcher.
# Generates a self-signed TLS cert, starts the Colyseus server and the Vite
# HTTPS dev client, then prints the device testing checklist.
#
# Usage: bash scripts/start-device-test.sh
# Requires: node >=18, npm >=9, openssl, all devices on the same LAN.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── requirements ─────────────────────────────────────────────────────────────
if ! command -v openssl &>/dev/null; then
  echo "ERROR: openssl is required. Install it and retry."
  exit 1
fi

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
SERVER_PORT=2567
CLIENT_PORT=5173

# ── generate self-signed cert ─────────────────────────────────────────────────
CERT_DIR=$(mktemp -d)
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

echo ""
echo "=== Private Kitchen — Physical Device Test Launcher ==="
echo ""
echo "Generating self-signed TLS certificate for ${LAN_IP}..."
openssl req -x509 \
  -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -days 1 \
  -nodes \
  -subj "/CN=${LAN_IP}" \
  -addext "subjectAltName=IP:${LAN_IP},IP:127.0.0.1,DNS:localhost" \
  2>/dev/null
echo "Certificate generated (valid 24 h, ${LAN_IP})."

export DEVICE_TEST_CERT="$CERT_FILE"
export DEVICE_TEST_KEY="$KEY_FILE"

# ── start server ─────────────────────────────────────────────────────────────
echo "Checking dependencies..."
npm install --silent

echo "Starting Colyseus server on :${SERVER_PORT}..."
npm run dev --workspace=apps/server &
SERVER_PID=$!

# ── start HTTPS client ────────────────────────────────────────────────────────
echo "Starting Vite HTTPS client on :${CLIENT_PORT}..."
npm run dev --workspace=apps/client -- \
  --config apps/client/vite.device-test.ts \
  --host &
CLIENT_PID=$!

echo ""
echo "Waiting for services to start..."
sleep 5

# ── print checklist ───────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           PHYSICAL DEVICE TEST CHECKLIST                 ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
printf  "║  HTTPS URL: https://%-37s ║\n" "${LAN_IP}:${CLIENT_PORT}"
echo "║                                                          ║"
echo "║  IMPORTANT — accept the self-signed cert warning on      ║"
echo "║  each device (Advanced → Proceed). iOS Safari: visit     ║"
echo "║  the URL in Settings > Safari first if needed.           ║"
echo "║                                                          ║"
echo "║  Test matrix (record results in docs/browser-support.md):║"
echo "║    [ ] Device, OS, browser versions                      ║"
echo "║    [ ] Portrait prompt visible and dismissable           ║"
echo "║    [ ] Landscape recovery after rotation                 ║"
echo "║    [ ] Optional fullscreen / orientation lock            ║"
echo "║    [ ] Lobby and gameplay touch controls respond         ║"
echo "║    [ ] Drawing, cancellation, scroll work correctly      ║"
echo "║    [ ] Notch / safe-area clearance (no clipped content)  ║"
echo "║    [ ] Reload / reconnect preserves identity and role    ║"
echo "║    [ ] Microphone permission prompt appears              ║"
echo "║    [ ] Role-filtered audio: Keeper hears both, Blind     ║"
echo "║         Cook hears one, Deaf Guide hears none            ║"
echo "║    [ ] Speaker output audible                            ║"
echo "║    [ ] Three-device LAN round completes to Win or Loss   ║"
echo "║                                                          ║"
echo "║  Guide: docs/device-testing.md                           ║"
echo "║  Evidence template: docs/browser-support.md             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to stop all services and remove the cert."
echo ""

# ── keep alive ────────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "Stopping services and removing cert..."
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  wait "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  rm -rf "$CERT_DIR"
  echo "Done."
}
trap cleanup INT TERM

wait
