# OTTO — End-to-End Testing Flow

Complete manual testing guide covering all OTTO functionality.
Every scenario can be tested via **Telegram** (send messages to the bot) or **CLI** (bash scripts in `agent/`).

---

## Prerequisites

| Requirement | Check |
|-------------|-------|
| Agent running | `tail -f ~/otto.log` on GCP (or `npx openclaw gateway run` locally) |
| Telegram bot paired | `/start` in Telegram → bot responds |
| `.env` configured | `CIRCLE_API_KEY`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `X402_PAYER_PRIVATE_KEY` |
| Demo server running | `npm run demo-server` (port 4402) — only for x402 tests |
| Agent wallet funded | ≥ 1 USDC on Arc Testnet, ≥ 1 USDC on Base Sepolia |

---

## Phase 1: Identity & Basics

### 1.1 — /start (intro & capabilities)

**Telegram:**
```
/start
```

**Expected:** OTTO replies with capabilities list (balances, vaults, transfers, x402, payroll). Must reply in the same language as the user (RU/EN).

**Verify:**
- [ ] Response lists all major features
- [ ] Language matches user input
- [ ] No error messages

---

### 1.2 — Balance check

**Telegram:**
```
баланс
```

**Expected:**
```
Arc Testnet:       XX.XX USDC ✅
Base Sepolia:      XX.XX USDC ✅
Avalanche Fuji:     0.00 USDC ⭕
──────────────────────────────
Gateway (unified): XX.XX USDC
```

**CLI equivalent:**
```bash
bash agent/skills/arc-balance/scripts/get_gateway_balance.sh 0xA9A48d73f67b0c820fDE57c8B0639c6f850Ae96e
```

**Verify:**
- [ ] All 3 chains shown
- [ ] Numbers are non-negative, formatted as USDC
- [ ] Gateway total ≈ sum of chains

---

### 1.3 — Wallet info

**Telegram:**
```
кошелёк
```

**Verify:**
- [ ] Shows wallet address(es)
- [ ] Shows chain assignment and state

---

## Phase 2: OTTOVault Operations

### 2.1 — Vault status (treasury)

**Telegram:**
```
статус хранилища
```

**Expected:** Shows balance, per-tx cap, daily limit, spent today, remaining allowance, admin address, agent address, pause/whitelist state.

**CLI equivalent:**
```bash
bash agent/skills/arc-vault/scripts/vault_status.sh arcTestnet
```

**Verify:**
- [ ] `maxPerTx` = 10 USDC (default)
- [ ] `dailyLimit` = 100 USDC (default)
- [ ] `agent` = `0xA9A48d73f67b0c820fDE57c8B0639c6f850Ae96e`
- [ ] `paused` = false
- [ ] `balance` matches on-chain

---

### 2.2 — Deploy personal vault

**Telegram:**
```
создай хранилище
```

**Expected:** OTTO asks for confirmation, then deploys an OTTOVault contract for the user on Arc Testnet. Returns vault address and tx hash.

**CLI equivalent:**
```bash
bash agent/skills/arc-vault/scripts/user_vault_deploy.sh <telegram_user_id> arcTestnet
```

**Verify:**
- [ ] OTTO asks "подтвердить?" before deploying
- [ ] Returns vault address (0x...)
- [ ] Returns tx hash
- [ ] Calling again returns existing address (idempotent)
- [ ] `vault_status` on new address shows correct defaults

---

### 2.3 — Vault transfer (EVM-enforced limits)

**Telegram:**
```
переведи 1 USDC из хранилища на 0xRecipient
```

**Expected:** Preview → confirmation → transfer → result.

**CLI equivalent:**
```bash
# Preview first
bash agent/skills/arc-vault/scripts/vault_can_transfer.sh 0xRecipient 1 arcTestnet
# Execute
bash agent/skills/arc-vault/scripts/vault_transfer.sh 0xRecipient 1 arcTestnet
```

**Verify:**
- [ ] OTTO shows preview with current limits and remaining daily allowance
- [ ] Asks for confirmation ("да/yes")
- [ ] After confirmation — shows tx hash
- [ ] `vault_status` shows updated `dailySpent`

**Edge case — exceed per-tx limit:**
```
переведи 50 USDC из хранилища на 0xRecipient
```
- [ ] OTTO shows `canTransfer = false`, reason: "Exceeds per-tx limit" — does NOT send tx

---

### 2.4 — Vault deposit

**Telegram:**
```
пополни хранилище на 2 USDC
```

**CLI equivalent:**
```bash
bash agent/skills/arc-vault/scripts/vault_deposit.sh 2 arcTestnet
```

**Verify:**
- [ ] OTTO asks for confirmation
- [ ] Shows approve tx + deposit tx
- [ ] `vault_status` shows increased balance

---

## Phase 3: User Ownership & Security

### 3.1 — Register ETH address

**Telegram:**
```
/setaddress 0xYourMetaMaskWallet
```

**CLI equivalent:**
```bash
bash agent/skills/arc-vault/scripts/user_register_address.sh <user_id> 0xYourMetaMaskWallet
```

**Verify:**
- [ ] OTTO confirms address registration
- [ ] Address validated (rejects invalid addresses)
- [ ] Calling again offers to update

---

### 3.2 — Transfer vault admin to user

**Telegram:**
```
перевести управление
```

**Prerequisites:** User has registered ETH address (3.1) and has a deployed vault (2.2).

**CLI equivalent:**
```bash
bash agent/skills/arc-vault/scripts/transfer_vault_admin.sh <user_id> arcTestnet
```

**Verify:**
- [ ] OTTO confirms transfer with addresses shown
- [ ] After transfer: `vault_status` shows `admin` = user's registered address
- [ ] OTTO can still do `transfer()` (agent role preserved)
- [ ] OTTO cannot change limits → shows "Tier 3, sign with your wallet"

---

### 3.3 — Admin operations (Tier 3 — signing flow)

**Telegram:**
```
измени лимит до 50 USDC за транзакцию
```

**CLI equivalent:**
```bash
bash agent/skills/arc-vault/scripts/encode_admin_tx.sh setLimits --max-per-tx 50 --daily 500
```

**Expected:** OTTO does NOT execute the tx. Instead shows a signing URL:
```
https://ottoarc.xyz/sign?to=0xVault...&data=0x...&chainId=5042002&desc=...
```

**Verify:**
- [ ] OTTO does not attempt to call setLimits directly
- [ ] Shows clickable signing URL
- [ ] Opening URL: page shows operation description, "Connect Wallet", "Sign & Send"
- [ ] After signing in MetaMask: tx broadcasts, limits change on-chain
- [ ] `vault_status` shows new limits

**Test all admin functions:**

| Function | Trigger | Verify |
|----------|---------|--------|
| `setLimits` | "измени лимит до 50/tx 500/day" | `vault_status` reflects new caps |
| `setPaused` | "заморозь хранилище" | `paused = true`, transfers blocked |
| `setPaused(false)` | "разморозь хранилище" | `paused = false`, transfers work |
| `setWhitelist` | "добавь 0xAddr в whitelist" | Recipient whitelisted |
| `setWhitelistEnabled` | "включи whitelist" | Only whitelisted recipients accepted |
| `withdraw` | "экстренный вывод 10 USDC" | Bypasses all limits |

---

## Phase 4: Cross-chain (Circle Gateway)

### 4.1 — Cross-chain transfer

**Telegram:**
```
переведи 2 USDC с Base Sepolia на Arc Testnet
```

**Expected:** Confirmation prompt → "да" → transfer initiated → polling → confirmed.

**Verify:**
- [ ] Shows "from" chain balance before transfer
- [ ] Asks for confirmation
- [ ] Returns transfer ID
- [ ] Polls status: pending → confirmed
- [ ] Balance on destination chain increased

---

### 4.2 — Transfer status

**Telegram:**
```
статус перевода <transfer_id>
```

**Verify:**
- [ ] Shows current state (pending / complete / failed)
- [ ] Shows source/destination chains and amount

---

## Phase 5: x402 Nanopayments

**Requires:** Demo server running on port 4402.

### 5.1 — ETH price feed

**Telegram:**
```
цена ETH
```

**Expected:**
```
→ fetching from oracle...
→ 402 Payment Required: 0.001 USDC (Base Sepolia)
→ paying automatically...

ETH/USD: $2,852.95
Change 24h: -1.88%
Paid: 0.001 USDC · tx: 0xb414...c065
```

**CLI equivalent:**
```bash
bash agent/skills/arc-x402/scripts/x402_fetch.sh http://localhost:4402/eth-price
```

**Verify:**
- [ ] Auto-pays without asking (< 0.01 USDC)
- [ ] Shows price data
- [ ] Shows tx hash of payment

---

### 5.2 — Arc stats feed

**Telegram:**
```
статистика Arc
```

**CLI equivalent:**
```bash
bash agent/skills/arc-x402/scripts/x402_fetch.sh http://localhost:4402/arc-stats
```

**Verify:**
- [ ] Returns chain, chainId, blockHeight, tps, activeWallets, usdcTvl
- [ ] Shows payment tx hash

---

### 5.3 — x402 payer info

**Telegram:**
```
информация о x402 кошельке
```

**CLI equivalent:**
```bash
bash agent/skills/arc-x402/scripts/x402_payer_info.sh
```

**Verify:**
- [ ] Shows payer address (0xA9A4...)
- [ ] Shows supported networks

---

## Phase 6: Rebalancer

### 6.1 — Check vault balances across chains

**Telegram:**
```
проверь хранилища
```

**CLI equivalent:**
```bash
bash agent/skills/arc-rebalancer/scripts/rebalance.sh 5
```

**Expected:** JSON report per chain: healthy / low / empty, shortfall amount, recommended action.

**Verify:**
- [ ] All 3 chains listed (arcTestnet, baseSepolia, avalancheFuji)
- [ ] Each chain has status + balance
- [ ] If any chain < threshold → `needs_funding: true`
- [ ] Recommendation provided for underfunded chains

---

### 6.2 — Auto-rebalance (full flow)

**Telegram:**
```
ребалансируй
```

**Expected:** Check → identify low chains → deposit/bridge to fix → recheck → report.

**Verify:**
- [ ] Identifies which chains need funding
- [ ] Uses vault_deposit or cross-chain transfer as appropriate
- [ ] Final check shows all chains healthy (or explains why not)

---

## Phase 7: Payroll (Batch Transfers)

### 7.1 — Batch payout

**Telegram:**
```
выплати:
0xAlice 5 USDC
0xBob 3 USDC
```

**Expected:** Shows total, asks for confirmation, sends one by one.

**Verify:**
- [ ] Lists all recipients with amounts
- [ ] Shows total sum
- [ ] Checks balance is sufficient before starting
- [ ] Asks for "да/yes"
- [ ] After confirmation: executes transfers sequentially
- [ ] Shows per-recipient tx hash
- [ ] Shows final remaining balance

---

## Phase 8: Invoice / Compliance

### 8.1 — Create invoice

**Telegram:**
```
создай счёт на 100 USDC
```

**CLI equivalent:**
```bash
bash agent/skills/arc-vault/scripts/create_invoice.sh 100 <user_id> arcTestnet
```

**Verify:**
- [ ] Returns invoice ID (INV-...)
- [ ] Shows vault address to receive payment
- [ ] Shows expiry time (default 24h)

---

### 8.2 — Check invoice status

**Telegram:**
```
статус инвойса INV-1709120000-A3F2B1
```

**CLI equivalent:**
```bash
bash agent/skills/arc-vault/scripts/check_invoice_status.sh INV-1709120000-A3F2B1
```

**Verify:**
- [ ] Shows: pending / paid / expired
- [ ] If paid: shows balance increase
- [ ] If expired: shows "expired" with original amount

---

## Phase 9: Error Handling & Edge Cases

### 9.1 — Insufficient balance

```
переведи 999 USDC с Arc Testnet на Base Sepolia
```

**Verify:**
- [ ] Clear error message, no stack trace
- [ ] Shows current balance

### 9.2 — Invalid address

```
переведи 1 USDC из хранилища на invalid_address
```

**Verify:**
- [ ] Rejects invalid address format
- [ ] Does not attempt transaction

### 9.3 — Paused vault

After pausing vault via signing page:
```
переведи 1 USDC из хранилища на 0xRecipient
```

**Verify:**
- [ ] `canTransfer` returns false with reason "Vault is paused"
- [ ] OTTO does not attempt transaction

### 9.4 — Daily limit exhaustion

Transfer repeatedly until daily limit is hit:

**Verify:**
- [ ] When daily limit reached: `canTransfer` returns false with "Exceeds daily limit"
- [ ] After 24h: limit resets, transfers work again

### 9.5 — Unknown command

```
сделай мне кофе
```

**Verify:**
- [ ] OTTO responds gracefully (doesn't crash, explains its capabilities)

---

## Phase 10: Deploy Pipeline

### 10.1 — Auto-deploy on push

```bash
git push origin main
```

**Verify:**
- [ ] GitHub Actions triggers `deploy.yml`
- [ ] SSH to GCP: `git pull` → `npm install` → restart openclaw
- [ ] Smoke test passes (`rebalance_check` returns `threshold_usdc`)
- [ ] Telegram notification: "OTTO deployed ✅" with commit SHA

### 10.2 — Manual deploy

Trigger via GitHub Actions UI: Actions → Deploy OTTO Agent → Run workflow.

**Verify:**
- [ ] Same deploy flow as push-triggered
- [ ] Reason field logged

### 10.3 — Deploy failure notification

Simulate: break `.env` on GCP (rename it), trigger deploy.

**Verify:**
- [ ] Telegram notification: "OTTO deploy FAILED ❌"
- [ ] Restore `.env` and redeploy

---

## Automated Test Coverage

In addition to manual tests above, OTTO has automated tests:

### Solidity (Foundry)

```bash
cd contracts && forge test -vvv
```

**43 tests** covering:
- Transfer within/above limits
- Daily window reset
- Deposit (including zero revert)
- Admin functions (setLimits, transferAdmin, setPaused, setWhitelist)
- Constructor validation
- Fuzz tests (random amounts within/above limits)

### Vitest (MCP tools + demo server)

```bash
cd mcp && npm test
```

**101 tests** covering:
- Vault tools: register_user_address, get_user_address, encode_admin_tx, transfer_vault_admin, create_invoice, check_invoice_status
- Demo server: mockEthPrice/mockArcStats data shape & ranges, /health endpoint, paid routes with x402 bypass, 402 gate verification

### Run all tests

```bash
# Solidity
cd contracts && forge test

# TypeScript
cd mcp && npm test
```

**Total: 144 tests** (43 Solidity + 101 Vitest)

---

## Quick Smoke Test Checklist

Minimum viable test after deploy — run these 5 checks:

| # | Test | Command | Pass |
|---|------|---------|------|
| 1 | Bot responds | Send `/start` in Telegram | [ ] |
| 2 | Balance works | Send `баланс` | [ ] |
| 3 | Vault status | Send `статус хранилища` | [ ] |
| 4 | Rebalancer | `bash agent/skills/arc-rebalancer/scripts/rebalance.sh` | [ ] |
| 5 | x402 (if demo-server up) | `bash agent/skills/arc-x402/scripts/x402_fetch.sh http://localhost:4402/eth-price` | [ ] |

If all 5 pass — OTTO is operational.
