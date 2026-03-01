#!/usr/bin/env bash
# Usage: gov_propose.sh <user_id> <action> <description> [new_ceo]
# action: setCeo | dissolve
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

USER_ID="${1:?user_id required}"
ACTION="${2:?action required (setCeo|dissolve)}"
DESC="${3:?description required}"
NEW_CEO="${4:-}"

ARGS="{\"user_id\":\"$USER_ID\",\"action\":\"$ACTION\",\"description\":\"$DESC\""
[[ -n "$NEW_CEO" ]] && ARGS="$ARGS,\"new_ceo\":\"$NEW_CEO\""
ARGS="$ARGS}"

$TSX "$ROOT/scripts/invoke.ts" gov_propose "$ARGS"
