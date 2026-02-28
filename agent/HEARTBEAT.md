# HEARTBEAT.md — Autonomous Treasury Monitoring

Run these checks on every heartbeat. Report to Telegram only if action is needed.

## 1. Rebalance Check

```bash
bash {skills}/arc-rebalancer/scripts/rebalance.sh 5
```

If any chain has `needs_funding: true`:
1. Check agent wallet balance on that chain
2. If agent has USDC → run `vault_deposit.sh <shortfall> <chain>`
3. If agent is also low → bridge from richest chain first via `transfer_custodial.sh`
4. Re-run `rebalance.sh` to confirm all healthy
5. Report to Telegram: which chains were low, what was moved, new balances

If all chains healthy → do nothing (HEARTBEAT_OK).

## 2. x402 Payer Balance

```bash
bash {skills}/arc-x402/scripts/x402_payer_info.sh
```

If payer balance < 1 USDC on any active chain → report to Telegram:
"⚠️ x402 payer low: <balance> USDC on <chain>. Top up needed."

Otherwise → skip.

## 3. Vault Pause Check

```bash
bash {skills}/arc-vault/scripts/vault_status.sh arcTestnet
```

If `paused = true` → report to Telegram:
"⚠️ Treasury vault is paused on arcTestnet. Admin action required to unpause."

Otherwise → skip.

## 4. Pending Invoice Check

```bash
bash {skills}/arc-vault/scripts/check_pending_invoices.sh
```

For each pending invoice in the results:
- If `status` changed to `"paid"` → report to Telegram:
  "✅ Invoice <invoice_id> paid — <amount> USDC received on <chain>."
- If `status` changed to `"expired"` → report to Telegram:
  "⏰ Invoice <invoice_id> expired — expected <amount> USDC, not received."
- If still `"pending"` → skip.

If no pending invoices → skip.
