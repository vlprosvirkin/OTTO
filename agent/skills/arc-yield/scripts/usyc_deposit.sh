#!/usr/bin/env bash
# usyc_deposit.sh — Invest USDC into USYC (tokenized T-bills).
#
# Usage:
#   bash usyc_deposit.sh <amount_usdc>
#   bash usyc_deposit.sh <amount_usdc> <chain>
#
# Example:
#   bash usyc_deposit.sh 100              # Invest 100 USDC on arcTestnet
#   bash usyc_deposit.sh 50 arcTestnet

set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

AMOUNT="${1:?Usage: usyc_deposit.sh <amount_usdc> [chain]}"
CHAIN="${2:-arcTestnet}"

ARGS=$(printf '{"amount_usdc":%s,"chain":%s}' \
  "$AMOUNT" \
  "$(printf '%s' "$CHAIN" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")

$TSX "$ROOT/scripts/invoke.ts" usyc_deposit "$ARGS"
