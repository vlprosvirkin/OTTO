#!/usr/bin/env bash
# Usage: v2_dissolve_status.sh <vault_address> <shareholders_csv>
# shareholders_csv: 0xAlice,0xBob
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

VAULT="${1:?vault_address required}"
SHAREHOLDERS_CSV="${2:?shareholders_csv required}"

SH_JSON=$(echo "$SHAREHOLDERS_CSV" | tr ',' '\n' | sed 's/.*/"&"/' | paste -sd, | sed 's/^/[/;s/$/]/')

$TSX "$ROOT/scripts/invoke.ts" v2_dissolve_status "{\"vault_address\":\"$VAULT\",\"shareholders\":$SH_JSON}"
