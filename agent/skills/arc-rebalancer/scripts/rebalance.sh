#!/usr/bin/env bash
# Usage: rebalance.sh [min_usdc]
#   min_usdc: minimum acceptable vault balance per chain (default: 5)
#
# Checks OTTOVault on arcTestnet, baseSepolia, avalancheFuji.
# Returns JSON report: healthy/low/empty vaults + recommendations.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

MIN="${1:-5}"
ETH_ADDR="${2:-}"

ARGS="{\"min_usdc\":$MIN"
[[ -n "$ETH_ADDR" ]] && ARGS="$ARGS,\"eth_address\":\"$ETH_ADDR\""
ARGS="$ARGS}"

$TSX "$ROOT/scripts/invoke.ts" rebalance_check "$ARGS"
