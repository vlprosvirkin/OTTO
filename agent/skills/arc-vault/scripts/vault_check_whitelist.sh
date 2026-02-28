#!/usr/bin/env bash
# Usage: vault_check_whitelist.sh <address> [chain] [vault_address]
#   address: EVM address to check (0x-prefixed)
#   chain: arcTestnet (default) | baseSepolia | avalancheFuji
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

ADDRESS="${1:?Usage: vault_check_whitelist.sh <address> [chain] [vault_address]}"
CHAIN="${2:-arcTestnet}"
VAULT_ADDR="${3:-}"

if [[ -n "$VAULT_ADDR" ]]; then
  ARGS="{\"address\":\"$ADDRESS\",\"chain\":\"$CHAIN\",\"vault_address\":\"$VAULT_ADDR\"}"
else
  ARGS="{\"address\":\"$ADDRESS\",\"chain\":\"$CHAIN\"}"
fi

$TSX "$ROOT/scripts/invoke.ts" vault_check_whitelist "$ARGS"
