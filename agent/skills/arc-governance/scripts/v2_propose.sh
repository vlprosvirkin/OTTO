#!/usr/bin/env bash
# Usage: v2_propose.sh <vault_address> <governor_address> <action> <description> [new_ceo]
# action: setCeo | dissolve
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

VAULT="${1:?vault_address required}"
GOV="${2:?governor_address required}"
ACTION="${3:?action required (setCeo|dissolve)}"
DESC="${4:?description required}"
NEW_CEO="${5:-}"

ARGS="{\"vault_address\":\"$VAULT\",\"governor_address\":\"$GOV\",\"action\":\"$ACTION\",\"description\":\"$DESC\""
[[ -n "$NEW_CEO" ]] && ARGS="$ARGS,\"new_ceo\":\"$NEW_CEO\""
ARGS="$ARGS}"

$TSX "$ROOT/scripts/invoke.ts" v2_propose "$ARGS"
