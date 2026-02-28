#!/usr/bin/env bash
# Usage: vault_can_transfer.sh <to_address> <amount_usdc> [vault_address]
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../arc-wallet-mcp/node_modules/.bin/tsx")"

TO="${1:?Usage: vault_can_transfer.sh <to_address> <amount_usdc> [vault_address]}"
AMOUNT="${2:?Missing amount_usdc}"
VAULT="${3:-${VAULT_ADDRESS:-}}"

if [[ -n "$VAULT" ]]; then
  ARGS="{\"to\":\"$TO\",\"amount_usdc\":$AMOUNT,\"vault_address\":\"$VAULT\"}"
else
  ARGS="{\"to\":\"$TO\",\"amount_usdc\":$AMOUNT}"
fi

$TSX "$ROOT/scripts/invoke.ts" vault_can_transfer "$ARGS"
