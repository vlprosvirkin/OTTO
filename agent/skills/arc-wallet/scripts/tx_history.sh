#!/usr/bin/env bash
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"
USER_ID="${1:?Usage: tx_history.sh <user_id> [limit] [type]}"
LIMIT="${2:-20}"
TX_TYPE="${3:-}"
ARGS="{\"user_id\":\"$USER_ID\",\"limit\":$LIMIT"
[[ -n "$TX_TYPE" ]] && ARGS="$ARGS,\"tx_type\":\"$TX_TYPE\""
ARGS="$ARGS}"
$TSX "$ROOT/scripts/invoke.ts" get_transaction_history "$ARGS"
