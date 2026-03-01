#!/usr/bin/env bash
# Usage: gov_add_members.sh <members_json> [vault_address]
# members_json: JSON array of {user_id, eth_address, display_name?}
# Example: gov_add_members.sh '[{"user_id":"123","eth_address":"0x...","display_name":"Alice"}]' 0xVault
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

MEMBERS="${1:?members JSON array required}"
VAULT="${2:-}"

ARGS="{\"members\":$MEMBERS"
[[ -n "$VAULT" ]] && ARGS="$ARGS,\"vault_address\":\"$VAULT\""
ARGS="$ARGS}"

$TSX "$ROOT/scripts/invoke.ts" gov_add_members "$ARGS"
