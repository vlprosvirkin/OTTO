#!/usr/bin/env bash
# Usage: v2_vote.sh <governor_address> <proposal_id> <support>
# support: 0=Against, 1=For, 2=Abstain
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

GOV="${1:?governor_address required}"
PROPOSAL_ID="${2:?proposal_id required}"
SUPPORT="${3:?support required (0=Against, 1=For, 2=Abstain)}"

$TSX "$ROOT/scripts/invoke.ts" v2_vote "{\"governor_address\":\"$GOV\",\"proposal_id\":\"$PROPOSAL_ID\",\"support\":$SUPPORT}"
