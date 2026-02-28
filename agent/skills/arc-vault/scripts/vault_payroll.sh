#!/usr/bin/env bash
# Usage: vault_payroll.sh <recipients_json> [chain] [vault_address]
#   recipients_json: JSON array, e.g. '[{"address":"0x...","amount_usdc":5}]'
#   chain: arcTestnet (default) | baseSepolia | avalancheFuji
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

RECIPIENTS="${1:?Usage: vault_payroll.sh '<recipients_json>' [chain] [vault_address]}"
CHAIN="${2:-arcTestnet}"
VAULT_ADDR="${3:-}"

if [[ -n "$VAULT_ADDR" ]]; then
  ARGS="{\"recipients\":$RECIPIENTS,\"chain\":\"$CHAIN\",\"vault_address\":\"$VAULT_ADDR\"}"
else
  ARGS="{\"recipients\":$RECIPIENTS,\"chain\":\"$CHAIN\"}"
fi

$TSX "$ROOT/scripts/invoke.ts" vault_payroll "$ARGS"
