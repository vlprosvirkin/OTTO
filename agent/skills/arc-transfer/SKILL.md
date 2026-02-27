---
name: arc-transfer
version: 1.0.0
description: "Move USDC via Circle Gateway: deposit into Gateway, withdraw, or transfer cross-chain. Use when the user wants to transfer USDC between chains, deposit to Gateway, or withdraw from Gateway."
user-invocable: true
metadata: {"openclaw":{"emoji":"🔀","requires":{"bins":["tsx"]}}}
---

# Arc Transfer Skill

## Deposit USDC into Gateway
Deposit USDC from a Circle custodial wallet into the Gateway contract. The deposited amount becomes unified balance usable on any supported chain.
```bash
bash {baseDir}/scripts/deposit.sh <wallet_id> <chain> <amount_usdc> [user_id]
```
Example: `bash {baseDir}/scripts/deposit.sh wallet-uuid arcTestnet 50 user123`

## Withdraw USDC from Gateway
Withdraw USDC from Gateway back to the custodial wallet. **Note: withdrawals have a delay period.**
```bash
bash {baseDir}/scripts/withdraw.sh <wallet_id> <chain> <amount_usdc>
```
Example: `bash {baseDir}/scripts/withdraw.sh wallet-uuid arcTestnet 10`

## Transfer Cross-Chain (Custodial Signing)
Transfer USDC cross-chain via Circle Gateway. The Circle SCA wallet signs the transfer.
**Minimum amount: > 1.01 USDC** (to cover fees)
```bash
bash {baseDir}/scripts/transfer_custodial.sh <wallet_id> <source_chain> <dest_chain> <amount_usdc> [recipient] [user_id]
```
Example: `bash {baseDir}/scripts/transfer_custodial.sh wallet-uuid arcTestnet baseSepolia 5.0 0xrecipient... user123`

## Chains
- `arcTestnet` — Arc L2 Testnet
- `baseSepolia` — Base Sepolia (Ethereum L2)
- `avalancheFuji` — Avalanche Fuji

## Safety Rules
- **Always confirm** with the user before executing transfers or withdrawals
- Warn the user about withdrawal delay periods
- Minimum transfer amounts apply — tell the user if their amount is too low
- Transfers require USDC to be deposited in Gateway first
