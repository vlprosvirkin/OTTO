#!/usr/bin/env bash
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"
WALLET_ID="${1:?Usage: deposit.sh <wallet_id> <chain> <amount_usdc> [user_id]}"
CHAIN="${2:?}"
AMOUNT="${3:?}"
USER_ID="${4:-}"
ARGS="{\"wallet_id\":\"$WALLET_ID\",\"chain\":\"$CHAIN\",\"amount_usdc\":$AMOUNT"
[[ -n "$USER_ID" ]] && ARGS="$ARGS,\"user_id\":\"$USER_ID\""
ARGS="$ARGS}"
$TSX "$ROOT/scripts/invoke.ts" deposit_usdc "$ARGS"
