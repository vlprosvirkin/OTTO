#!/usr/bin/env bash
# Usage: vault_payroll.sh <recipients_json> [chain] [vault_address] [eth_address]
#   recipients_json: JSON array, e.g. '[{"address":"0x...","amount_usdc":5}]'
#   chain: arcTestnet (default) | baseSepolia | avalancheFuji
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

RECIPIENTS="${1:?Usage: vault_payroll.sh '<recipients_json>' [chain] [vault_address] [eth_address]}"
CHAIN="${2:-arcTestnet}"
VAULT_ADDR="${3:-}"
ETH_ADDR="${4:-}"

ARGS="{\"recipients\":$RECIPIENTS,\"chain\":\"$CHAIN\""
[[ -n "$VAULT_ADDR" ]] && ARGS="$ARGS,\"vault_address\":\"$VAULT_ADDR\""
[[ -n "$ETH_ADDR" ]] && ARGS="$ARGS,\"eth_address\":\"$ETH_ADDR\""
ARGS="$ARGS}"

$TSX "$ROOT/scripts/invoke.ts" vault_payroll "$ARGS"
