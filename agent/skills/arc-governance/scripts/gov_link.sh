#!/usr/bin/env bash
# Usage: gov_link.sh <user_id> <eth_address> [display_name]
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

USER_ID="${1:?user_id required}"
ETH_ADDR="${2:?eth_address required}"
NAME="${3:-}"

ARGS="{\"user_id\":\"$USER_ID\",\"eth_address\":\"$ETH_ADDR\""
[[ -n "$NAME" ]] && ARGS="$ARGS,\"display_name\":\"$NAME\""
ARGS="$ARGS}"

$TSX "$ROOT/scripts/invoke.ts" gov_link "$ARGS"
