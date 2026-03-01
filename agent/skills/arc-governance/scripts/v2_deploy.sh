#!/usr/bin/env bash
# Usage: v2_deploy.sh <factory_address> <salt> <shareholders_csv> <bps_csv> [max_per_tx_usdc] [daily_limit_usdc]
# shareholders_csv: 0xAlice,0xBob   bps_csv: 6000,4000
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$HOME/OTTO/mcp/node_modules/.bin/tsx")"

FACTORY="${1:?factory_address required}"
SALT="${2:?salt required}"
SHAREHOLDERS_CSV="${3:?shareholders_csv required}"
BPS_CSV="${4:?bps_csv required}"
MAX="${5:-10}"
DAILY="${6:-100}"

# Convert CSV to JSON arrays
SH_JSON=$(echo "$SHAREHOLDERS_CSV" | tr ',' '\n' | sed 's/.*/"&"/' | paste -sd, | sed 's/^/[/;s/$/]/')
BPS_JSON=$(echo "$BPS_CSV" | tr ',' '\n' | paste -sd, | sed 's/^/[/;s/$/]/')

ARGS="{\"factory_address\":\"$FACTORY\",\"salt\":\"$SALT\",\"shareholders\":$SH_JSON,\"shares_bps\":$BPS_JSON,\"max_per_tx_usdc\":$MAX,\"daily_limit_usdc\":$DAILY}"

$TSX "$ROOT/scripts/invoke.ts" v2_deploy "$ARGS"
