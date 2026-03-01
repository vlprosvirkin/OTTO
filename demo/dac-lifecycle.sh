#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  OTTO DAC Full Lifecycle Demo (V2 only)                                 ║
# ║  Demonstrates: deploy → deposit → transfer → revenue → governance →    ║
# ║                dissolve → finalize → claim dissolution                  ║
# ╚══════════════════════════════════════════════════════════════════════════╝
#
# Prerequisites:
#   1. V2 Factory deployed on Arc Testnet (set FACTORY_V2_ADDRESS in .env)
#   2. Agent wallet funded with USDC on Arc Testnet
#   3. .env with X402_PAYER_PRIVATE_KEY set
#
# Usage:
#   chmod +x demo/dac-lifecycle.sh
#   cd OTTO && ./demo/dac-lifecycle.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
TSX="$(command -v tsx 2>/dev/null || echo "$ROOT/mcp/node_modules/.bin/tsx")"
INVOKE="$ROOT/agent/scripts/invoke.ts"

# ─── Configuration ───────────────────────────────────────────────────────────

FACTORY="${FACTORY_V2_ADDRESS:?Set FACTORY_V2_ADDRESS in .env}"
AGENT_ADDR="${AGENT_ADDRESS:-0xA9A48d73f67b0c820fDE57c8B0639c6f850Ae96e}"

# Two shareholders: agent (60%) and a second address (40%)
SHAREHOLDER_2="${DEMO_SHAREHOLDER_2:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
SALT="otto-demo-$(date +%s)"

# Payee for transfer demo
PAYEE="${DEMO_PAYEE:-0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC}"

# ─── Helpers ─────────────────────────────────────────────────────────────────

step=0
run() {
  step=$((step + 1))
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Step $step: $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  shift
  "$@"
}

invoke() {
  $TSX "$INVOKE" "$@"
}

pause() {
  echo ""
  echo "  ⏸  Press ENTER to continue..."
  read -r
}

# ─── 1. Deploy DAC ──────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  OTTO DAC Lifecycle Demo (V2)                                       ║"
echo "║  Factory: $FACTORY"
echo "║  Agent:   $AGENT_ADDR"
echo "║  Salt:    $SALT"
echo "╚══════════════════════════════════════════════════════════════════════╝"

run "Deploy V2 DAC (60% agent, 40% shareholder_2)" \
  invoke v2_deploy "{\"factory_address\":\"$FACTORY\",\"salt\":\"$SALT\",\"shareholders\":[\"$AGENT_ADDR\",\"$SHAREHOLDER_2\"],\"shares_bps\":[6000,4000],\"max_per_tx_usdc\":50,\"daily_limit_usdc\":500}"

echo ""
echo "  → Save the vault, token, and governor addresses from the output above."
echo "  → Set them below:"
echo ""
read -rp "  Vault address:    " VAULT
read -rp "  Governor address: " GOVERNOR

pause

# ─── 2. Check Status ────────────────────────────────────────────────────────

run "Check vault status" \
  invoke v2_status "{\"vault_address\":\"$VAULT\"}"

pause

# ─── 3. Check Shareholders ──────────────────────────────────────────────────

run "View shareholders & voting power" \
  invoke v2_shareholders "{\"vault_address\":\"$VAULT\",\"shareholders\":[\"$AGENT_ADDR\",\"$SHAREHOLDER_2\"]}"

pause

# ─── 4. Deposit USDC ────────────────────────────────────────────────────────

run "Deposit 100 USDC into vault (agent wallet → vault)" \
  invoke v2_deposit "{\"vault_address\":\"$VAULT\",\"amount_usdc\":100}"

pause

run "Verify balance after deposit" \
  invoke v2_status "{\"vault_address\":\"$VAULT\"}"

pause

# ─── 5. Agent Transfer ──────────────────────────────────────────────────────

run "Agent transfers 10 USDC to payee" \
  invoke v2_transfer "{\"vault_address\":\"$VAULT\",\"to\":\"$PAYEE\",\"amount_usdc\":10}"

pause

# ─── 6. Revenue Distribution ────────────────────────────────────────────────

run "CEO distributes 20 USDC as revenue to shareholders" \
  invoke v2_distribute_revenue "{\"vault_address\":\"$VAULT\",\"amount_usdc\":20}"

run "Check pending revenue per shareholder" \
  invoke v2_shareholders "{\"vault_address\":\"$VAULT\",\"shareholders\":[\"$AGENT_ADDR\",\"$SHAREHOLDER_2\"]}"

pause

run "Agent claims their revenue share" \
  invoke v2_claim_revenue "{\"vault_address\":\"$VAULT\"}"

pause

# ─── 7. CEO Operations ──────────────────────────────────────────────────────

run "CEO updates spending limits (max 100 USDC/tx, 1000 USDC/day)" \
  invoke v2_set_limits "{\"vault_address\":\"$VAULT\",\"max_per_tx_usdc\":100,\"daily_limit_usdc\":1000}"

run "Verify updated limits" \
  invoke v2_status "{\"vault_address\":\"$VAULT\"}"

pause

# ─── 8. Governance: Propose Dissolution ──────────────────────────────────────

run "Propose dissolution via governance" \
  invoke v2_propose "{\"vault_address\":\"$VAULT\",\"governor_address\":\"$GOVERNOR\",\"action\":\"dissolve\",\"description\":\"Wind down the DAC and distribute remaining funds\"}"

echo ""
echo "  → Proposal created. Voting starts after 1 block (votingDelay)."
echo "  → Voting period: 100 blocks."
echo "  → On Arc Testnet, wait ~2-3 minutes for blocks to advance."
echo ""

read -rp "  Proposal ID (from output): " PROPOSAL_ID

pause

# ─── 9. Vote ─────────────────────────────────────────────────────────────────

echo "  Waiting for voting delay (1 block)..."
sleep 5

run "Vote FOR dissolution (agent has 60% = quorum met)" \
  invoke v2_vote "{\"governor_address\":\"$GOVERNOR\",\"proposal_id\":\"$PROPOSAL_ID\",\"support\":1}"

pause

echo ""
echo "  → Voting period is 100 blocks (~3-5 minutes on Arc Testnet)."
echo "  → Agent holds 60% > 51% quorum. Proposal will succeed."
echo "  → Wait for voting period to end, then execute."
echo ""
echo "  ⏳ Waiting for voting period to end..."
echo "     (Press ENTER when ready to execute — check proposal state first)"

pause

# ─── 10. Execute Dissolution ────────────────────────────────────────────────

run "Execute dissolution proposal" \
  invoke v2_execute "{\"vault_address\":\"$VAULT\",\"governor_address\":\"$GOVERNOR\",\"action\":\"dissolve\",\"description\":\"Wind down the DAC and distribute remaining funds\"}"

pause

# ─── 11. Finalize Dissolution ───────────────────────────────────────────────

echo ""
echo "  → Vault is now in Dissolving state."
echo "  → All agent transfers are paused."
echo "  → In a real scenario: redeem yield, Gateway-aggregate all chain balances here."
echo "  → Then call finalize() to auto-distribute all funds to shareholders."
echo ""

run "Finalize dissolution (auto-distribute pro-rata to all shareholders)" \
  invoke v2_finalize "{\"vault_address\":\"$VAULT\"}"

pause

# ─── 12. Dissolution Status ───────────────────────────────────────────────

run "Check dissolution status (payouts already distributed)" \
  invoke v2_dissolve_status "{\"vault_address\":\"$VAULT\",\"shareholders\":[\"$AGENT_ADDR\",\"$SHAREHOLDER_2\"]}"

pause

# ─── 13. Summary ────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  Demo Complete!                                                      ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║                                                                      ║"
echo "║  What we demonstrated:                                               ║"
echo "║   1. ✓ Deploy DAC with shareholders (60/40 split)                    ║"
echo "║   2. ✓ Deposit USDC into vault                                       ║"
echo "║   3. ✓ Agent transfer (with per-tx + daily limits)                   ║"
echo "║   4. ✓ Distribute revenue to shareholders (Synthetix pattern)        ║"
echo "║   5. ✓ Claim revenue share                                           ║"
echo "║   6. ✓ CEO updates spending limits                                   ║"
echo "║   7. ✓ Governance proposal (dissolve)                                ║"
echo "║   8. ✓ Shareholder vote (60% quorum)                                 ║"
echo "║   9. ✓ Execute governance decision                                   ║"
echo "║  10. ✓ Finalize + auto-distribute (pro-rata to all shareholders)    ║"
echo "║                                                                      ║"
echo "║  Vault:    $VAULT"
echo "║  Governor: $GOVERNOR"
echo "║                                                                      ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
