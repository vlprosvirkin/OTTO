# arc-rebalancer

Monitor OTTOVault balances across all chains and trigger rebalancing when needed.

## Scripts

```bash
bash {skills}/arc-rebalancer/scripts/rebalance.sh [min_usdc]
```

## Output

JSON report with:
- Per-chain status: `healthy` | `low` | `empty` | `paused`
- `needs_funding`: true/false per chain
- `shortfall_usdc`: how much is needed
- `recommendation`: human-readable action summary

## When to use

- Scheduled monitoring (every N minutes)
- Before executing payroll or large transfers
- After receiving "rebalance" command from user

## Playbook

1. Run `rebalance.sh` → get report
2. For each chain with `needs_funding: true`:
   a. If agent wallet has USDC on that chain → `vault_deposit.sh <shortfall> <chain>`
   b. If agent wallet is also low → use Circle Gateway to bridge from richest chain first
3. Re-run `rebalance.sh` to confirm all vaults are healthy
4. Report to Telegram
