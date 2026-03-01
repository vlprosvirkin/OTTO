#!/usr/bin/env bash
set -euo pipefail

# Deploy all OTTO infrastructure across all chains.
# Usage:
#   PRIVATE_KEY=0x... ./deploy-all.sh
#
# Deploys:
#   Arc Testnet:     V2 Factory (3 sub-deployers + registry + factory)
#   Base Sepolia:    SatelliteDeployer
#   Avalanche Fuji:  SatelliteDeployer

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "Error: PRIVATE_KEY env var required"
  echo "Usage: PRIVATE_KEY=0x... ./deploy-all.sh"
  exit 1
fi

FORGE="/Users/vlprosvirkin/.foundry/bin/forge"
DEPLOY_DIR="deployments"
OUTPUT_FILE="$DEPLOY_DIR/all-chains.json"
mkdir -p "$DEPLOY_DIR"

echo "=========================================="
echo "  OTTO Full Infrastructure Deploy"
echo "=========================================="
echo ""

# ─── 1. Arc Testnet: V2 Factory ────────────────────────────────────────

ARC_RPC="https://rpc.blockdaemon.testnet.arc.network"
echo "[1/3] Deploying V2 Factory on Arc Testnet..."

ARC_OUTPUT=$($FORGE script script/DeployFactory.s.sol \
  --rpc-url "$ARC_RPC" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  --skip-simulation 2>&1) || {
    echo "Arc Testnet deploy failed:"
    echo "$ARC_OUTPUT"
    exit 1
}

# Parse addresses
TOKEN_DEP=$(echo "$ARC_OUTPUT" | grep "TokenDeployer:" | awk '{print $NF}')
GOV_DEP=$(echo "$ARC_OUTPUT" | grep "GovernorDeployer:" | awk '{print $NF}')
VAULT_DEP=$(echo "$ARC_OUTPUT" | grep "VaultDeployer:" | awk '{print $NF}')
REGISTRY=$(echo "$ARC_OUTPUT" | grep "Registry:" | awk '{print $NF}')
FACTORY=$(echo "$ARC_OUTPUT" | grep "Factory:" | awk '{print $NF}')

echo "  Factory:    $FACTORY"
echo "  Registry:   $REGISTRY"
echo ""

# ─── 2. Base Sepolia: Satellite ─────────────────────────────────────────

BASE_RPC="https://sepolia.base.org"
echo "[2/3] Deploying SatelliteDeployer on Base Sepolia..."

BASE_OUTPUT=$($FORGE script script/DeploySatellite.s.sol \
  --rpc-url "$BASE_RPC" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  --skip-simulation 2>&1) || {
    echo "Base Sepolia deploy failed:"
    echo "$BASE_OUTPUT"
    exit 1
}

BASE_SAT=$(echo "$BASE_OUTPUT" | grep "SatelliteDeployer:" | awk '{print $NF}')
echo "  SatelliteDeployer: $BASE_SAT"
echo ""

# ─── 3. Avalanche Fuji: Satellite ──────────────────────────────────────

AVAX_RPC="https://api.avax-test.network/ext/bc/C/rpc"
echo "[3/3] Deploying SatelliteDeployer on Avalanche Fuji..."

AVAX_OUTPUT=$($FORGE script script/DeploySatellite.s.sol \
  --rpc-url "$AVAX_RPC" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  --skip-simulation 2>&1) || {
    echo "Avalanche Fuji deploy failed:"
    echo "$AVAX_OUTPUT"
    exit 1
}

AVAX_SAT=$(echo "$AVAX_OUTPUT" | grep "SatelliteDeployer:" | awk '{print $NF}')
echo "  SatelliteDeployer: $AVAX_SAT"
echo ""

# ─── Save to JSON ──────────────────────────────────────────────────────

cat > "$OUTPUT_FILE" <<EOF
{
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "agentAddress": "0xA9A48d73f67b0c820fDE57c8B0639c6f850Ae96e",
  "chains": {
    "arcTestnet": {
      "chainId": 5042002,
      "type": "factory",
      "factory": "$FACTORY",
      "registry": "$REGISTRY",
      "deployers": {
        "token": "$TOKEN_DEP",
        "governor": "$GOV_DEP",
        "vault": "$VAULT_DEP"
      }
    },
    "baseSepolia": {
      "chainId": 84532,
      "type": "satellite",
      "satelliteDeployer": "$BASE_SAT"
    },
    "avalancheFuji": {
      "chainId": 43113,
      "type": "satellite",
      "satelliteDeployer": "$AVAX_SAT"
    }
  }
}
EOF

echo "=========================================="
echo "  All deployments complete!"
echo "=========================================="
echo "  Saved to: $OUTPUT_FILE"
echo ""
echo "  Update frontend vault-config.ts:"
echo "    FACTORY_ADDRESS = \"$FACTORY\""
echo "    baseSepolia.satelliteDeployer = \"$BASE_SAT\""
echo "    avalancheFuji.satelliteDeployer = \"$AVAX_SAT\""
echo "=========================================="
