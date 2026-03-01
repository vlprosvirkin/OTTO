#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  OTTO V2 Contract Deploy + Save Addresses                              ║
# ║                                                                         ║
# ║  Deploys OTTOShareToken + OTTOGovernor + OTTOVaultV2 + OTTORegistry    ║
# ║  and saves all addresses to contracts/deployments/arc-testnet.json     ║
# ╚══════════════════════════════════════════════════════════════════════════╝
#
# Usage:
#   cd OTTO && bash contracts/deploy.sh
#
# Required env (from agent/.env):
#   X402_PAYER_PRIVATE_KEY  — deployer private key
#
# Optional env:
#   SHAREHOLDERS       — comma-separated addresses (default: deployer only)
#   SHARES_BPS         — comma-separated basis points (default: 10000)
#   SALT               — vault name/salt (default: otto-vault-<timestamp>)
#   MAX_PER_TX_USDC    — per-tx limit (default: 10)
#   DAILY_LIMIT_USDC   — daily limit (default: 100)
#   REGISTRY_ADDRESS   — reuse existing registry (deploys new if empty)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
source "$ROOT/agent/.env"

FORGE="${HOME}/.foundry/bin/forge"
RPC="https://rpc.testnet.arc.network"
DEPLOY_DIR="$ROOT/contracts/deployments"

AGENT_ADDR="0xA9A48d73f67b0c820fDE57c8B0639c6f850Ae96e"
SALT="${SALT:-otto-vault-$(date +%s)}"

# Defaults: deployer = 100%
SHAREHOLDERS="${SHAREHOLDERS:-$AGENT_ADDR}"
SHARES_BPS="${SHARES_BPS:-10000}"
MAX_PER_TX_USDC="${MAX_PER_TX_USDC:-10}"
DAILY_LIMIT_USDC="${DAILY_LIMIT_USDC:-100}"

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  OTTO V2 Contract Deploy                                       ║"
echo "║  Agent: $AGENT_ADDR"
echo "║  Salt:  $SALT"
echo "║  Shareholders: $SHAREHOLDERS"
echo "║  Shares BPS:   $SHARES_BPS"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

# Run forge deploy script
DEPLOY_OUTPUT=$(\
  cd "$ROOT/contracts" && \
  AGENT_ADDRESS="$AGENT_ADDR" \
  SHAREHOLDERS="$SHAREHOLDERS" \
  SHARES_BPS="$SHARES_BPS" \
  SALT="$SALT" \
  MAX_PER_TX_USDC="$MAX_PER_TX_USDC" \
  DAILY_LIMIT_USDC="$DAILY_LIMIT_USDC" \
  REGISTRY_ADDRESS="${REGISTRY_ADDRESS:-}" \
  $FORGE script script/DeployV2.s.sol \
    --rpc-url "$RPC" \
    --private-key "$X402_PAYER_PRIVATE_KEY" \
    --broadcast 2>&1 \
)

# Parse addresses from output
VAULT=$(echo "$DEPLOY_OUTPUT" | grep "Vault:" | head -1 | awk '{print $NF}')
GOV=$(echo "$DEPLOY_OUTPUT" | grep "Governor:" | head -1 | awk '{print $NF}')
TOKEN=$(echo "$DEPLOY_OUTPUT" | grep "Share Token:" | head -1 | awk '{print $NF}')
REG=$(echo "$DEPLOY_OUTPUT" | grep "Registry:" | head -1 | awk '{print $NF}')
CEO=$(echo "$DEPLOY_OUTPUT" | grep "CEO:" | head -1 | awk '{print $NF}')

if [[ -z "$VAULT" || "$VAULT" != 0x* ]]; then
  echo "Deploy failed! Output:"
  echo "$DEPLOY_OUTPUT"
  exit 1
fi

echo "  Registry:    $REG"
echo "  Vault:       $VAULT"
echo "  Share Token: $TOKEN"
echo "  Governor:    $GOV"
echo "  CEO:         $CEO"
echo ""

# Save to JSON
mkdir -p "$DEPLOY_DIR"
cat > "$DEPLOY_DIR/arc-testnet.json" <<EOF
{
  "chainId": 5042002,
  "chainName": "Arc Testnet",
  "rpc": "$RPC",
  "explorer": "https://testnet.arcscan.app",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "salt": "$SALT",
  "contracts": {
    "registry": "$REG",
    "vault": "$VAULT",
    "shareToken": "$TOKEN",
    "governor": "$GOV"
  },
  "roles": {
    "agent": "$AGENT_ADDR",
    "ceo": "$CEO"
  },
  "params": {
    "maxPerTxUsdc": $MAX_PER_TX_USDC,
    "dailyLimitUsdc": $DAILY_LIMIT_USDC,
    "shareholders": "$SHAREHOLDERS",
    "sharesBps": "$SHARES_BPS"
  }
}
EOF

echo "Saved to $DEPLOY_DIR/arc-testnet.json"
echo ""
echo "Done!"
EOF
