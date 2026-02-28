#!/usr/bin/env bash
# Check all pending invoices and report status changes.
# Reads ~/.otto/invoices.json, calls check_invoice_status per pending invoice.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

INVOICES_FILE="$HOME/.otto/invoices.json"

if [[ ! -f "$INVOICES_FILE" ]]; then
  echo '{"pending":0,"message":"No invoices file found"}'
  exit 0
fi

# Extract pending invoice IDs
PENDING_IDS=$(python3 -c "
import json, sys
data = json.load(open('$INVOICES_FILE'))
ids = [k for k, v in data.items() if v.get('status') == 'pending']
print('\n'.join(ids))
" 2>/dev/null || true)

if [[ -z "$PENDING_IDS" ]]; then
  echo '{"pending":0,"message":"No pending invoices"}'
  exit 0
fi

echo "{"
echo "  \"pending_invoices\": ["
FIRST=true
while IFS= read -r id; do
  [[ -z "$id" ]] && continue
  if [[ "$FIRST" != true ]]; then echo ","; fi
  FIRST=false
  $TSX "$ROOT/scripts/invoke.ts" check_invoice_status "{\"invoice_id\":\"$id\"}"
done <<< "$PENDING_IDS"
echo "  ]"
echo "}"
