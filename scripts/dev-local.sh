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
SURFPOOL_ARGS=${SPOTR_SURFPOOL_ARGS:---offline}
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

# Surfpool 1.2.x reports solana-core 3.1.x and rejects the JSON-RPC
# request shape produced by solana-cli 2.3.x and 3.0.x with HTTP 400. The
# 4.0.0 (edge) release on this machine talks to it correctly, so prefer
# that for the lifetime of this script if available.
_edge_solana_bin="$(ls -d /Users/$(whoami)/.local/share/solana/install/releases/edge-*/solana-release/bin 2>/dev/null | head -1)"
if [ -n "$_edge_solana_bin" ] && [ -x "$_edge_solana_bin/solana" ]; then
  export PATH="$_edge_solana_bin:$PATH"
  echo "[dev-local] using solana CLI: $($_edge_solana_bin/solana --version | head -1)"
fi

if [ ! -f "$PROGRAM_SO" ] || [ "$ROOT/anchor/programs/spotr_markets/src/lib.rs" -nt "$PROGRAM_SO" ]; then
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

# ── tear down any stale processes from a previous session ───────────────────
for _port in 8899 8900; do
  lsof -ti tcp:"$_port" | xargs kill -9 2>/dev/null || true
done
pkill -f "next dev" 2>/dev/null || true
rm -f "$ROOT/.next/dev/lock"

# ── start surfpool ───────────────────────────────────────────────────────────
echo "[dev-local] starting surfpool (log → $SURFPOOL_LOG)"
rm -f "$SURFPOOL_LOG"
surfpool start --ci --port 8899 --ws-port 8900 ${SURFPOOL_ARGS} >"$SURFPOOL_LOG" 2>&1 &
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

# Wait for the validator to advance at least one slot so it can process transactions.
for attempt in $(seq 1 30); do
  slot=$(curl -s -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' \
    "$RPC_URL" 2>/dev/null | grep -o '"result":[0-9]*' | grep -o '[0-9]*$')
  if [ -n "$slot" ] && [ "$slot" -gt 0 ] 2>/dev/null; then
    break
  fi
  sleep 0.5
  if [ "$attempt" -eq 30 ]; then
    echo "[dev-local] ✗  surfpool not producing slots; last log lines:" >&2
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
# `--use-rpc` routes write transactions through the JSON-RPC port instead of
# TPU/QUIC. surfpool does not expose a TPU socket, so the default deploy path
# 400s. The deploy is also intermittently flaky — surfpool sometimes drops
# the socket on the first attempt right after startup ("error sending
# request for url"). Retry up to 3× with a short backoff before giving up.
echo "[dev-local] deploying spotr_markets …"
_deploy_attempt=0
_deploy_max=3
while true; do
  _deploy_attempt=$((_deploy_attempt + 1))
  if solana program deploy \
      --use-rpc \
      --url "$RPC_URL" \
      --keypair "$PAYER_KP" \
      --program-id "$PROGRAM_KP" \
      "$PROGRAM_SO"; then
    break
  fi
  if [ "$_deploy_attempt" -ge "$_deploy_max" ]; then
    echo "[dev-local] ✗  deploy failed after ${_deploy_max} attempts" >&2
    exit 1
  fi
  echo "[dev-local] deploy attempt ${_deploy_attempt} failed; retrying in 2s …" >&2
  sleep 2
done
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

# Fund the mint authority on this fresh validator instance
solana airdrop 100 "$USDC_AUTH_PUBKEY" --url "$RPC_URL" --keypair "$PAYER_KP" >/dev/null

# Create the token using the persistent mint keypair (address stays stable across runs).
# Guard against the rare case where surfpool kept state across restarts.
if spl-token display "$USDC_MINT_ADDR" --url "$RPC_URL" &>/dev/null; then
  echo "[dev-local] ✓  mock USDC mint already exists: $USDC_MINT_ADDR"
else
  spl-token create-token \
    --url "$RPC_URL" \
    --fee-payer "$PAYER_KP" \
    --mint-authority "$USDC_AUTH_PUBKEY" \
    --decimals 6 \
    "$USDC_MINT_KP" >/dev/null
  echo "[dev-local] ✓  mock USDC mint: $USDC_MINT_ADDR"
fi

# ── on-chain env exports ─────────────────────────────────────────────────────
export NEXT_PUBLIC_SPOTR_CLUSTER=localnet
export USDC_MINT_ADDRESS="$USDC_MINT_ADDR"
export NEXT_PUBLIC_USDC_MINT_ADDRESS="$USDC_MINT_ADDR"
export SOLANA_RPC_URL="$RPC_URL"
export SOLANA_WS_URL="$RPC_WS"

# ── fund fee payer + admin wallets + initialize on-chain config ──────────────
SPONSOR_PUBKEY="CChvxUR37fry8i2Gdvyrmwu2PH8vgZeTcFwtNqLxaHDW"
echo "[dev-local] funding fee payer ($SPONSOR_PUBKEY) …"
solana airdrop 100 "$SPONSOR_PUBKEY" --url "$RPC_URL" --keypair "$PAYER_KP" >/dev/null

# Export threshold so generate-public-config and deploy-localnet-session read the right value.
_fill_threshold=$(grep '^NEXT_PUBLIC_SPOTR_ROUND_FILL_THRESHOLD=' "$ROOT/.env.local" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
[ -n "$_fill_threshold" ] && export NEXT_PUBLIC_SPOTR_ROUND_FILL_THRESHOLD="$_fill_threshold"

# Also fund every admin wallet so they can sign transactions from the browser.
_admin_wallets=$(grep '^SPOTR_ADMIN_WALLETS=' "$ROOT/.env.local" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
[ -n "$_admin_wallets" ] && export SPOTR_ADMIN_WALLETS="$_admin_wallets"
if [ -n "$_admin_wallets" ]; then
  echo "[dev-local] funding admin wallets …"
  IFS=',' read -ra _admin_arr <<< "$_admin_wallets"
  for _admin in "${_admin_arr[@]}"; do
    _admin=$(echo "$_admin" | tr -d ' ')
    [ -n "$_admin" ] && solana airdrop 100 "$_admin" --url "$RPC_URL" --keypair "$PAYER_KP" >/dev/null && \
      echo "[dev-local]   funded $_admin"
  done
fi

echo "[dev-local] initializing on-chain config …"
npx tsx scripts/init-localnet-config.ts
echo "[dev-local] ✓  on-chain config ready"

# ── next dev ────────────────────────────────────────────────────────────────

# Set launch ISO to today so the session activates immediately on first join.
# The seed + generate scripts read this from process.env before loading .env files,
# so this value wins over whatever is in .env.local.
export NEXT_PUBLIC_SPOTR_LAUNCH_ISO="$(date -u +'%Y-%m-%dT00:00:00.000Z')"
export NEXT_PUBLIC_SPOTR_DEFAULT_SESSION_END_HOUR_UTC=23

# ── db reset + seed ──────────────────────────────────────────────────────────
echo "[dev-local] resetting database …"
# Prisma CLI reads .env but not .env.local — load the local DATABASE_URL explicitly
# so it hits the local postgres instance, not the cloud database in .env.
if [ -f "$ROOT/.env.local" ]; then
  _local_db=$(grep '^DATABASE_URL=' "$ROOT/.env.local" | head -1 | cut -d= -f2- | tr -d '"')
  [ -n "$_local_db" ] && export DATABASE_URL="$_local_db"
fi
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes" npx prisma db push --force-reset --skip-generate
node --env-file=.env --env-file=.env.local scripts/seed-spotr.mjs
npx tsx scripts/deploy-localnet-session.ts
echo "[dev-local] ✓  database ready"

echo "[dev-local] starting next dev (localnet) …"
npm run generate:public-config
npx next dev &
NEXT_PID=$!

wait "$NEXT_PID"
