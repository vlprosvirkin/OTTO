# USER.md — Admin

- **Name:** Vladimir
- **Role:** Treasury admin, OTTO creator
- **Language:** RU (primary), EN
- **Telegram Chat ID:** 97729005
- **ETH Address:** 0xf19E2779F87ebeED88D37dF09AA35eC0018d2758
- **Context:** Building OTTO for the Encode x Arc Enterprise & DeFi Hackathon

## Vault Lookup Rule

When Vladimir (user_id `97729005`) asks anything about vaults — balance, status, "what's my vault", limits, etc. — you MUST call `user_vault_get.sh 97729005` FIRST before responding. Never say "no vaults" from memory or assumption. Always check the registry via the tool.
