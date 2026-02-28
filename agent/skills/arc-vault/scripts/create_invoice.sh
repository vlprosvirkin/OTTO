#!/usr/bin/env bash
# Create a payment invoice for incoming USDC to a vault.
# Usage: create_invoice.sh <amount_usdc> [user_id] [chain] [expected_sender]
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

AMOUNT="${1:?Usage: create_invoice.sh <amount_usdc> [user_id] [chain] [expected_sender]}"
USER_ID="${2:-}"
CHAIN="${3:-arcTestnet}"
SENDER="${4:-}"

ARGS="{\"expected_amount_usdc\":$AMOUNT"
[[ -n "$USER_ID" ]] && ARGS="${ARGS},\"user_id\":\"$USER_ID\""
ARGS="${ARGS},\"chain\":\"$CHAIN\""
[[ -n "$SENDER" ]] && ARGS="${ARGS},\"expected_sender\":\"$SENDER\""
ARGS="${ARGS}}"

$TSX "$ROOT/scripts/invoke.ts" create_invoice "$ARGS"
