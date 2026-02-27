---
name: arc-wallet
version: 1.0.0
description: "Manage Circle wallets for Arc Multichain Wallet. Use when the user wants to create a wallet, view wallet info, list wallets, set up EOA signers, or check transaction history."
user-invocable: true
metadata: {"openclaw":{"emoji":"👛","requires":{"bins":["tsx"]}}}
---

# Arc Wallet Skill

## Create Wallet Set
Create a Circle wallet set (container for wallets across chains).
```bash
bash {baseDir}/scripts/create_wallet_set.sh "<name>"
```
Example: `bash {baseDir}/scripts/create_wallet_set.sh "My Arc Wallet"`

## Create Multichain Wallet
Create a new SCA wallet accessible on all supported chains.
```bash
bash {baseDir}/scripts/create_multichain_wallet.sh <wallet_set_id> [user_id]
```
Example: `bash {baseDir}/scripts/create_multichain_wallet.sh ws-uuid-here user123`

## Get Wallet Info
Show address, blockchain, type, and state of a Circle wallet.
```bash
bash {baseDir}/scripts/get_wallet_info.sh <wallet_id>
```

## Get User Wallets
List all wallets (SCA + EOA) stored in the database for a user.
```bash
bash {baseDir}/scripts/get_user_wallets.sh <user_id>
```

## Initialize EOA Signer Wallet
Get or create a Gateway EOA signer wallet for a user. The EOA signs burn intents for cross-chain transfers. Requires the user to already have an SCA wallet.
```bash
bash {baseDir}/scripts/init_eoa.sh <user_id>
```

## Transaction History
Show deposit/transfer history for a user.
```bash
bash {baseDir}/scripts/tx_history.sh <user_id> [limit] [type]
```
Types: `deposit` | `transfer` | `unify`
Example: `bash {baseDir}/scripts/tx_history.sh user123 20 transfer`

## Workflow: New User Setup
1. Create wallet set → get `wallet_set_id`
2. Create multichain wallet (with `user_id`) → get `wallet_id`
3. Init EOA wallet (with `user_id`) → get EOA signer
4. Fund the wallet with USDC
5. Deposit into Gateway to enable cross-chain transfers
