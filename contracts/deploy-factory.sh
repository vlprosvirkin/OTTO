#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  OTTO V2 Factory Infrastructure Deploy (one-time per chain)            ║
# ║                                                                         ║
# ║  Deploys: 3 sub-deployers + Registry + Factory                         ║
# ║  Saves addresses to contracts/deployments/factory-arc-testnet.json     ║
# ╚══════════════════════════════════════════════════════════════════════════╝
#
# Usage:
#   cd OTTO && bash contracts/deploy-factory.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
source "$ROOT/agent/.env"

FORGE="${HOME}/.foundry/bin/forge"
RPC="https://rpc.testnet.arc.network"
DEPLOY_DIR="$ROOT/contracts/deployments"

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  OTTO V2 Factory Deploy (Arc Testnet)                          ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

OUTPUT=$(\
  cd "$ROOT/contracts" && \
  REGISTRY_ADDRESS="${REGISTRY_ADDRESS:-}" \
  $FORGE script script/DeployFactory.s.sol \
    --rpc-url "$RPC" \
    --private-key "$X402_PAYER_PRIVATE_KEY" \
    --broadcast 2>&1 \
)

# Parse addresses
TOKEN_DEP=$(echo "$OUTPUT" | grep "TokenDeployer:" | head -1 | awk '{print $NF}')
GOV_DEP=$(echo "$OUTPUT" | grep "GovernorDeployer:" | head -1 | awk '{print $NF}')
VAULT_DEP=$(echo "$OUTPUT" | grep "VaultDeployer:" | head -1 | awk '{print $NF}')
REGISTRY=$(echo "$OUTPUT" | grep "Registry:" | head -1 | awk '{print $NF}')
FACTORY=$(echo "$OUTPUT" | grep "Factory:" | head -1 | awk '{print $NF}')

if [[ -z "$FACTORY" || "$FACTORY" != 0x* ]]; then
  echo "Deploy failed! Output:"
  echo "$OUTPUT"
  exit 1
fi

echo "  TokenDeployer:    $TOKEN_DEP"
echo "  GovernorDeployer: $GOV_DEP"
echo "  VaultDeployer:    $VAULT_DEP"
echo "  Registry:         $REGISTRY"
echo "  Factory:          $FACTORY"
echo ""

# Save to JSON
mkdir -p "$DEPLOY_DIR"
cat > "$DEPLOY_DIR/factory-arc-testnet.json" <<EOF
{
  "chainId": 5042002,
  "chainName": "Arc Testnet",
  "rpc": "$RPC",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "factory": "$FACTORY",
  "registry": "$REGISTRY",
  "deployers": {
    "token": "$TOKEN_DEP",
    "governor": "$GOV_DEP",
    "vault": "$VAULT_DEP"
  }
}
EOF

echo "Saved to $DEPLOY_DIR/factory-arc-testnet.json"
echo ""
echo "Update frontend:"
echo "  FACTORY_ADDRESS = \"$FACTORY\""
echo ""
echo "Done!"
