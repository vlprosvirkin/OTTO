#!/usr/bin/env bash
# stork_price.sh — Fetch latest price from Stork Oracle REST API.
#
# Usage:
#   bash stork_price.sh            # defaults to ETHUSD
#   bash stork_price.sh BTCUSD
#   bash stork_price.sh "ETHUSD,BTCUSD"

set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

ASSETS="${1:-ETHUSD}"

ARGS=$(printf '{"assets":%s}' \
  "$(printf '%s' "$ASSETS" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")

$TSX "$ROOT/scripts/invoke.ts" stork_price_feed "$ARGS"
