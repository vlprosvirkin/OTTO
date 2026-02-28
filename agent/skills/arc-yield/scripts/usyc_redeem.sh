#!/usr/bin/env bash
# usyc_redeem.sh — Redeem USYC back to USDC.
#
# Usage:
#   bash usyc_redeem.sh <amount_usyc>
#   bash usyc_redeem.sh <amount_usyc> <chain>
#
# Example:
#   bash usyc_redeem.sh 100              # Redeem 100 USYC on arcTestnet
#   bash usyc_redeem.sh 50 arcTestnet

set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

AMOUNT="${1:?Usage: usyc_redeem.sh <amount_usyc> [chain]}"
CHAIN="${2:-arcTestnet}"

ARGS=$(printf '{"amount_usyc":%s,"chain":%s}' \
  "$AMOUNT" \
  "$(printf '%s' "$CHAIN" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")

$TSX "$ROOT/scripts/invoke.ts" usyc_redeem "$ARGS"
