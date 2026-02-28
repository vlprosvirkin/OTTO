#!/usr/bin/env bash
# Encode calldata for an admin-only vault operation.
# Returns calldata + ottoarc.xyz/sign URL for the user to sign with their wallet.
# OTTO cannot execute admin operations — they require the user's private key.
#
# Usage: encode_admin_tx.sh <function> [options]
#
# Functions and their options:
#   setLimits           --max-per-tx <usdc> --daily <usdc>
#   setWhitelist        --address <0x...> --allowed <true|false>
#   setWhitelistEnabled --enabled <true|false>
#   setAgent            --new-address <0x...>
#   transferAdmin       --new-address <0x...>
#   setPaused           --paused <true|false>
#   withdraw            --amount <usdc>
#
# Optional: --chain <arcTestnet|baseSepolia|avalancheFuji>
#           --vault <0x...>
#
# Examples:
#   encode_admin_tx.sh setLimits --max-per-tx 50 --daily 500
#   encode_admin_tx.sh setPaused --paused true
#   encode_admin_tx.sh setWhitelist --address 0xAbc... --allowed true
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

FN="${1:?Usage: encode_admin_tx.sh <function> [options]}"
shift

# Parse named args
MAX_PER_TX="" DAILY="" ADDRESS="" ALLOWED="" ENABLED="" NEW_ADDRESS="" PAUSED="" AMOUNT=""
CHAIN="arcTestnet" VAULT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-per-tx)  MAX_PER_TX="$2"; shift 2 ;;
    --daily)       DAILY="$2";      shift 2 ;;
    --address)     ADDRESS="$2";    shift 2 ;;
    --allowed)     ALLOWED="$2";    shift 2 ;;
    --enabled)     ENABLED="$2";    shift 2 ;;
    --new-address) NEW_ADDRESS="$2"; shift 2 ;;
    --paused)      PAUSED="$2";     shift 2 ;;
    --amount)      AMOUNT="$2";     shift 2 ;;
    --chain)       CHAIN="$2";      shift 2 ;;
    --vault)       VAULT="$2";      shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Build JSON args
ARGS="{\"function\":\"$FN\",\"chain\":\"$CHAIN\""
[[ -n "$VAULT" ]]       && ARGS="${ARGS},\"vault_address\":\"$VAULT\""
[[ -n "$MAX_PER_TX" ]]  && ARGS="${ARGS},\"max_per_tx_usdc\":$MAX_PER_TX"
[[ -n "$DAILY" ]]       && ARGS="${ARGS},\"daily_limit_usdc\":$DAILY"
[[ -n "$ADDRESS" ]]     && ARGS="${ARGS},\"address\":\"$ADDRESS\""
[[ -n "$ALLOWED" ]]     && ARGS="${ARGS},\"allowed\":$ALLOWED"
[[ -n "$ENABLED" ]]     && ARGS="${ARGS},\"enabled\":$ENABLED"
[[ -n "$NEW_ADDRESS" ]] && ARGS="${ARGS},\"new_address\":\"$NEW_ADDRESS\""
[[ -n "$PAUSED" ]]      && ARGS="${ARGS},\"paused\":$PAUSED"
[[ -n "$AMOUNT" ]]      && ARGS="${ARGS},\"amount_usdc\":$AMOUNT"
ARGS="${ARGS}}"

$TSX "$ROOT/scripts/invoke.ts" encode_admin_tx "$ARGS"
