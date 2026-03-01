#!/usr/bin/env bash
set -euo pipefail

# Deploy OTTOSatelliteDeployer on satellite chains.
# Usage:
#   ./deploy-satellite.sh base_sepolia
#   ./deploy-satellite.sh avax_fuji

CHAIN="${1:-}"
if [ -z "$CHAIN" ]; then
  echo "Usage: $0 <chain>"
  echo "  Chains: base_sepolia, avax_fuji"
  exit 1
fi

case "$CHAIN" in
  base_sepolia)
    RPC_URL="https://sepolia.base.org"
    CHAIN_LABEL="Base Sepolia"
    JSON_FILE="deployments/satellite-base-sepolia.json"
    ;;
  avax_fuji)
    RPC_URL="https://api.avax-test.network/ext/bc/C/rpc"
    CHAIN_LABEL="Avalanche Fuji"
    JSON_FILE="deployments/satellite-avax-fuji.json"
    ;;
  *)
    echo "Unknown chain: $CHAIN"
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Deploying OTTOSatelliteDeployer on $CHAIN_LABEL..."

OUTPUT=$(forge script script/DeploySatellite.s.sol \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  --skip-simulation 2>&1) || {
    echo "Deploy failed:"
    echo "$OUTPUT"
    exit 1
}

echo "$OUTPUT"

# Extract address
DEPLOYER=$(echo "$OUTPUT" | grep "SatelliteDeployer:" | awk '{print $NF}')

if [ -z "$DEPLOYER" ]; then
  echo "Could not parse deployer address from output"
  exit 1
fi

# Save to JSON
mkdir -p deployments
cat > "$JSON_FILE" <<EOF
{
  "chain": "$CHAIN_LABEL",
  "satelliteDeployer": "$DEPLOYER",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo ""
echo "Saved to $JSON_FILE"
echo "Update vault-config.ts: satelliteDeployer: \"$DEPLOYER\""
