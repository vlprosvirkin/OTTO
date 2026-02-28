#!/usr/bin/env bash
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../arc-wallet-mcp/node_modules/.bin/tsx")"

VAULT_ADDRESS="${1:-${VAULT_ADDRESS:-}}"
if [[ -n "$VAULT_ADDRESS" ]]; then
  ARGS="{\"vault_address\":\"$VAULT_ADDRESS\"}"
else
  ARGS="{}"
fi

$TSX "$ROOT/scripts/invoke.ts" vault_status "$ARGS"
