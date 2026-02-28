#!/usr/bin/env bash
# usyc_rate.sh — Fetch current USYC exchange rate from Hashnote.
#
# Usage:
#   bash usyc_rate.sh

set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

$TSX "$ROOT/scripts/invoke.ts" usyc_rate '{}'
