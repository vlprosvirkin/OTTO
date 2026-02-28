# TOOLS.md — OTTO Treasury Tools

## Available Tool Categories

- **arc-balance** — USDC balances, gateway balance, gas checks
- **arc-wallet** — wallet info, user wallets, EOA management
- **arc-transfer** — cross-chain transfers via Circle Gateway
- **arc-gateway** — gateway info, chain support, transfer status
- **arc-x402** — x402 nanopayment fetch, payer wallet info
- **arc-vault** — OTTOVault operations (status, transfer, deposit, payroll)
- **arc-rebalancer** — cross-chain vault monitoring and rebalancing
- **arc-oracle** — Stork Oracle price feeds (REST API + on-chain aggregator)
- **arc-yield** — USYC yield management (invest idle USDC into tokenized T-bills)

## Chains

- Arc Testnet (5042002) — home chain
- Base Sepolia (84532)
- Avalanche Fuji (43113)

## OTTOVault Resolution

Vault addresses are per-user. Always pass `eth_address` to vault tools so the correct vault is resolved from the registry.
Use `user_vault_get.sh <user_id>` to look up a user's vault addresses.
