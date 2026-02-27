#!/usr/bin/env bash
# x402_fetch.sh — Fetch an x402-enabled URL, auto-paying on 402 responses.
#
# Usage:
#   bash x402_fetch.sh <url>
#   bash x402_fetch.sh <url> <method>
#   bash x402_fetch.sh <url> <method> <body_json>
#
# Examples:
#   bash x402_fetch.sh "https://api.example.com/oracle/price"
#   bash x402_fetch.sh "https://api.example.com/data" "POST" '{"query":"eth_price"}'

set -euo pipefail
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SKILL_DIR/../.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/../arc-wallet-mcp/node_modules/.bin/tsx")"

URL="${1:?Usage: x402_fetch.sh <url> [method] [body_json]}"
METHOD="${2:-GET}"
BODY="${3:-}"

if [[ -n "$BODY" ]]; then
  ARGS=$(printf '{"url":%s,"method":%s,"body":%s}' \
    "$(printf '%s' "$URL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$METHOD" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$BODY" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")
else
  ARGS=$(printf '{"url":%s,"method":%s}' \
    "$(printf '%s' "$URL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$METHOD" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")
fi

$TSX "$ROOT/scripts/invoke.ts" x402_fetch "$ARGS"
