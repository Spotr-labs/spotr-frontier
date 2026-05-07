#!/usr/bin/env bash
# End-to-end test harness: spin up surfpool, deploy the program, run the
# TypeScript test, then tear everything down. Requires `surfpool`, `solana`,
# and the compiled `target/deploy/spotr_markets.so` on disk.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

RPC_URL=${SPOTR_E2E_RPC_URL:-http://127.0.0.1:8899}
RPC_WS=${SPOTR_E2E_RPC_WS:-ws://127.0.0.1:8900}
SURFPOOL_ARGS=${SPOTR_SURFPOOL_ARGS:---offline}
SURFPOOL_PID_FILE="$HERE/.surfpool.pid"
SURFPOOL_LOG="$HERE/.surfpool.log"
PROGRAM_SO="$ROOT/anchor/target/deploy/spotr_markets.so"
PROGRAM_KP="$ROOT/anchor/target/deploy/spotr_markets-keypair.json"
PAYER_KP="$HERE/.payer-keypair.json"

if [ ! -f "$PROGRAM_SO" ]; then
  echo "Missing $PROGRAM_SO. Run 'anchor build' from ./anchor first." >&2
  exit 1
fi

cleanup() {
  if [ -f "$SURFPOOL_PID_FILE" ]; then
    pid=$(cat "$SURFPOOL_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$SURFPOOL_PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

echo "[e2e] starting surfpool (log → $SURFPOOL_LOG)"
rm -f "$SURFPOOL_LOG"
surfpool start --ci --port 8899 --ws-port 8900 ${SURFPOOL_ARGS} > "$SURFPOOL_LOG" 2>&1 &
echo $! > "$SURFPOOL_PID_FILE"

echo "[e2e] waiting for rpc readiness at $RPC_URL"
for attempt in $(seq 1 40); do
  if curl -s -o /dev/null -w "%{http_code}" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
      "$RPC_URL" | grep -q 200; then
    break
  fi
  sleep 0.5
  if [ "$attempt" -eq 40 ]; then
    echo "[e2e] surfpool did not become ready; log tail:" >&2
    tail -n 40 "$SURFPOOL_LOG" >&2
    exit 1
  fi
done

if [ ! -f "$PAYER_KP" ]; then
  echo "[e2e] generating payer keypair at $PAYER_KP"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$PAYER_KP" >/dev/null
fi

PAYER_PUBKEY=$(solana-keygen pubkey "$PAYER_KP")
echo "[e2e] payer: $PAYER_PUBKEY"

echo "[e2e] airdropping 1000 SOL to payer"
solana airdrop 1000 "$PAYER_PUBKEY" --url "$RPC_URL" --keypair "$PAYER_KP" >/dev/null

echo "[e2e] deploying program"
solana program deploy \
  --url "$RPC_URL" \
  --keypair "$PAYER_KP" \
  --program-id "$PROGRAM_KP" \
  "$PROGRAM_SO" >/dev/null

# ── mock USDC token (persistent keypair, stable address across runs) ─────────
USDC_AUTH_KP="$ROOT/keys/usdc-mint-authority.json"
USDC_MINT_KP="$ROOT/keys/usdc-mint.json"
if [ ! -f "$USDC_AUTH_KP" ] || [ ! -f "$USDC_MINT_KP" ]; then
  echo "[e2e] missing USDC mint keypair files in $ROOT/keys/; run dev-local.sh once or commit them." >&2
  exit 1
fi
USDC_AUTH_PUBKEY=$(solana-keygen pubkey "$USDC_AUTH_KP")
USDC_MINT_ADDR=$(solana-keygen pubkey "$USDC_MINT_KP")
solana airdrop 100 "$USDC_AUTH_PUBKEY" --url "$RPC_URL" --keypair "$PAYER_KP" >/dev/null
spl-token create-token \
  --url "$RPC_URL" \
  --fee-payer "$PAYER_KP" \
  --mint-authority "$USDC_AUTH_PUBKEY" \
  --decimals 6 \
  "$USDC_MINT_KP" >/dev/null
echo "[e2e] ✓  mock USDC mint: $USDC_MINT_ADDR"

echo "[e2e] running tsx test"
SPOTR_E2E_RPC_URL="$RPC_URL" \
SPOTR_E2E_RPC_WS="$RPC_WS" \
SPOTR_E2E_USDC_MINT="$USDC_MINT_ADDR" \
SPOTR_E2E_USDC_AUTHORITY_KEYPAIR="$USDC_AUTH_KP" \
node --import tsx "$HERE/spotr-onchain.test.ts"

echo "[e2e] ✓ PASSED"
