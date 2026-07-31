#!/usr/bin/env bash
#
# Starts a local Hardhat node, deploys AutoPay to it with demo plans,
# and prints everything you need to drive the frontend locally.
# Ctrl+C stops the node.
#
set -euo pipefail

cd "$(dirname "$0")/.."

RPC="http://127.0.0.1:8545"
LOG="$(pwd)/.hardhat-node.log"

if command -v lsof >/dev/null 2>&1 && lsof -i :8545 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  Port 8545 is already in use. Stop the other node first."
  exit 1
fi

echo "  Starting Hardhat node (log: .hardhat-node.log)..."
npx hardhat node >"$LOG" 2>&1 &
NODE_PID=$!
cleanup() {
  # Guard: INT/TERM and EXIT both fire, and we only want one shutdown.
  [ -n "${CLEANED:-}" ] && return
  CLEANED=1
  echo
  echo "  Stopping node..."
  kill $NODE_PID 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Wait for the RPC to answer before deploying.
for _ in $(seq 1 60); do
  if curl -s -X POST -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      "$RPC" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! kill -0 $NODE_PID 2>/dev/null; then
  echo "  Node failed to start. Last lines of the log:"
  tail -20 "$LOG"
  exit 1
fi

SEED_PLANS=true npx hardhat run scripts/deploy.js --network localhost

cat <<'EOF'
  ── Connect MetaMask to the local chain ───────────────────────
   Network name : Hardhat Local
   RPC URL      : http://127.0.0.1:8545
   Chain ID     : 31337
   Currency     : ETH

   Test account #0 (10000 ETH, publicly known key — local use only):
     Address     : 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
     Private key : 0xac0973...f2ff80  (full key in .hardhat-node.log)

  ── Open the frontend ─────────────────────────────────────────
   Run in another terminal:  npx serve frontend
   ...or just open frontend/index.html in your browser.

   If you redeploy, MetaMask caches the old nonce — use
   Settings > Advanced > Clear activity tab data to reset it.

  Node is running. Press Ctrl+C to stop.
EOF

wait $NODE_PID
