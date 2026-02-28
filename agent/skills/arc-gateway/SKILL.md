---
name: arc-gateway
version: 1.0.0
description: "Explore Circle Gateway protocol: get gateway info, list supported chains with contract addresses, check cross-chain transfer status. Use when the user asks about supported chains, gateway config, or status of a transfer."
user-invocable: true
metadata: {"openclaw":{"emoji":"🌉"}}
---

# Arc Gateway Skill

## Gateway Info
Fetch Circle Gateway configuration: version, supported domains, contract addresses.
```bash
bash {baseDir}/scripts/gateway_info.sh
```

## Supported Chains
List all supported chains with domain IDs, USDC contract addresses, and Circle blockchain names.
```bash
bash {baseDir}/scripts/supported_chains.sh
```

## Transfer Status
Check the status of a cross-chain transfer by its ID.
```bash
bash {baseDir}/scripts/transfer_status.sh <transfer_id>
```
Example: `bash {baseDir}/scripts/transfer_status.sh tx-id-from-previous-transfer`

## Supported Networks
| Chain Key | Domain | Network |
|-----------|--------|---------|
| arcTestnet | 26 | Arc L2 Testnet |
| avalancheFuji | 1 | Avalanche Fuji |
| baseSepolia | 6 | Base Sepolia |
