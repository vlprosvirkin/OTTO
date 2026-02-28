---
name: arc-balance
version: 1.0.0
description: "Check USDC balances on Arc Multichain Wallet. Use when the user asks about wallet balance, USDC amount, gateway balance, gas, or funds across Arc Testnet, Base Sepolia, or Avalanche Fuji."
user-invocable: true
metadata: {"openclaw":{"emoji":"💰"}}
---

# Arc Balance Skill

## Get Gateway Unified Balance
Show total USDC balance across all chains (Arc Testnet, Base Sepolia, Avalanche Fuji) for an address.
```bash
bash {baseDir}/scripts/get_gateway_balance.sh <address>
```
Example: `bash {baseDir}/scripts/get_gateway_balance.sh 0xabc123...`

## Get On-Chain USDC Balance
Show USDC balance on a specific chain.
```bash
bash {baseDir}/scripts/get_usdc_balance.sh <address> <chain>
```
Chains: `arcTestnet` | `baseSepolia` | `avalancheFuji`
Example: `bash {baseDir}/scripts/get_usdc_balance.sh 0xabc123... arcTestnet`

## Check Wallet Gas
Check if a Circle wallet has enough native gas tokens on a chain.
```bash
bash {baseDir}/scripts/check_gas.sh <wallet_id> <chain>
```
Example: `bash {baseDir}/scripts/check_gas.sh wallet-uuid-here arcTestnet`

## Notes
- Gateway balance = unified balance that can be spent cross-chain
- On-chain balance = raw USDC on that specific chain
- Gas on Arc Testnet is measured in USDC (native token)
- Gas on Base Sepolia = ETH, on Avalanche Fuji = AVAX
