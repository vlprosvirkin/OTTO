#!/usr/bin/env bash
# Look up a user's vault address(es).
# Usage: user_vault_get.sh <user_id> [chain]
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

USER_ID="${1:?Usage: user_vault_get.sh <user_id> [chain]}"
CHAIN="${2:-}"

if [[ -n "$CHAIN" ]]; then
  ARGS="{\"user_id\":\"$USER_ID\",\"chain\":\"$CHAIN\"}"
else
  ARGS="{\"user_id\":\"$USER_ID\"}"
fi

$TSX "$ROOT/scripts/invoke.ts" get_user_vault "$ARGS"
