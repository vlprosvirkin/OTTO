# OTTO — Autonomous AI Treasury Agent on Arc

> **Encode × Arc Enterprise & DeFi Hackathon submission**
> Tracks: Agentic Commerce (primary) · Chain Abstracted USDC · Global Payouts

---

## The Problem

Cross-chain treasury management today requires constant human attention:
- Someone monitors USDC balances across multiple chains
- Someone triggers transfers when liquidity runs low
- Someone pays for each external data feed or API manually
- Someone handles payroll, running through addresses one by one

This is brittle, slow, and doesn't scale. Every step requires a human to open a wallet, approve a transaction, pay gas, and wait.

**The question is not whether AI agents will manage treasuries. The question is which infrastructure makes it possible today.**

---

## The Answer: OTTO

**OTTO** is a Claude-powered AI agent that autonomously manages a multi-chain USDC treasury.

It monitors balances, moves funds cross-chain via Circle Gateway, pays for external services using the x402 nanopayment protocol, executes payroll runs, and reports every action to the team over Telegram — all without human intervention.

```
Human: "Rebalance the treasury and pay the team"

Agent: checks balances on Arc Testnet, Base Sepolia, Avalanche Fuji
       → moves 15 USDC from Base to Arc (liquidity low)
       → fetches ETH/USD price feed (pays 0.001 USDC via x402, auto)
       → sends: Alice 10 USDC, Bob 15 USDC, Carol 5 USDC
       → posts summary to Telegram

Done. Zero manual steps. Zero gas fees.
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     User Interface                               │
│              Telegram Bot  ·  CLI  ·  Web (future)               │
└───────────────────────────────┬──────────────────────────────────┘
                                │ natural language command
┌───────────────────────────────▼──────────────────────────────────┐
│                  OTTO Agent Framework                        │
│                                                                  │
│  ┌─────────────────┐    ┌────────────────────────────────────┐   │
│  │   agent.md      │    │         openclaw.json              │   │
│  │   Role, rules,  │    │  provider: Claude (Anthropic)      │   │
│  │   chain ref,    │    │  channel:  Telegram                │   │
│  │   tool docs     │    │  skills:   arc-balance, arc-wallet │   │
│  └─────────────────┘    │            arc-transfer, arc-x402  │   │
│                         └────────────────────────────────────┘   │
│                                                                  │
│  Skill Scripts (bash):                                           │
│  arc-balance  ·  arc-wallet  ·  arc-transfer                     │
│  arc-gateway  ·  arc-x402  ·  arc-vault 🔒                       │
└───────────────────────────────┬──────────────────────────────────┘
                                │ tsx invoke.ts <tool> <args>
┌───────────────────────────────▼──────────────────────────────────┐
│                    arc-wallet-mcp                                │
│              MCP Server (Model Context Protocol)                 │
│                                                                  │
│  ┌──────────────┬──────────────┬─────────────┬────────────────┐  │
│  │   balance    │   wallet     │  transfer   │  vault 🔒      │  │
│  │              │              │             │                │  │
│  │ get_usdc_    │ create_      │ transfer_   │ vault_status   │  │
│  │ balance      │ wallet_set   │ usdc_       │                │  │
│  │              │              │ custodial   │ vault_transfer │  │
│  │ get_gateway_ │ create_      │             │                │  │
│  │ balance      │ multichain_  │ transfer_   │ vault_can_     │  │
│  │              │ wallet       │ usdc_eoa    │ transfer       │  │
│  │ check_wallet │              │             │                │  │
│  │ _gas         │ get_wallet_  │ deposit_    ├────────────────┤  │
│  │              │ info         │ usdc        │     x402 ✨    │  │
│  │              │              │             │                │  │
│  │              │ get_user_    │ withdraw_   │ x402_fetch     │  │
│  │              │ wallets      │ usdc        │                │  │
│  │              │              │             │ x402_payer_    │  │
│  │              │ get_eoa_     │ get_        │ info           │  │
│  │              │ wallets      │ transfer_   │                │  │
│  │              │              │ status      │                │  │
│  └──────────────┴──────────────┴─────────────┴────────────────┘  │
└──────────┬────────────────────────────┬────────────────┬─────────┘
           │                            │                │
┌──────────▼──────────┐  ┌─────────────▼──────┐  ┌──────▼──────────┐
│  Circle Developer   │  │  Circle Gateway    │  │  x402 Server    │
│  Controlled Wallets │  │  Cross-chain USDC  │  │  (demo oracle)  │
│  SCA + EOA          │  │  unified balance   │  │  HTTP 402 →     │
│  Custodial          │  │  burn/mint bridge  │  │  auto USDC pay  │
└─────────────────────┘  └────────────────────┘  └─────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────┐
│                  OTTOVaultV2 🔒 (Arc Testnet)                     │
│  Factory · 0x9edebee1DfEd0E2727A1Ec64cbB4814A3AEaceCe             │
│                                                                  │
│  Holds org USDC · Per-tx cap: 10 USDC · Daily cap: 100 USDC    │
│  Agent role enforced on-chain · Whitelist · Emergency pause     │
│  No prompt can override these limits — the EVM enforces them    │
└─────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼──────────────┐
               ┌────▼────┐  ┌────▼──────┐  ┌────▼──────────┐
               │   Arc   │  │   Base    │  │  Avalanche    │
               │ Testnet │  │ Sepolia   │  │    Fuji       │
               │ 5042002 │  │  84532    │  │   43113       │
               └─────────┘  └───────────┘  └───────────────┘
```

---

## Technology Stack

### Claude + OTTO Agent Framework

Claude (Anthropic) is the reasoning engine. OTTO is a lightweight agent framework that gives Claude a persistent identity (`agent.md`), a set of executable skills (bash scripts), and channels to communicate through (Telegram, CLI).

The agent reads `agent.md` at startup to know its role, rules, and available tools. When it decides to call a tool, it runs the corresponding bash script, which calls `invoke.ts` — a CLI bridge into the MCP server.

### MCP — Model Context Protocol

MCP is Anthropic's open protocol for connecting AI agents to tools and data sources. `arc-wallet-mcp` is our custom MCP server that wraps Circle's APIs and exposes them as typed, documented tools the agent can call.

Each tool has:
- A name and description (in natural language, for Claude)
- A typed input schema (Zod validation)
- A handler that calls the real Circle/blockchain API

This means Claude can call `transfer_usdc_custodial` the same way it would call any function — with type safety and structured outputs.

### Circle Developer Controlled Wallets

Circle DCW provides two wallet types:
- **SCA (Smart Contract Account)** — the primary multi-chain wallet; Circle manages signing, no gas needed for most operations
- **EOA (Externally Owned Account)** — used as the on-chain signer for Gateway operations requiring a direct signature

The agent creates and manages wallets via the Circle API, never exposing private keys. All signing happens inside Circle's infrastructure.

### Circle Gateway — Cross-chain USDC

Gateway is Circle's liquidity protocol that unifies USDC across chains. Instead of bridging (which is slow and expensive), Gateway uses a burn-and-mint model with off-chain attestation:

```
Deposit USDC → Gateway contract (Arc Testnet)
  → unified balance available across all chains
  → burn on source chain + mint on destination chain
  → no gas, settlement via Circle attestation service
```

The agent uses this to move USDC freely between Arc Testnet, Base Sepolia, and Avalanche Fuji.

### OTTOVault — On-Chain Spending Limits

OTTOVault is a custom Solidity contract that holds organizational USDC and exposes a restricted `agent` role. The AI agent can only call `transfer()` — and only within hard limits set by the admin:

```
Per-tx cap:  10 USDC  (single transfer max)
Daily cap:   100 USDC (rolling 24h window, auto-resets)
Whitelist:   optional — restrict to approved recipient addresses
Pause:       admin can halt all agent operations immediately
```

These limits are enforced at the EVM level. No instruction, no prompt injection, no AI compromise can override them — the blockchain rejects the transaction before USDC moves.

```
Deployed on Arc Testnet (verified):
  Factory:          0x9edebee1DfEd0E2727A1Ec64cbB4814A3AEaceCe
  Registry:         0xbACA262d37A956651E3b35271AF76Bb4eDfc1e67
  TokenDeployer:    0x1A0D1670405B1F193F384C51647a0b4026D0c34b
  GovernorDeployer: 0x871030f39f386930F3BF951d70371816e9C8b1bd
  VaultDeployer:    0x07f135206cb3a3a3140e1baBa0953a41214A9825
Stack:    Solidity 0.8.20 + OpenZeppelin + Foundry
Tests:    43 Solidity + 101 vitest = 144 total, all passing
```

The agent calls `vault_status` to check available allowance, `vault_can_transfer` to preview a transfer, and `vault_transfer` to execute it — all via MCP tools wired through `invoke.ts`.

### x402 — HTTP Nanopayments for AI Agents

x402 is an extension of the classic HTTP 402 "Payment Required" status code. When an API requires payment:

1. Client sends a normal HTTP request
2. Server responds `402 Payment Required` with a payment payload (amount, currency, recipient, chain)
3. Client signs an EIP-3009 `transferWithAuthorization` (gasless USDC transfer)
4. Client resends the request with the signed payment in the header
5. Server verifies and fulfills the request

For a human, this would require opening MetaMask. For OTTO, it's **invisible** — the `x402_fetch` tool handles the entire payment loop automatically.

```typescript
// What happens inside x402_fetch:
const paymentFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:*", client: new ExactEvmScheme(signer) }],
});
// Now paymentFetch auto-pays any 402 response before returning
const response = await paymentFetch("https://oracle/eth-price");
```

The agent's payer wallet (`0xA9A4...Ae96e`) holds USDC on Arc Testnet and pays for services using EIP-3009 authorization signatures — no gas required.

---

## MCP Tools Catalog

| Tool | Description |
|------|-------------|
| `get_usdc_balance` | On-chain USDC balance for any address on any chain |
| `get_gateway_balance` | Unified Circle Gateway balance across all chains |
| `check_wallet_gas` | Native token (gas) balance for a wallet |
| `get_gateway_info` | Gateway contract addresses and configuration |
| `get_supported_chains` | All chains supported by Circle Gateway |
| `get_transfer_status` | Status of a cross-chain Gateway transfer |
| `create_wallet_set` | Create a new Circle wallet set |
| `create_multichain_wallet` | Create SCA wallets on all supported chains |
| `get_wallet_info` | Full wallet details (address, chain, status) |
| `get_user_wallets` | All wallets belonging to a user |
| `get_eoa_wallets` | EOA signer wallets for a user |
| `init_eoa_wallet` | Initialize a new EOA signer on a chain |
| `get_transaction_history` | Transaction history with optional type filter |
| `deposit_usdc` | Deposit USDC into Circle Gateway |
| `withdraw_usdc` | Withdraw USDC from Circle Gateway |
| `transfer_usdc_custodial` | Cross-chain transfer using custodial wallet |
| `transfer_usdc_eoa` | Cross-chain transfer using EOA signature |
| `execute_gateway_mint` | Execute mint after cross-chain attestation |
| `x402_fetch` ✨ | HTTP request with automatic x402 USDC payment |
| `x402_payer_info` ✨ | Agent payer wallet address and USDC balances |
| `vault_status` 🔒 | Full OTTOVault state: balance, limits, agent, admin |
| `vault_transfer` 🔒 | Transfer USDC from vault within on-chain enforced limits |
| `vault_can_transfer` 🔒 | Preview: would transfer succeed? (no transaction sent) |
| `vault_deposit` 🔒 | Top up vault from agent wallet (approve + deposit) |
| `deploy_user_vault` 🔒 | Deploy personal OTTOVault for a Telegram user |
| `get_user_vault` 🔒 | Look up vault address(es) for a user |
| `register_user_address` 🔒 | Register user's ETH wallet for vault admin ownership |
| `get_user_address` 🔒 | Look up registered ETH address for a user |
| `transfer_vault_admin` 🔒 | Transfer vault admin from OTTO to user's wallet |
| `encode_admin_tx` 🔒 | Encode calldata for Tier 3 admin ops (user signs via signing page) |
| `create_invoice` 🔒 | Create compliance invoice for expected incoming payment |
| `check_invoice_status` 🔒 | Check if invoice has been paid (balance comparison) |
| `rebalance_check` 🔄 | Check vault balances on all chains, report health + shortfall |

---

## Demo Scenarios

### 1. Autonomous API Payment via x402

The flagship demo. The agent fetches a price feed that costs money — and pays for it automatically.

```
User → Telegram: "What's the current ETH price?"

Agent:
  → calls x402_fetch("https://demo-oracle.arc.dev/eth-price")
  ← HTTP 402: { amount: "0.001", currency: "USDC", chain: "eip155:84532" }
  → signs EIP-3009 transferWithAuthorization (from payer wallet)
  → retries with X-PAYMENT header
  ← HTTP 200: { price: 2847.42, source: "chainlink", timestamp: ... }
  → "ETH price: $2,847.42 ✅  Paid 0.001 USDC (receipt: 0xabc...)"
```

No gas. No approval popups. No human action. Just USDC flowing to where data comes from.

### 2. Cross-chain Liquidity Rebalancer

The agent monitors treasury balances and moves funds when thresholds are crossed.

```
User → Telegram: "Keep at least 5 USDC on Arc Testnet at all times"

Agent (on schedule or trigger):
  → get_usdc_balance(arcTestnet, wallet) → 1.2 USDC (below threshold)
  → get_gateway_balance(wallet) → 18.5 USDC total
  → transfer_usdc_custodial(baseSepolia → arcTestnet, 5 USDC)
  → get_transfer_status(transfer_id) → "confirmed"
  → Telegram: "Rebalanced ✅ Moved 5 USDC Base→Arc. New balance: 6.2 USDC"
```

### 3. Team Payroll

The agent processes a payroll list and executes multiple transfers.

```
User → Telegram: "Pay the team: Alice 10 USDC, Bob 15 USDC, Carol 5 USDC"

Agent:
  → get_gateway_balance(treasury) → 38 USDC ✓ sufficient
  → "Confirm: send 30 USDC total to 3 recipients?" → User: "yes"
  → transfer_usdc_eoa(→ Alice: 10 USDC)  ✅
  → transfer_usdc_eoa(→ Bob: 15 USDC)    ✅
  → transfer_usdc_eoa(→ Carol: 5 USDC)   ✅
  → Telegram: "Payroll complete. 30 USDC sent. Remaining: 8 USDC."
```

---

## Use Cases

### Remote Team Payroll
A DAO or startup pays contributors in USDC across multiple chains every two weeks. Today this means someone opens a wallet, pastes addresses, approves one transaction at a time, pays gas, and waits. With OTTO: the CFO sends one Telegram message, OTTO confirms the total, and runs all transfers in sequence — with a receipt for each one.

> "Pay Alice 200 USDC on Arc, Bob 150 USDC on Base Sepolia, Carol 75 USDC on Arc."
> OTTO: executed in 3 transactions. No wallet open. No gas. Full log in Telegram.

### Autonomous Liquidity Management
A protocol has smart contract vaults on Arc Testnet and Base Sepolia. When one vault runs low, the team manually bridges funds — which is slow and error-prone. With OTTO: set a threshold once, and the agent continuously monitors balances, moving liquidity the moment a chain drops below the minimum. The team wakes up to a Telegram notification, not a broken vault.

### Agent-to-Agent API Economy (x402)
An AI trading agent needs real-time price data from a premium oracle. Today this requires a subscription, API key management, and manual renewal. With OTTO + x402: the agent pays per-query in USDC, automatically, with no subscription or human approval. The oracle gets paid instantly. The agent gets data instantly. No intermediary.

> This is the **new economic primitive** for AI agents: machines paying machines, in USDC, over HTTP. OTTO is the first treasury agent built around it.

### Vendor Payments & Subscriptions
A web3 company uses several x402-enabled SaaS tools — analytics, risk scoring, compliance checks. Instead of managing API keys and credit cards for each, the CFO configures OTTO with monthly spending limits per vendor. OTTO pays each tool automatically per-use, tracks spend against budget, and alerts when a vendor approaches its limit.

### Treasury Reporting on Demand
The team lead asks for a snapshot of the treasury at any time — mid-meeting, from a phone. OTTO responds in seconds with balances across all chains, recent inflows/outflows, and a summary of x402 payments made. No dashboard login. No spreadsheet. Just a Telegram message.

---

## Why This Matters

**Treasuries don't sleep.** Chains don't pause for timezones. A custodial wallet sitting idle on one chain while another runs dry is a risk and an opportunity cost — but checking and rebalancing manually is not scalable.

**AI agents are about to manage real money.** The question is not whether to give agents financial autonomy — it's how to do it safely. OTTO's answer: give the agent a clearly defined role, a set of tools with known capabilities, and smart contract-level limits that no instruction can override.

**x402 makes agentic commerce real.** Every AI pipeline that touches data, APIs, or compute eventually hits a payment wall. Today that wall stops agents cold — a human has to step in with a credit card. x402 + OTTO removes that wall: the agent pays, continues, and reports. This is how AI systems become genuinely autonomous.

---

## Security Architecture

### The Core Principle: Trust the Contract, Not the Agent

OTTO is designed on one fundamental assumption: **the AI can make mistakes, but the smart contract cannot be overridden.** Every financial limit is enforced on-chain, not in the agent's prompt.

```
┌─────────────────────────────────────────────────────┐
│                  OTTO (Claude)                       │
│  "Transfer 50,000 USDC"  ← can ask anything         │
└───────────────────────────────┬─────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────┐
│    OTTOVaultV2 (Factory · Arc Testnet · 0x9ede...)    │
│                                                      │
│  Per-transaction limit:    ≤ 10 USDC   ✗ BLOCKED    │
│  Daily spend limit:        ≤ 100 USDC (24h window)  │
│  Whitelisted recipients:   optional allowlist        │
│  Agent role:               enforced — 1 address only │
│  Emergency pause:          admin halts all transfers │
└─────────────────────────────────────────────────────┘
```

Even if the agent's reasoning is manipulated or the prompt is compromised, the transaction will be **rejected at the contract level** before any USDC moves. The rules are not in the AI — they are in the blockchain.

### Layered Security Model

**Layer 1 — OTTOVault (Custom Solidity Contract, deployed)**
OTTOVault is a custom treasury contract deployed on Arc Testnet. It holds organizational USDC and exposes a restricted `agent` role:
- Per-transaction cap: max 10 USDC per transfer (configurable)
- Daily cumulative limit: max 100 USDC / 24h rolling window (auto-resets)
- Whitelist: optional — agent can only send to admin-approved addresses
- Pause: admin can halt all agent operations instantly
- Emergency withdraw: admin can always pull funds out regardless

These rules are enforced by Solidity + the EVM. No instruction, no prompt, no social engineering overrides them. **The blockchain rejects non-conforming transactions.**

**Layer 2 — Agent Rules (agent.md)**
The agent's behavior is governed by its system prompt (`agent.md`):
- Explicit confirmation required for any transfer > 1 USDC
- No execution without user approval ("да" / "yes")
- x402 auto-pay only for amounts < 0.01 USDC
- Private keys and API keys never exposed in output

**Layer 3 — x402 Payer Wallet (Minimal Exposure)**
The x402 payer wallet is a separate EOA funded with a small working balance (e.g., 5–20 USDC). It is:
- Isolated from main treasury wallets
- Used exclusively for micro-payments (< 0.01 USDC per call)
- Easily replaceable — if compromised, the main treasury is unaffected
- Monitored by the agent itself via `x402_payer_info`

**Layer 4 — Circle DCW (No Key Custody)**
For all treasury operations, private keys never leave Circle's infrastructure. The agent calls Circle's API — it cannot extract or export keys. This eliminates the largest attack surface in crypto: stolen private keys.

### What the Agent Can and Cannot Do

| Action | Agent Can Do | Requires |
|--------|-------------|---------|
| Check balances | ✅ Always | — |
| Fetch x402 data | ✅ Auto | < 0.01 USDC in payer wallet |
| Vault transfer ≤ 10 USDC | ✅ With confirmation | User "да/yes" + within per-tx cap |
| Vault transfer > 10 USDC | ❌ Blocked | Contract rejects (per-tx limit) |
| Vault spend > 100 USDC/day | ❌ Blocked | Contract rejects (daily cap) |
| Send to unknown address | ❌ Blocked | Whitelist enabled — contract rejects |
| Change limits / pause / withdraw | ❌ Cannot | Requires admin wallet signature (Tier 3) |
| Export private keys | ❌ Impossible | Circle DCW — keys never leave Circle |
| Exceed daily limit | ❌ Blocked | Contract enforces cumulative cap |

### Organizational Policy as Code

OTTO's spending rules are not a trust relationship — they are **code on a blockchain**. The admin sets limits once via the OTTOVault contract, and those limits become immutable constraints that survive any AI compromise:

```solidity
// OTTOVault enforces these at the EVM level:
maxPerTx:         10 USDC   // single transfer cap
dailyLimit:       100 USDC  // cumulative 24h window
whitelistEnabled: true      // only approved recipients
paused:           false     // admin can halt instantly
```

The admin (user's MetaMask wallet) controls limits via Tier 3 signing — OTTO cannot change them. Any instruction to OTTO — whether from a legitimate user, a compromised Telegram account, or a prompt injection attack — that exceeds these parameters will fail at the contract layer. Not because the agent refuses, but because the blockchain refuses.

---

## What's Built vs What's Needed

| Component | Status | Notes |
|-----------|--------|-------|
| `arc-wallet-mcp` — full MCP server | ✅ Built | 29 tools across 7 modules |
| `x402_fetch` + `x402_payer_info` tools | ✅ Built | Auto-pay on HTTP 402 |
| x402 payer wallet (funded) | ✅ Ready | 20 USDC on Arc Testnet |
| OTTO agent framework | ✅ Built | Claude (Anthropic), Telegram, bash skills |
| All bash skill scripts | ✅ Built | 7 skills, 29 scripts: arc-balance, arc-wallet, arc-transfer, arc-gateway, arc-x402, arc-vault, arc-rebalancer |
| `invoke.ts` CLI bridge | ✅ Built | Dynamic imports, all 29 tools wired |
| **OTTOVault smart contract** | ✅ Deployed | All 3 chains · 43 Solidity tests + 101 vitest = 144 total |
| **Vault tools** (status, transfer, can_transfer, deposit) | ✅ Built | MCP tools + bash skills |
| **User ownership** (register_address, transfer_admin, encode_admin_tx) | ✅ Built | Tier 3 signing flow via ottoarc.xyz |
| **Invoice / compliance** (create_invoice, check_invoice_status) | ✅ Built | Off-chain tracking with on-chain balance verification |
| Demo x402 oracle server | ✅ Built | Express, 3 endpoints (health, eth-price, arc-stats) |
| Rebalancer skill | ✅ Built | Cross-chain vault monitoring + auto-rebalance via heartbeat |
| Contract verification | ✅ Verified | Arc Testnet, Base Sepolia, Avalanche Fuji |
| CI/CD auto-deploy | ✅ Built | GitHub Actions → GCP via SSH + Telegram notifications |

---

## Why Arc + Circle

**Arc** is purpose-built for institutional USDC: fast finality, Circle-native settlement, and direct Gateway integration. There is no bridging overhead, no wrapped tokens, no liquidity fragmentation.

**Circle Gateway** enables something unique: a single unified USDC balance that spans multiple chains. The agent doesn't need to think about which chain to use — it just moves value where it's needed.

**Circle DCW** removes the key management problem entirely. The agent operates wallets through Circle's API without ever holding private keys — except for the dedicated x402 payer wallet, which is a minimal-risk EOA funded with a small working balance.

**x402** is the missing protocol layer for agentic commerce. Today, every AI agent that wants to access paid APIs needs a human to approve each payment. x402 eliminates that — the agent signs EIP-3009 authorizations programmatically, with no gas and no human in the loop.

Together, these form a complete stack for autonomous treasury management.

---

## Repository Structure

```
OTTO/                        # GitHub monorepo: vlprosvirkin/OTTO
├── mcp/                     # MCP server — Circle API + vault tools
│   └── src/tools/
│       ├── balance.ts       # get_usdc_balance, get_gateway_balance
│       ├── wallet.ts        # create_wallet_set, create_multichain_wallet, ...
│       ├── transfer.ts      # transfer_usdc_custodial, transfer_usdc_eoa, ...
│       ├── deposit.ts       # deposit_usdc, withdraw_usdc
│       ├── gateway.ts       # get_gateway_info, get_supported_chains, ...
│       ├── x402.ts          # x402_fetch, x402_payer_info ✨
│       └── vault.ts         # vault/admin/invoice/rebalance tools (13 handlers) 🔒
│
├── agent/                   # OTTO agent (OpenClaw)
│   ├── agent.md             # Agent identity, rules, tool docs
│   ├── openclaw.json        # Runtime config (model, channels, skills)
│   ├── scripts/
│   │   └── invoke.ts        # CLI bridge: agent → MCP tools
│   └── skills/
│       ├── arc-balance/     # Balance query scripts
│       ├── arc-wallet/      # Wallet management scripts
│       ├── arc-transfer/    # Transfer and deposit scripts
│       ├── arc-gateway/     # Gateway info scripts
│       ├── arc-x402/        # x402 payment scripts ✨
│       ├── arc-vault/       # OTTOVault + admin + invoice scripts (11) 🔒
│       └── arc-rebalancer/  # Cross-chain vault monitoring 🔄
│
├── contracts/               # Solidity (Foundry)
│   ├── src/OTTOVault.sol    # Treasury vault contract
│   ├── test/OTTOVault.t.sol # 43 tests (unit + fuzz), all passing
│   └── script/Deploy.s.sol  # Multi-chain deployment script
│
└── demo-server/             # x402 oracle demo (Express)
    └── server.ts            # /eth-price, /arc-stats — pay-per-request
```

---

## Hackathon Tracks

| Track | Fit | Demo |
|-------|-----|------|
| **Track 4** — Best Agentic Commerce on Arc | ⭐ Primary | x402 autonomous payment demo |
| **Track 2** — Best Chain Abstracted USDC | Secondary | Cross-chain rebalancer demo |
| **Track 3** — Global Payouts and Treasury | Bonus | Payroll execution demo |

---

## One Line

> OTTO is the first AI treasury agent that moves money cross-chain via Circle Gateway, pays for data feeds autonomously via x402, enforces spending limits through a deployed Solidity vault, and reports to your team — all without a single manual transaction.
