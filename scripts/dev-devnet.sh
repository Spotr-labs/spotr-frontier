#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

set -a
# shellcheck source=../.env.devnet
source "$ROOT/.env.devnet"
set +a

npm run generate:public-config

exec npx next dev
