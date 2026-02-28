---
name: arc-vault
version: 1.0.0
description: "OTTOVault treasury operations: check vault status, transfer USDC, deposit, payroll, deploy user vaults, manage admin rights. Use when the user asks about vault balance, spending limits, transfers, deposits, or payroll."
user-invocable: true
metadata: {"openclaw":{"emoji":"🏦"}}
---

# arc-vault Skill

Interact with OTTOVault treasury smart contracts and personal user vaults.

## What is OTTOVault?

OTTOVault is a Solidity contract that holds USDC and enforces spending limits at the EVM level.
OTTO has a restricted `agent` role and can only transfer USDC within hard on-chain limits set
by the admin. No prompt injection, no jailbreak, no compromise of the AI can override these
limits — the contract enforces them unconditionally.

## Security Model

- **Admin** (user's own MetaMask/hardware wallet): sets limits, manages whitelist, can pause, can emergency-withdraw
- **Agent** (OTTO wallet): can only call `transfer()` within per-tx and daily limits
- **Per-tx cap**: single transfer cannot exceed `maxPerTx`
- **Daily cap**: cumulative spend resets automatically every 24 h
- **Whitelist**: optional — restrict recipients to approved addresses only
- **Pause**: admin can halt all agent operations instantly

Admin operations require the user's private key (Tier 3). OTTO never has admin keys.

## Deployed Addresses

```
arcTestnet    (5042002): 0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA
baseSepolia   (84532):   0x47C1feaC66381410f5B050c39F67f15BbD058Af1
avalancheFuji (43113):   0x47C1feaC66381410f5B050c39F67f15BbD058Af1
```

Default limits: **10 USDC / tx · 100 USDC / day**

## Setup Required

Add to `.env`:
```bash
X402_PAYER_PRIVATE_KEY=<agent private key>
# Optional overrides (defaults above are used otherwise):
VAULT_ADDRESS_ARC=0x...
VAULT_ADDRESS_BASE=0x...
VAULT_ADDRESS_FUJI=0x...
```

## Scripts

### Treasury vault operations

```bash
# Read full vault status: balance, limits, remaining allowance, roles
bash {skills}/arc-vault/scripts/vault_status.sh [chain] [vault_address]

# Preview if a transfer would succeed — no tx sent
bash {skills}/arc-vault/scripts/vault_can_transfer.sh <to> <amount_usdc> [chain] [vault_address]

# Transfer USDC from vault to recipient (enforces on-chain limits)
bash {skills}/arc-vault/scripts/vault_transfer.sh <to> <amount_usdc> [chain] [vault_address]

# Deposit USDC from agent wallet into vault
bash {skills}/arc-vault/scripts/vault_deposit.sh <amount_usdc> [chain] [vault_address]
```

### Personal user vaults

```bash
# Deploy a personal vault for a user (OTTO pays gas)
bash {skills}/arc-vault/scripts/user_vault_deploy.sh <user_id> [chain] [max_per_tx_usdc] [daily_limit_usdc]

# Look up user's vault address(es)
bash {skills}/arc-vault/scripts/user_vault_get.sh <user_id> [chain]
```

### User ownership (admin control)

```bash
# Register user's own ETH wallet — becomes admin of their next vault
bash {skills}/arc-vault/scripts/user_register_address.sh <user_id> <eth_address>

# Transfer admin of existing custodial vault to user's registered address
bash {skills}/arc-vault/scripts/transfer_vault_admin.sh <user_id> [chain] [vault_address]
```

### Tier 3 — admin operations (require user's wallet signature)

```bash
# Encode calldata for an admin function + generate signing URL.
# User signs at https://ottoarc.xyz/sign — OTTO never executes admin ops.
bash {skills}/arc-vault/scripts/encode_admin_tx.sh <function> [options]

# Functions and options:
#   setLimits           --max-per-tx <usdc> --daily <usdc>
#   setWhitelist        --address <0x...> --allowed <true|false>
#   setWhitelistEnabled --enabled <true|false>
#   setAgent            --new-address <0x...>
#   transferAdmin       --new-address <0x...>
#   setPaused           --paused <true|false>
#   withdraw            --amount <usdc>
#   Optional: --chain <arcTestnet|baseSepolia|avalancheFuji>  --vault <0x...>

# Examples:
bash {skills}/arc-vault/scripts/encode_admin_tx.sh setLimits --max-per-tx 50 --daily 500
bash {skills}/arc-vault/scripts/encode_admin_tx.sh setPaused --paused true --chain baseSepolia
bash {skills}/arc-vault/scripts/encode_admin_tx.sh setWhitelist --address 0xAbc... --allowed true
```

### Whitelist

```bash
# Check if an address is whitelisted (read-only, no tx)
bash {skills}/arc-vault/scripts/vault_check_whitelist.sh <address> [chain] [vault_address]
```

### Payroll

```bash
# Batch transfer USDC to multiple recipients (pre-flight limit checks)
bash {skills}/arc-vault/scripts/vault_payroll.sh '<recipients_json>' [chain] [vault_address]
# recipients_json example: [{"address":"0x...","amount_usdc":10},{"address":"0x...","amount_usdc":25}]
```

### Invoice / compliance

```bash
# Create a payment invoice for expected incoming USDC
bash {skills}/arc-vault/scripts/create_invoice.sh <amount_usdc> [user_id] [chain] [expected_sender]

# Check if invoice has been paid (pending / paid / expired)
bash {skills}/arc-vault/scripts/check_invoice_status.sh <invoice_id>

# Check all pending invoices (used by heartbeat)
bash {skills}/arc-vault/scripts/check_pending_invoices.sh
```
