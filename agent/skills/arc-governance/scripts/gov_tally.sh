#!/usr/bin/env bash
# Usage: gov_tally.sh [proposal_id]
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

PROP_ID="${1:-}"

if [[ -n "$PROP_ID" ]]; then
  $TSX "$ROOT/scripts/invoke.ts" gov_tally "{\"proposal_id\":\"$PROP_ID\"}"
else
  $TSX "$ROOT/scripts/invoke.ts" gov_tally "{}"
fi
