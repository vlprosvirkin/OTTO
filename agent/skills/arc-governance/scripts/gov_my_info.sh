#!/usr/bin/env bash
# Usage: gov_my_info.sh <user_id>
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

USER_ID="${1:?user_id required}"

$TSX "$ROOT/scripts/invoke.ts" gov_my_info "{\"user_id\":\"$USER_ID\"}"
