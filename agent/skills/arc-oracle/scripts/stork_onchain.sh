#!/usr/bin/env bash
# stork_onchain.sh — Read price from Stork on-chain aggregator.
#
# Usage:
#   bash stork_onchain.sh                     # ETHUSD on arcTestnet
#   bash stork_onchain.sh BTCUSD
#   bash stork_onchain.sh ETHUSD arcTestnet

set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

ASSET="${1:-ETHUSD}"
CHAIN="${2:-arcTestnet}"

ARGS=$(printf '{"asset":%s,"chain":%s}' \
  "$(printf '%s' "$ASSET" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
  "$(printf '%s' "$CHAIN" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")

$TSX "$ROOT/scripts/invoke.ts" stork_onchain_price "$ARGS"
