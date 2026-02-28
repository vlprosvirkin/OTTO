#!/usr/bin/env bash
# Usage: vault_status.sh [chain] [vault_address]
#   chain: arcTestnet (default) | baseSepolia | avalancheFuji
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

CHAIN="${1:-arcTestnet}"
VAULT_ADDR="${2:-}"

if [[ -n "$VAULT_ADDR" ]]; then
  ARGS="{\"chain\":\"$CHAIN\",\"vault_address\":\"$VAULT_ADDR\"}"
else
  ARGS="{\"chain\":\"$CHAIN\"}"
fi

$TSX "$ROOT/scripts/invoke.ts" vault_status "$ARGS"
