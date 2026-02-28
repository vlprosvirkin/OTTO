#!/usr/bin/env bash
# Usage: vault_deposit.sh <amount_usdc> [chain] [vault_address]
#   chain: arcTestnet (default) | baseSepolia | avalancheFuji
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

AMOUNT="${1:?Usage: vault_deposit.sh <amount_usdc> [chain] [vault_address]}"
CHAIN="${2:-arcTestnet}"
VAULT="${3:-}"

if [[ -n "$VAULT" ]]; then
  ARGS="{\"amount_usdc\":$AMOUNT,\"chain\":\"$CHAIN\",\"vault_address\":\"$VAULT\"}"
else
  ARGS="{\"amount_usdc\":$AMOUNT,\"chain\":\"$CHAIN\"}"
fi

$TSX "$ROOT/scripts/invoke.ts" vault_deposit "$ARGS"
