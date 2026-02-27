#!/usr/bin/env bash
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../arc-wallet-mcp/node_modules/.bin/tsx")"
$TSX "$ROOT/scripts/invoke.ts" init_eoa_wallet "{\"user_id\":\"$1\"}"
