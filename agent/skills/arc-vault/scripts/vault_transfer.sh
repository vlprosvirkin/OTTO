#!/usr/bin/env bash
# Usage: vault_transfer.sh <to_address> <amount_usdc> [chain] [vault_address]
#   chain: arcTestnet (default) | baseSepolia | avalancheFuji
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

TO="${1:?Usage: vault_transfer.sh <to_address> <amount_usdc> [chain] [vault_address]}"
AMOUNT="${2:?Missing amount_usdc}"
CHAIN="${3:-arcTestnet}"
VAULT="${4:-}"

if [[ -n "$VAULT" ]]; then
  ARGS="{\"to\":\"$TO\",\"amount_usdc\":$AMOUNT,\"chain\":\"$CHAIN\",\"vault_address\":\"$VAULT\"}"
else
  ARGS="{\"to\":\"$TO\",\"amount_usdc\":$AMOUNT,\"chain\":\"$CHAIN\"}"
fi

$TSX "$ROOT/scripts/invoke.ts" vault_transfer "$ARGS"
