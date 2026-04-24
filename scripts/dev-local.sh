#!/usr/bin/env bash
# dev-local.sh — start surfpool, deploy the Anchor program, then run next dev.
# Ctrl-C tears the whole stack down cleanly.
#
# Usage: npm run dev:local
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

RPC_URL="http://127.0.0.1:8899"
RPC_WS="ws://127.0.0.1:8900"
PROGRAM_SO="$ROOT/anchor/target/deploy/spotr_markets.so"
PROGRAM_KP="$ROOT/anchor/target/deploy/spotr_markets-keypair.json"
PAYER_KP="$HERE/.dev-payer-keypair.json"
SURFPOOL_LOG="$HERE/.surfpool-dev.log"
SURFPOOL_PID_FILE="$HERE/.surfpool-dev.pid"

# ── sanity checks ───────────────────────────────────────────────────────────
if ! command -v surfpool &>/dev/null; then
  echo "[dev-local] ✗  surfpool not found. Install it first." >&2
  exit 1
fi

if ! command -v solana &>/dev/null; then
  echo "[dev-local] ✗  solana CLI not found." >&2
  exit 1
fi

if [ ! -f "$PROGRAM_SO" ]; then
  echo "[dev-local] program .so not found at $PROGRAM_SO"
  echo "[dev-local] running anchor build …"
  (cd "$ROOT/anchor" && anchor build)
fi

# ── cleanup on exit ─────────────────────────────────────────────────────────
NEXT_PID=""
cleanup() {
  echo ""
  echo "[dev-local] shutting down …"
  if [ -n "$NEXT_PID" ] && kill -0 "$NEXT_PID" 2>/dev/null; then
    kill "$NEXT_PID" 2>/dev/null || true
  fi
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

# ── start surfpool ───────────────────────────────────────────────────────────
echo "[dev-local] starting surfpool (log → $SURFPOOL_LOG)"
rm -f "$SURFPOOL_LOG"
surfpool start --ci --port 8899 --ws-port 8900 >"$SURFPOOL_LOG" 2>&1 &
echo $! >"$SURFPOOL_PID_FILE"

echo "[dev-local] waiting for RPC at $RPC_URL …"
for attempt in $(seq 1 60); do
  if curl -s -o /dev/null -w "%{http_code}" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
      "$RPC_URL" 2>/dev/null | grep -q 200; then
    break
  fi
  sleep 0.5
  if [ "$attempt" -eq 60 ]; then
    echo "[dev-local] ✗  surfpool did not become ready; last log lines:" >&2
    tail -n 30 "$SURFPOOL_LOG" >&2
    exit 1
  fi
done
echo "[dev-local] ✓  surfpool ready"

# ── payer keypair ────────────────────────────────────────────────────────────
if [ ! -f "$PAYER_KP" ]; then
  echo "[dev-local] generating payer keypair at $PAYER_KP"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$PAYER_KP" >/dev/null
fi

PAYER_PUBKEY=$(solana-keygen pubkey "$PAYER_KP")
echo "[dev-local] payer: $PAYER_PUBKEY"

echo "[dev-local] airdropping 1000 SOL …"
solana airdrop 1000 "$PAYER_PUBKEY" --url "$RPC_URL" --keypair "$PAYER_KP" >/dev/null

# ── deploy ───────────────────────────────────────────────────────────────────
echo "[dev-local] deploying spotr_markets …"
solana program deploy \
  --url "$RPC_URL" \
  --keypair "$PAYER_KP" \
  --program-id "$PROGRAM_KP" \
  "$PROGRAM_SO"
echo "[dev-local] ✓  program deployed"

# ── mock USDC token ──────────────────────────────────────────────────────────
mkdir -p "$ROOT/keys"
USDC_AUTH_KP="$ROOT/keys/usdc-mint-authority.json"
USDC_MINT_KP="$ROOT/keys/usdc-mint.json"

if [ ! -f "$USDC_AUTH_KP" ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$USDC_AUTH_KP" >/dev/null
fi
if [ ! -f "$USDC_MINT_KP" ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$USDC_MINT_KP" >/dev/null
fi

USDC_AUTH_PUBKEY=$(solana-keygen pubkey "$USDC_AUTH_KP")
USDC_MINT_ADDR=$(solana-keygen pubkey "$USDC_MINT_KP")

# Fund authority on this fresh validator instance
solana airdrop 100 "$USDC_AUTH_PUBKEY" --url "$RPC_URL" --keypair "$PAYER_KP" >/dev/null

# Create the token using the persistent mint keypair (address stays stable across runs)
spl-token create-token \
  --url "$RPC_URL" \
  --fee-payer "$PAYER_KP" \
  --mint-authority "$USDC_AUTH_PUBKEY" \
  --decimals 6 \
  "$USDC_MINT_KP" >/dev/null
echo "[dev-local] ✓  mock USDC mint: $USDC_MINT_ADDR"

# ── next dev ────────────────────────────────────────────────────────────────
# Override cluster for the entire Next.js process tree.
export NEXT_PUBLIC_SPOTR_CLUSTER=localnet
export USDC_MINT_ADDRESS="$USDC_MINT_ADDR"
export NEXT_PUBLIC_USDC_MINT_ADDRESS="$USDC_MINT_ADDR"
export SOLANA_RPC_URL="$RPC_URL"
export SOLANA_WS_URL="$RPC_WS"

echo "[dev-local] starting next dev (localnet) …"
npm run generate:public-config
npx next dev &
NEXT_PID=$!

wait "$NEXT_PID"
