# OTTO Security & OTTOVault Architecture

## Table of Contents

1. [Threat Model](#threat-model)
2. [Permission Tiers](#permission-tiers)
3. [OTTOVault Contract](#ottovault-contract)
4. [User Ownership Model](#user-ownership-model)
5. [Tier 3 — On-chain Signing Flow](#tier-3--on-chain-signing-flow)
6. [Invoice / Compliance System](#invoice--compliance-system)
7. [Deployed Addresses](#deployed-addresses)
8. [Security Properties Summary](#security-properties-summary)

---

## Threat Model

OTTO controls real USDC. The threats being defended against:

| Threat | Mitigation |
|--------|-----------|
| Compromised AI prompt (jailbreak) | Spending limits enforced in EVM bytecode — no LLM output can override |
| Unauthorized Telegram access | OpenClaw Telegram user ID pairing — only paired users send commands |
| OTTO wallet compromise | Agent role is limited to `transfer()` within caps; admin functions require a separate key |
| Runaway AI spending | Per-tx cap + daily cap, revert on any violation, no exceptions |
| Unauthorized incoming deposit | Invoice system — expected amount + sender tracked off-chain |
| Admin key compromise | Admin is the user's own MetaMask/hardware wallet, never stored in OTTO |

---

## Permission Tiers

```
┌───────────────────────────────────────────────────────────────┐
│  Tier 1 — Telegram auth only                                  │
│  ─────────────────────────────────────────────────────────── │
│  ✓ Read balances, vault status, tx history                    │
│  ✓ x402 auto-pay (< 0.01 USDC, no confirmation needed)        │
│  ✓ Deploy personal vault (OTTO pays gas)                      │
│                                                               │
│  Tier 2 — Telegram auth + explicit "да / yes"                 │
│  ─────────────────────────────────────────────────────────── │
│  ✓ vault_transfer (any amount > 1 USDC)                       │
│  ✓ vault_deposit (agent wallet → vault)                       │
│  ✓ Cross-chain bridge via Circle Gateway                      │
│  ✓ Batch payroll transfers                                    │
│                                                               │
│  Tier 3 — User's own ETH wallet signature (on-chain tx)       │
│  ─────────────────────────────────────────────────────────── │
│  ✗ setLimits       — change per-tx or daily caps              │
│  ✗ setWhitelist / setWhitelistEnabled                         │
│  ✗ setPaused       — emergency halt                           │
│  ✗ setAgent        — replace OTTO as agent                    │
│  ✗ transferAdmin   — hand off vault ownership                 │
│  ✗ withdraw        — emergency bypass of limits               │
│                                                               │
│  OTTO cannot execute Tier 3 ops. Period.                      │
└───────────────────────────────────────────────────────────────┘
```

**Why Tier 3 is safe:** `onlyAdmin` in `OTTOVault.sol` checks `msg.sender == admin`. OTTO's agent address ≠ admin address. Even if OTTO is told "change limits to 999999", the transaction would revert with `NotAdmin()`. Executing admin functions requires a transaction signed by the private key of the registered admin address — which is the user's MetaMask/hardware wallet, never stored in OTTO.

---

## OTTOVault Contract

**Source:** [`contracts/src/OTTOVault.sol`](../contracts/src/OTTOVault.sol)

### Roles

```
             ADMIN (user's MetaMask wallet)
             │
             ├─ setLimits(maxPerTx, dailyLimit)
             ├─ setWhitelist(addr, bool)
             ├─ setWhitelistEnabled(bool)
             ├─ setPaused(bool)
             ├─ setAgent(newAgent)
             ├─ transferAdmin(newAdmin)
             └─ withdraw(amount)        ← bypasses all limits

             AGENT (OTTO wallet — 0xA9A48d73...)
             │
             └─ transfer(to, amount)   ← only within limits
```

### `transfer()` — What OTTO can do

```solidity
function transfer(address to, uint256 amount)
    external
    onlyAgent     // only OTTO wallet
    notPaused     // admin can halt at any time
    nonReentrant
```

Checks executed in order — any failure reverts the entire tx:

| # | Check | Error |
|---|-------|-------|
| 1 | `amount > maxPerTx` | `ExceedsPerTxLimit` |
| 2 | `dailySpent + amount > dailyLimit` | `ExceedsDailyLimit` |
| 3 | `whitelistEnabled && !whitelist[to]` | `RecipientNotWhitelisted` |
| 4 | `usdc.balanceOf(vault) < amount` | `InsufficientVaultBalance` |

**Daily window resets automatically** every 24 h based on `block.timestamp`. No manual reset needed.

### `canTransfer()` — Pre-flight check

OTTO always calls `canTransfer()` before submitting a `transfer()` tx. Returns `(bool ok, string reason)`. If `ok == false`, OTTO shows the reason and does not send the transaction — saves gas and gives a clear error before anything happens on-chain.

### Events — full on-chain audit trail

```
Deposit(from, amount)
AgentTransfer(to, amount, dailySpentAfter)
AdminWithdraw(to, amount)
LimitsUpdated(maxPerTx, dailyLimit)
WhitelistUpdated(addr, allowed)
WhitelistToggled(enabled)
AgentUpdated(newAgent)
AdminTransferred(newAdmin)
VaultPaused(paused)
DailyWindowReset(newWindowStart)
```

### `status()` — Single-call snapshot

Returns everything in one RPC call (no multicall needed):

| Field | Description |
|-------|-------------|
| `balance_` | USDC currently in vault |
| `maxPerTx_` | Per-tx spending cap |
| `dailyLimit_` | Daily cumulative cap |
| `dailySpent_` | Spent today (0 if window expired) |
| `remainingToday_` | How much OTTO can still spend today |
| `whitelistEnabled_` | Whether whitelist is enforced |
| `paused_` | Emergency halt state |
| `agent_` | Current agent address |
| `admin_` | Current admin address |

---

## User Ownership Model

### The custodianship problem

Old design: `admin = OTTO wallet`. OTTO could call `setLimits(999999, 999999)` on itself, then drain the vault. Fully custodial — no user protection.

### Two-role design

```
Deploy vault
     │
     ├─ User has registered ETH address:
     │    admin = user's MetaMask wallet   ← user has on-chain control
     │    agent = OTTO wallet              ← limited to transfer() within caps
     │    (transferAdmin called automatically right after deployment)
     │
     └─ User has NOT registered:
          admin = OTTO wallet              ← custodial (temporary)
          agent = OTTO wallet
          → user can claim later via transfer_vault_admin
```

### Registration flow

```
1. User: /setaddress 0xYourMetaMaskWallet

2. OTTO calls: register_user_address({ user_id, eth_address })
   Validates with viem isAddress(), normalizes to EIP-55 checksum
   Stored: ~/.otto/users.json
   { "97729005": { "eth_address": "0xYourChecksummedAddress" } }

3. Next vault deployment (deploy_user_vault):
   - OTTO deploys vault  (msg.sender = OTTO → admin = OTTO temporarily)
   - OTTO immediately calls vault.transferAdmin(userEthAddr)
   - userEthAddr is now admin permanently
   - OTTO retains only the agent role

4. Existing custodial vault (transfer_vault_admin):
   - User: "перевести управление"
   - OTTO checks: status()[8] == OTTO wallet  (readContract)
   - OTTO calls:  vault.transferAdmin(userEthAddr)
   - OTTO permanently loses admin rights
```

### What OTTO can and cannot do after admin transfer

| Action | OTTO | User |
|--------|------|------|
| `transfer(to, amount)` within caps | ✅ | — |
| `setLimits` | ❌ `NotAdmin` | ✅ via signing page |
| `setWhitelist` | ❌ `NotAdmin` | ✅ via signing page |
| `setPaused` | ❌ `NotAdmin` | ✅ via signing page |
| `setAgent` | ❌ `NotAdmin` | ✅ via signing page |
| `withdraw` | ❌ `NotAdmin` | ✅ via signing page |

No prompt injection, no jailbreak, no social engineering changes this. The contract does not know what the AI said — it only checks `msg.sender`.

---

## Tier 3 — On-chain Signing Flow

When a user requests an admin operation (e.g. "increase limit to 50 USDC per tx"):

```
User: "увеличь лимит до 50 USDC"
        │
        ▼
OTTO: encode_admin_tx({
  function: "setLimits",
  max_per_tx_usdc: 50,
  daily_limit_usdc: 500
})
        │
        ▼
Returns (no network call made, pure ABI encoding):
{
  "function":     "setLimits",
  "description":  "Set per-tx limit to 50 USDC, daily limit to 500 USDC",
  "to":           "0xVaultAddress",
  "data":         "0x6b3765a3...",
  "chain":        "arcTestnet",
  "chainId":      5042002,
  "signing_url":  "https://ottoarc.xyz/sign?to=0xVault...&data=0x6b...&chainId=5042002&desc=..."
}
        │
        ▼
OTTO shows signing_url as a clickable link (raw calldata never shown to user)

User opens https://ottoarc.xyz/sign?...
        │
        ▼
Signing page (arc-multichain-wallet/app/sign/page.tsx):
  1. Connect admin wallet → MetaMask / Rabby / Frame
  2. Auto-add Arc Testnet if missing  (wallet_addEthereumChain on 4902 error)
  3. Switch chain                      (wallet_switchEthereumChain)
  4. Send tx: eth_sendTransaction({ to, data, chainId })
  5. Show tx hash + block explorer link

Transaction hits OTTOVault.setLimits()
  → onlyAdmin: msg.sender == admin ✓
  → limits updated
  → LimitsUpdated event emitted
```

The signing page uses raw `window.ethereum` (EIP-1193) — no wagmi config required, works with any browser wallet.

### Admin functions available via `encode_admin_tx`

| Function | Parameters | Effect |
|----------|-----------|--------|
| `setLimits` | `max_per_tx_usdc`, `daily_limit_usdc` | Change spending caps |
| `setWhitelist` | `address`, `allowed: bool` | Add / remove recipient |
| `setWhitelistEnabled` | `enabled: bool` | Toggle whitelist enforcement |
| `setPaused` | `paused: bool` | Emergency halt / resume |
| `setAgent` | `new_address` | Replace OTTO with another agent |
| `transferAdmin` | `new_address` | Hand off admin to another wallet |
| `withdraw` | `amount_usdc` | Emergency drain (bypasses all limits) |

---

## Invoice / Compliance System

### Problem

`deposit()` on OTTOVault is public — anyone can push USDC into any vault at any time. No approval required. For regulated treasury management this is unacceptable.

### Solution: off-chain invoice tracking

```
create_invoice({
  expected_amount_usdc: 100,
  user_id: "97729005",           // resolves to their vault address
  expected_sender: "0xPayer",   // optional — any sender accepted if omitted
  expires_hours: 24              // default 24 h
})
```

Captures current vault balance as a baseline, stores invoice in `~/.otto/invoices.json`:

```json
{
  "INV-1709120000-A3F2B1": {
    "vault_address": "0xVault...",
    "chain": "arcTestnet",
    "expected_amount_usdc": 100,
    "initial_vault_balance_usdc": 50,
    "expires_at": "2024-02-29T14:00:00.000Z",
    "status": "pending"
  }
}
```

### Status detection

```
check_invoice_status({ invoice_id: "INV-..." })

→ readContract(vault.status())  → current balance
→ increase = current_balance − initial_balance
→ increase ≥ expected_amount − 0.0001  →  status = "paid"
→ now > expires_at && still pending    →  status = "expired"
```

Detection requires only balance polling — no tx parsing, no event subscriptions, no sender verification needed.

---

## Deployed Addresses

### OTTOVaultV2 Infrastructure (Arc Testnet, chainId 5042002)

| Contract | Address |
|----------|---------|
| OTTOVaultFactoryV2 | `0x9edebee1DfEd0E2727A1Ec64cbB4814A3AEaceCe` |
| OTTORegistry | `0xbACA262d37A956651E3b35271AF76Bb4eDfc1e67` |
| OTTOTokenDeployer | `0x1A0D1670405B1F193F384C51647a0b4026D0c34b` |
| OTTOGovernorDeployer | `0x871030f39f386930F3BF951d70371816e9C8b1bd` |
| OTTOVaultDeployer | `0x07f135206cb3a3a3140e1baBa0953a41214A9825` |

Per-user vaults deployed via `factory.deploy()`. Default limits: **10 USDC / tx · 100 USDC / day**
Governance: shareholders hold ShareToken, govern via Governor proposals.

### OTTO Agent Wallet

`0xA9A48d73F67B0c820fDE57c8b0639C6F850AE96e` — holds x402 payer funds, pays gas for vault deployments, acts as `agent` in all vaults.

### User vaults

Deployed on demand via `deploy_user_vault`. Indexed locally in `~/.otto/user-vaults.json`:

```json
{ "97729005": { "arcTestnet": "0x<vault_addr>" } }
```

### Signing page

`https://ottoarc.xyz/sign?to=&data=&chainId=&desc=`
Handles MetaMask connect → chain switch → Tier 3 tx broadcast.

---

## Local Registry Files

| File | Contents |
|------|---------|
| `~/.otto/users.json` | `{ user_id → { eth_address } }` |
| `~/.otto/user-vaults.json` | `{ user_id → { chain → vault_address } }` |
| `~/.otto/invoices.json` | `{ invoice_id → Invoice }` |

Local files are an index/cache. On-chain contract state is always the source of truth.

---

## Security Properties Summary

| Property | Mechanism | Location |
|----------|-----------|---------|
| Agent can't exceed per-tx limit | `if (amount > maxPerTx) revert` | `OTTOVault.sol:156` |
| Agent can't exceed daily limit | `if (dailySpent + amount > dailyLimit) revert` | `OTTOVault.sol:161` |
| Agent can't send to unknown addresses | `if (whitelistEnabled && !whitelist[to]) revert` | `OTTOVault.sol:167` |
| Agent blocked when paused | `modifier notPaused` | `OTTOVault.sol:96` |
| Admin functions require user key | `modifier onlyAdmin` checks `msg.sender` | `OTTOVault.sol:86` |
| No reentrancy | `ReentrancyGuard` (OpenZeppelin) | `OTTOVault.sol:28` |
| Telegram commands require pairing | OpenClaw user ID verification | OpenClaw framework |
| OTTO never holds admin keys | Admin key = user's MetaMask, never in `.env` | Architecture |
| Limits survive AI compromise | Enforced in EVM bytecode, not runtime config | Contract deployment |
