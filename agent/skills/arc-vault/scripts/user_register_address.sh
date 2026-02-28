#!/usr/bin/env bash
# Register a user's own ETH wallet address.
# Future vaults will be deployed with this address as admin.
# For existing custodial vaults use transfer_vault_admin.sh to hand over control.
# Usage: user_register_address.sh <user_id> <eth_address>
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

USER_ID="${1:?Usage: user_register_address.sh <user_id> <eth_address>}"
ETH_ADDRESS="${2:?Usage: user_register_address.sh <user_id> <eth_address>}"

ARGS="{\"user_id\":\"$USER_ID\",\"eth_address\":\"$ETH_ADDRESS\"}"

$TSX "$ROOT/scripts/invoke.ts" register_user_address "$ARGS"
