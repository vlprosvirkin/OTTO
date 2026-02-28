---
name: arc-yield
version: 1.0.0
description: "USYC yield management: invest idle USDC into Hashnote tokenized T-bills, check rates and balances, redeem back to USDC. Use when the user asks about yield, investing, USYC, T-bills, or idle assets."
user-invocable: true
metadata: {"openclaw":{"emoji":"📊"}}
---

# arc-yield Skill

Manage USYC (Hashnote tokenized US T-bills) positions on Arc Testnet. Invest idle USDC to earn yield, redeem back when needed.

## What is USYC?

USYC is a tokenized representation of short-term US Treasury bills issued by Hashnote. Holding USYC earns yield from T-bill interest. The token is available on Arc Testnet.

## Security Model

- **Deposit**: Agent approves USDC spend → calls `buy()` on USYC contract
- **Redeem**: Agent calls `sell()` to convert USYC back to USDC
- All operations are on-chain and auditable
- Agent can only operate with its own wallet funds

## Deployed Addresses (Arc Testnet)

```
USYC Token:    0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C
USDC:          0x3600000000000000000000000000000000000000
```

## Scripts

```bash
# Check current USYC exchange rate and APY
bash {skills}/arc-yield/scripts/usyc_rate.sh

# Check USYC balance for an address (default: agent wallet)
bash {skills}/arc-yield/scripts/usyc_balance.sh [address] [chain]

# Invest USDC into USYC (buy tokenized T-bills)
bash {skills}/arc-yield/scripts/usyc_deposit.sh <amount_usdc> [chain]

# Redeem USYC back to USDC
bash {skills}/arc-yield/scripts/usyc_redeem.sh <amount_usyc> [chain]
```
