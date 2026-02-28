#!/usr/bin/env bash
# Check the status of a payment invoice (pending / paid / expired).
# Usage: check_invoice_status.sh <invoice_id>
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

INVOICE_ID="${1:?Usage: check_invoice_status.sh <invoice_id>}"

ARGS="{\"invoice_id\":\"$INVOICE_ID\"}"

$TSX "$ROOT/scripts/invoke.ts" check_invoice_status "$ARGS"
