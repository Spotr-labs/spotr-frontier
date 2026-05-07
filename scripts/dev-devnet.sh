#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

set -a
# shellcheck source=../.env.devnet
source "$ROOT/.env.devnet"
set +a

# Hide .env.local during this run so Next.js can't auto-load it and shadow
# .env.devnet values. Vercel has no .env.local; this preserves the mirror.
LOCAL_ENV="$ROOT/.env.local"
LOCAL_BACKUP="$ROOT/.env.local.devnet-bak"
# Self-heal from a previously interrupted run.
[ -f "$LOCAL_BACKUP" ] && [ ! -f "$LOCAL_ENV" ] && mv "$LOCAL_BACKUP" "$LOCAL_ENV"
if [ -f "$LOCAL_ENV" ]; then
  mv "$LOCAL_ENV" "$LOCAL_BACKUP"
  trap 'mv "$LOCAL_BACKUP" "$LOCAL_ENV" 2>/dev/null || true' EXIT INT TERM
fi

npm run generate:public-config

# Not exec — the trap above must survive to restore .env.local.
npx next dev
