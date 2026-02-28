#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fund-wallet.sh — Send gas + USDC to a target wallet on all testnets
#
# Usage:
#   ./scripts/fund-wallet.sh <TARGET_ADDRESS> [ETH_AMOUNT] [USDC_AMOUNT]
#
# Defaults: 0.5 ETH/AVAX, 10 USDC
#
# Requires:
#   - foundry (cast) in PATH or ~/.foundry/bin/
#   - OTTO/agent/.env with X402_PAYER_PRIVATE_KEY and GAS_WALLET_PRIVATE_KEY
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Args ─────────────────────────────────────────────────────────────────────
TARGET="${1:?Usage: fund-wallet.sh <TARGET_ADDRESS> [ETH_AMOUNT] [USDC_AMOUNT]}"
GAS_AMOUNT="${2:-0.5}"
USDC_AMOUNT="${3:-10}"

USDC_ATOMIC=$(echo "$USDC_AMOUNT * 1000000" | bc | cut -d. -f1)

# ── Load env ─────────────────────────────────────────────────────────────────
ENV_FILE="$REPO_DIR/agent/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a && source "$ENV_FILE" && set +a
fi

X402_KEY="${X402_PAYER_PRIVATE_KEY:?Set X402_PAYER_PRIVATE_KEY in agent/.env}"
GAS_KEY="${GAS_WALLET_PRIVATE_KEY:?Set GAS_WALLET_PRIVATE_KEY in agent/.env}"

# ── Foundry ──────────────────────────────────────────────────────────────────
export PATH="$HOME/.foundry/bin:$PATH"
command -v cast >/dev/null 2>&1 || { echo "cast not found — install foundry"; exit 1; }

# ── Chain config ─────────────────────────────────────────────────────────────
# RPC endpoints (Blockdaemon for Arc to avoid QuickNode rate limits)
ARC_RPC="https://rpc.blockdaemon.testnet.arc.network"
BASE_RPC="https://sepolia.base.org"
FUJI_RPC="https://api.avax-test.network/ext/bc/C/rpc"

# USDC addresses per chain
ARC_USDC="0x3600000000000000000000000000000000000000"
BASE_USDC="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
FUJI_USDC="0x5425890298aed601595a70ab815c96711a31bc65"

# ── Helpers ──────────────────────────────────────────────────────────────────
send_gas() {
  local chain_name=$1 rpc=$2 key=$3 amount=$4
  echo -n "  $chain_name: sending ${amount} gas... "
  local tx
  tx=$(cast send "$TARGET" --value "${amount}ether" --rpc-url "$rpc" --private-key "$key" --json 2>&1) || {
    echo "FAILED"
    echo "    $tx"
    return 1
  }
  local hash=$(echo "$tx" | python3 -c "import sys,json; print(json.load(sys.stdin)['transactionHash'])" 2>/dev/null || echo "?")
  echo "OK (tx: ${hash:0:18}...)"
}

send_usdc() {
  local chain_name=$1 rpc=$2 usdc_addr=$3 key=$4 amount=$5
  echo -n "  $chain_name: sending ${USDC_AMOUNT} USDC... "

  # Check sender balance first
  local bal
  bal=$(cast call "$usdc_addr" "balanceOf(address)(uint256)" \
    "$(cast wallet address "$key")" --rpc-url "$rpc" 2>/dev/null || echo "0")
  bal=$(echo "$bal" | head -1 | tr -d ' []a-zA-Z')

  if [[ "$bal" -lt "$amount" ]]; then
    echo "SKIP (sender has ${bal} atomic, need ${amount})"
    return 0
  fi

  local tx
  tx=$(cast send "$usdc_addr" "transfer(address,uint256)" "$TARGET" "$amount" \
    --rpc-url "$rpc" --private-key "$key" --json 2>&1) || {
    echo "FAILED"
    echo "    $tx"
    return 1
  }
  local hash=$(echo "$tx" | python3 -c "import sys,json; print(json.load(sys.stdin)['transactionHash'])" 2>/dev/null || echo "?")
  echo "OK (tx: ${hash:0:18}...)"
}

check_balance() {
  local chain_name=$1 rpc=$2 usdc_addr=$3 currency=$4
  local eth_bal usdc_bal
  eth_bal=$(cast balance "$TARGET" --rpc-url "$rpc" --ether 2>/dev/null || echo "error")
  usdc_bal=$(cast call "$usdc_addr" "balanceOf(address)(uint256)" "$TARGET" --rpc-url "$rpc" 2>/dev/null || echo "0")
  usdc_bal=$(echo "$usdc_bal" | head -1 | tr -d ' []a-zA-Z')
  local usdc_human=$(echo "scale=2; ${usdc_bal:-0} / 1000000" | bc 2>/dev/null || echo "?")
  printf "  %-16s %s %s  |  %s USDC\n" "$chain_name:" "$eth_bal" "$currency" "$usdc_human"
}

# ── Main ─────────────────────────────────────────────────────────────────────
echo "================================================="
echo "  Fund wallet: $TARGET"
echo "  Gas: ${GAS_AMOUNT} ETH/AVAX  |  USDC: ${USDC_AMOUNT}"
echo "================================================="
echo ""

# Determine which key to use for gas on each chain
# Gas wallet has ETH on Base and AVAX on Fuji; X402 has ETH on Arc
echo "→ Sending gas..."
send_gas "Arc Testnet"     "$ARC_RPC"  "$X402_KEY" "$GAS_AMOUNT" || true
send_gas "Base Sepolia"    "$BASE_RPC" "$GAS_KEY"  "$GAS_AMOUNT" || true
send_gas "Avalanche Fuji"  "$FUJI_RPC" "$GAS_KEY"  "$GAS_AMOUNT" || true
echo ""

echo "→ Sending USDC..."
send_usdc "Arc Testnet"    "$ARC_RPC"  "$ARC_USDC"  "$X402_KEY" "$USDC_ATOMIC" || true
send_usdc "Base Sepolia"   "$BASE_RPC" "$BASE_USDC" "$X402_KEY" "$USDC_ATOMIC" || true
send_usdc "Avalanche Fuji" "$FUJI_RPC" "$FUJI_USDC" "$X402_KEY" "$USDC_ATOMIC" || true
echo ""

echo "→ Final balances:"
check_balance "Arc Testnet"    "$ARC_RPC"  "$ARC_USDC"  "ETH"
check_balance "Base Sepolia"   "$BASE_RPC" "$BASE_USDC" "ETH"
check_balance "Avalanche Fuji" "$FUJI_RPC" "$FUJI_USDC" "AVAX"
echo ""
echo "Done."
