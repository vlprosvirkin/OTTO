#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  OTTO V2 Full Integration Test (non-interactive)                        ║
# ║                                                                         ║
# ║  Deploys a fresh DAC and runs through every MCP tool:                   ║
# ║  deploy → status → shareholders → deposit → transfer → revenue →       ║
# ║  claim → set_limits → propose → vote → execute → finalize              ║
# ║                                                                         ║
# ║  Uses early execution: execute immediately after quorum is met.         ║
# ╚══════════════════════════════════════════════════════════════════════════╝
#
# Usage:
#   chmod +x demo/integration-test.sh
#   cd OTTO && ./demo/integration-test.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
source "$ROOT/agent/.env"
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/mcp/node_modules/.bin/tsx")"
INVOKE="$ROOT/agent/scripts/invoke.ts"
FORGE="${HOME}/.foundry/bin/forge"
CAST="${HOME}/.foundry/bin/cast"
RPC="https://rpc.testnet.arc.network"

AGENT_ADDR="0xA9A48d73f67b0c820fDE57c8B0639c6f850Ae96e"
SH2="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
PAYEE="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
SALT="otto-test-$(date +%s)"

PASS=0
FAIL=0
TOTAL=0

# ─── Helpers ─────────────────────────────────────────────────────────────────

invoke() {
  $TSX "$INVOKE" "$@" 2>&1
}

step() {
  TOTAL=$((TOTAL + 1))
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  [$TOTAL] $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

check() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    echo "  OK  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  OTTO V2 Integration Test                                          ║"
echo "║  Agent: $AGENT_ADDR"
echo "║  Salt:  $SALT"
echo "╚══════════════════════════════════════════════════════════════════════╝"

# ─── 1. Deploy ──────────────────────────────────────────────────────────────

step "Deploy V2 DAC (60/40 split)"

DEPLOY_OUTPUT=$(\
  cd "$ROOT/contracts" && \
  AGENT_ADDRESS="$AGENT_ADDR" \
  SHAREHOLDERS="$AGENT_ADDR,$SH2" \
  SHARES_BPS="6000,4000" \
  SALT="$SALT" \
  MAX_PER_TX_USDC=1 \
  DAILY_LIMIT_USDC=10 \
  REGISTRY_ADDRESS="${REGISTRY_ADDRESS:-}" \
  $FORGE script script/DeployV2.s.sol \
    --rpc-url "$RPC" \
    --private-key "$X402_PAYER_PRIVATE_KEY" \
    --broadcast 2>&1 \
)

VAULT=$(echo "$DEPLOY_OUTPUT" | grep "Vault:" | head -1 | awk '{print $NF}')
GOV=$(echo "$DEPLOY_OUTPUT" | grep "Governor:" | head -1 | awk '{print $NF}')
TOKEN=$(echo "$DEPLOY_OUTPUT" | grep "Share Token:" | head -1 | awk '{print $NF}')
REG=$(echo "$DEPLOY_OUTPUT" | grep "Registry:" | head -1 | awk '{print $NF}')

echo "  Vault:    $VAULT"
echo "  Governor: $GOV"
echo "  Token:    $TOKEN"
echo "  Registry: $REG"

check "Deploy succeeded" "$DEPLOY_OUTPUT" "ONCHAIN EXECUTION COMPLETE"
check "Vault address" "$VAULT" "0x"
check "Governor address" "$GOV" "0x"

# Save deployed addresses to JSON
DEPLOY_DIR="$ROOT/contracts/deployments"
mkdir -p "$DEPLOY_DIR"
cat > "$DEPLOY_DIR/arc-testnet.json" <<DEPLOYEOF
{
  "chainId": 5042002,
  "chainName": "Arc Testnet",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "salt": "$SALT",
  "contracts": {
    "registry": "$REG",
    "vault": "$VAULT",
    "shareToken": "$TOKEN",
    "governor": "$GOV"
  },
  "agent": "$AGENT_ADDR",
  "rpc": "$RPC"
}
DEPLOYEOF
echo "  Saved to $DEPLOY_DIR/arc-testnet.json"

# ─── 2. Status ──────────────────────────────────────────────────────────────

step "Check vault status"
STATUS=$(invoke v2_status "{\"vault_address\":\"$VAULT\"}")
echo "$STATUS"
check "State is Active" "$STATUS" "Active"
check "Balance is 0" "$STATUS" "0.000000 USDC"

# ─── 3. Shareholders ────────────────────────────────────────────────────────

step "Check shareholders"
SH=$(invoke v2_shareholders "{\"vault_address\":\"$VAULT\",\"shareholders\":[\"$AGENT_ADDR\",\"$SH2\"]}")
echo "$SH"
check "Agent has 60%" "$SH" '"percentage": "60.00"'
check "SH2 has 40%" "$SH" '"percentage": "40.00"'

# ─── 4. Deposit ─────────────────────────────────────────────────────────────

step "Deposit 0.5 USDC"
DEP=$(invoke v2_deposit "{\"vault_address\":\"$VAULT\",\"amount_usdc\":0.5}")
echo "$DEP"
check "Deposit succeeded" "$DEP" '"success": true'

# ─── 5. Agent Transfer ──────────────────────────────────────────────────────

step "Agent transfer 0.05 USDC"
TR=$(invoke v2_transfer "{\"vault_address\":\"$VAULT\",\"to\":\"$PAYEE\",\"amount_usdc\":0.05}")
echo "$TR"
check "Transfer succeeded" "$TR" '"success": true'

# ─── 6. Distribute Revenue ──────────────────────────────────────────────────

step "Distribute 0.1 USDC revenue"
REV=$(invoke v2_distribute_revenue "{\"vault_address\":\"$VAULT\",\"amount_usdc\":0.1}")
echo "$REV"
check "Revenue distributed" "$REV" '"success": true'

# ─── 7. Verify Revenue Auto-Transferred ────────────────────────────────────

step "Check shareholder balances after distribution"
SH2_REV=$(invoke v2_shareholders "{\"vault_address\":\"$VAULT\",\"shareholders\":[\"$AGENT_ADDR\",\"$SH2\"]}")
echo "$SH2_REV"

# ─── 8. CEO Set Limits ──────────────────────────────────────────────────────

step "CEO update limits (5 USDC/tx, 50 USDC/day)"
LIM=$(invoke v2_set_limits "{\"vault_address\":\"$VAULT\",\"max_per_tx_usdc\":5,\"daily_limit_usdc\":50}")
echo "$LIM"
check "Limits updated" "$LIM" '"success": true'

# ─── 10. Propose Dissolution ─────────────────────────────────────────────────

step "Propose dissolution"
PROP=$(invoke v2_propose "{\"vault_address\":\"$VAULT\",\"governor_address\":\"$GOV\",\"action\":\"dissolve\",\"description\":\"Integration test dissolution\"}")
echo "$PROP"
check "Proposal created" "$PROP" '"success": true'

# Extract proposal ID from tx receipt
TX_HASH=$(echo "$PROP" | grep txHash | head -1 | sed 's/.*"txHash": "//;s/".*//')
LOG_DATA=$($CAST receipt "$TX_HASH" --rpc-url "$RPC" 2>&1 | grep '"data"' | head -1 | sed 's/.*"data":"//;s/".*//')
PID_HEX=$(echo "$LOG_DATA" | cut -c3-66)
PID=$($CAST to-dec "0x$PID_HEX" 2>&1)
echo "  Proposal ID: $PID"

# ─── 11. Vote ────────────────────────────────────────────────────────────────

step "Vote FOR dissolution (wait 3s for voting delay)"
sleep 3
VOTE=$(invoke v2_vote "{\"governor_address\":\"$GOV\",\"proposal_id\":\"$PID\",\"support\":1}")
echo "$VOTE"
check "Vote cast" "$VOTE" '"success": true'
check "Vote is For" "$VOTE" '"vote": "For"'

# ─── 12. Early Execute ───────────────────────────────────────────────────────

step "Execute dissolution (early execution — no waiting)"
EXEC=$(invoke v2_execute "{\"vault_address\":\"$VAULT\",\"governor_address\":\"$GOV\",\"action\":\"dissolve\",\"description\":\"Integration test dissolution\"}")
echo "$EXEC"
check "Execute succeeded" "$EXEC" '"success": true'

# Verify state is Dissolving
ST2=$(invoke v2_status "{\"vault_address\":\"$VAULT\"}")
check "State is Dissolving" "$ST2" "Dissolving"
check "Vault is paused" "$ST2" "Paused**: YES"

# ─── 13. Finalize (auto-distribute) ─────────────────────────────────────────

step "Finalize + auto-distribute"
FIN=$(invoke v2_finalize "{\"vault_address\":\"$VAULT\"}")
echo "$FIN"
check "Finalize succeeded" "$FIN" '"success": true'

# ─── 14. Verify Dissolution ─────────────────────────────────────────────────

step "Verify dissolution"
DS=$(invoke v2_dissolve_status "{\"vault_address\":\"$VAULT\",\"shareholders\":[\"$AGENT_ADDR\",\"$SH2\"]}")
echo "$DS"
check "State is Dissolved" "$DS" '"state": "Dissolved"'
check "Token frozen" "$DS" '"token_frozen": true'

FINAL=$(invoke v2_status "{\"vault_address\":\"$VAULT\"}")
check "Vault balance is 0" "$FINAL" "0.000000 USDC"

# ═══════════════════════════════════════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  Integration Test Complete                                          ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║  Passed: $PASS / $((PASS + FAIL))"
if [[ $FAIL -gt 0 ]]; then
echo "║  FAILED: $FAIL"
fi
echo "║                                                                      ║"
echo "║  Vault:    $VAULT"
echo "║  Governor: $GOV"
echo "║  Token:    $TOKEN"
echo "╚══════════════════════════════════════════════════════════════════════╝"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
