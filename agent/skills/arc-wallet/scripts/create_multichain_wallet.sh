#!/usr/bin/env bash
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"
WALLET_SET_ID="${1:?Usage: create_multichain_wallet.sh <wallet_set_id> [user_id]}"
USER_ID="${2:-}"
ARGS="{\"wallet_set_id\":\"$WALLET_SET_ID\""
[[ -n "$USER_ID" ]] && ARGS="$ARGS,\"user_id\":\"$USER_ID\""
ARGS="$ARGS}"
$TSX "$ROOT/scripts/invoke.ts" create_multichain_wallet "$ARGS"
