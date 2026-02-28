#!/usr/bin/env bash
# Deploy a personal OTTOVault for a Telegram user on testnet.
# Usage: user_vault_deploy.sh <user_id> [chain] [max_per_tx_usdc] [daily_limit_usdc]
#   chain: arcTestnet (default) | baseSepolia | avalancheFuji
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../mcp/node_modules/.bin/tsx")"

USER_ID="${1:?Usage: user_vault_deploy.sh <user_id> [chain] [max_per_tx_usdc] [daily_limit_usdc]}"
CHAIN="${2:-arcTestnet}"
MAX_TX="${3:-10}"
DAILY="${4:-100}"

ARGS="{\"user_id\":\"$USER_ID\",\"chain\":\"$CHAIN\",\"max_per_tx_usdc\":$MAX_TX,\"daily_limit_usdc\":$DAILY}"

$TSX "$ROOT/scripts/invoke.ts" deploy_user_vault "$ARGS"
