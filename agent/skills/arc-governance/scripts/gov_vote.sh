#!/usr/bin/env bash
# Usage: gov_vote.sh <user_id> <proposal_id> <support>
# support: 0=Against, 1=For, 2=Abstain
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

USER_ID="${1:?user_id required}"
PROP_ID="${2:?proposal_id required}"
SUPPORT="${3:?support required (0=Against, 1=For, 2=Abstain)}"

$TSX "$ROOT/scripts/invoke.ts" gov_vote "{\"user_id\":\"$USER_ID\",\"proposal_id\":\"$PROP_ID\",\"support\":$SUPPORT}"
