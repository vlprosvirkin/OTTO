#!/usr/bin/env bash
# Usage: vault_deposit.sh <amount_usdc> [chain] [vault_address] [eth_address]
#   chain: arcTestnet (default) | baseSepolia | avalancheFuji
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

AMOUNT="${1:?Usage: vault_deposit.sh <amount_usdc> [chain] [vault_address] [eth_address]}"
CHAIN="${2:-arcTestnet}"
VAULT="${3:-}"
ETH_ADDR="${4:-}"

ARGS="{\"amount_usdc\":$AMOUNT,\"chain\":\"$CHAIN\""
[[ -n "$VAULT" ]] && ARGS="$ARGS,\"vault_address\":\"$VAULT\""
[[ -n "$ETH_ADDR" ]] && ARGS="$ARGS,\"eth_address\":\"$ETH_ADDR\""
ARGS="$ARGS}"

$TSX "$ROOT/scripts/invoke.ts" vault_deposit "$ARGS"
