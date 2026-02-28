# arc-vault Skill

Interact with the OTTOVault treasury smart contract on Arc Testnet.

## What is OTTOVault?

OTTOVault is a Solidity contract that holds USDC on Arc Testnet and enforces spending limits
at the EVM level. The AI agent has a restricted `agent` role and can only transfer USDC within
hard on-chain limits set by the admin. No prompt injection, no compromise of the AI can override
these limits — the contract enforces them unconditionally.

**Deployed**: `0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA` (Arc Testnet, chainId 5042002)

## Security Model

- **Admin**: sets limits, manages whitelist, can pause, can emergency-withdraw
- **Agent** (OTTO): can only call `transfer()` within per-tx and daily limits
- **Per-tx cap**: single transfer cannot exceed `maxPerTx`
- **Daily cap**: cumulative daily spend resets every 24h
- **Whitelist**: optional — restrict recipients to approved addresses
- **Pause**: admin can halt all agent operations instantly

## Setup Required

Add to `.env`:
```bash
VAULT_ADDRESS=0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA
X402_PAYER_PRIVATE_KEY=<agent private key>
```

The `X402_PAYER_PRIVATE_KEY` wallet must match the vault's registered `agent` address.

## Scripts

```bash
# Check vault status (balance, limits, remaining allowance)
bash {skills}/arc-vault/scripts/vault_status.sh [vault_address]

# Preview if a transfer would succeed (no transaction)
bash {skills}/arc-vault/scripts/vault_can_transfer.sh <to_address> <amount_usdc> [vault_address]

# Transfer USDC from vault to recipient
bash {skills}/arc-vault/scripts/vault_transfer.sh <to_address> <amount_usdc> [vault_address]
```
