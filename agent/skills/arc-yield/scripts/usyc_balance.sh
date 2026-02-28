#!/usr/bin/env bash
# usyc_balance.sh — Check USYC balance for an address.
#
# Usage:
#   bash usyc_balance.sh                       # agent wallet on arcTestnet
#   bash usyc_balance.sh 0xAbc...              # specific address
#   bash usyc_balance.sh 0xAbc... arcTestnet

set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

ADDRESS="${1:-}"
CHAIN="${2:-arcTestnet}"

if [[ -n "$ADDRESS" ]]; then
  ARGS=$(printf '{"address":%s,"chain":%s}' \
    "$(printf '%s' "$ADDRESS" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$CHAIN" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")
else
  ARGS=$(printf '{"chain":%s}' \
    "$(printf '%s' "$CHAIN" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")
fi

$TSX "$ROOT/scripts/invoke.ts" usyc_balance "$ARGS"
