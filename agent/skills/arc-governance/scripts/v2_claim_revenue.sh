#!/usr/bin/env bash
# Usage: v2_claim_revenue.sh <vault_address>
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

VAULT="${1:?vault_address required}"

$TSX "$ROOT/scripts/invoke.ts" v2_claim_revenue "{\"vault_address\":\"$VAULT\"}"
