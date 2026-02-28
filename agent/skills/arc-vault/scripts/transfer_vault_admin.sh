#!/usr/bin/env bash
# Transfer admin ownership of a user's vault from OTTO to their registered ETH address.
# Requires: user must have registered their ETH address via user_register_address.sh first.
# Usage: transfer_vault_admin.sh <user_id> [chain] [vault_address]
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

USER_ID="${1:?Usage: transfer_vault_admin.sh <user_id> [chain] [vault_address]}"
CHAIN="${2:-}"
VAULT="${3:-}"

if [[ -n "$VAULT" ]]; then
  ARGS="{\"user_id\":\"$USER_ID\",\"chain\":\"$CHAIN\",\"vault_address\":\"$VAULT\"}"
elif [[ -n "$CHAIN" ]]; then
  ARGS="{\"user_id\":\"$USER_ID\",\"chain\":\"$CHAIN\"}"
else
  ARGS="{\"user_id\":\"$USER_ID\"}"
fi

$TSX "$ROOT/scripts/invoke.ts" transfer_vault_admin "$ARGS"
