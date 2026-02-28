#!/usr/bin/env bash
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"
WALLET_ID="${1:?Usage: transfer_custodial.sh <wallet_id> <src_chain> <dst_chain> <amount_usdc> [recipient] [user_id]}"
SRC="${2:?}"
DST="${3:?}"
AMOUNT="${4:?}"
RECIPIENT="${5:-}"
USER_ID="${6:-}"
ARGS="{\"wallet_id\":\"$WALLET_ID\",\"source_chain\":\"$SRC\",\"destination_chain\":\"$DST\",\"amount_usdc\":$AMOUNT"
[[ -n "$RECIPIENT" ]] && ARGS="$ARGS,\"recipient_address\":\"$RECIPIENT\""
[[ -n "$USER_ID" ]] && ARGS="$ARGS,\"user_id\":\"$USER_ID\""
ARGS="$ARGS}"
$TSX "$ROOT/scripts/invoke.ts" transfer_usdc_custodial "$ARGS"
