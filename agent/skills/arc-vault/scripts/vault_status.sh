#!/usr/bin/env bash
# Usage: vault_status.sh [chain] [vault_address] [eth_address]
#   chain: arcTestnet (default) | baseSepolia | avalancheFuji
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

CHAIN="${1:-arcTestnet}"
VAULT_ADDR="${2:-}"
ETH_ADDR="${3:-}"

ARGS="{\"chain\":\"$CHAIN\""
[[ -n "$VAULT_ADDR" ]] && ARGS="$ARGS,\"vault_address\":\"$VAULT_ADDR\""
[[ -n "$ETH_ADDR" ]] && ARGS="$ARGS,\"eth_address\":\"$ETH_ADDR\""
ARGS="$ARGS}"

$TSX "$ROOT/scripts/invoke.ts" vault_status "$ARGS"
