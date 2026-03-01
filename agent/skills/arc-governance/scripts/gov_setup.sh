#!/usr/bin/env bash
# Usage: gov_setup.sh <vault_address> <governor_address> <share_token_address> [chat_id]
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

VAULT="${1:?vault_address required}"
GOV="${2:?governor_address required}"
TOKEN="${3:?share_token_address required}"
CHAT="${4:-}"

ARGS="{\"vault_address\":\"$VAULT\",\"governor_address\":\"$GOV\",\"share_token_address\":\"$TOKEN\""
[[ -n "$CHAT" ]] && ARGS="$ARGS,\"chat_id\":\"$CHAT\""
ARGS="$ARGS}"

$TSX "$ROOT/scripts/invoke.ts" gov_setup "$ARGS"
