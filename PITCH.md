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

It monitors balances, moves funds cross-chain via Circle Gateway, pays for external services using the x402 nanopayment protocol, fetches real-time price feeds from Stork Oracle, invests idle USDC into yield-bearing USYC (Hashnote tokenized T-bills), executes payroll runs, and reports every action to the team over Telegram — all without human intervention.

```
Human: "Rebalance the treasury and pay the team"

Agent: checks balances on Arc Testnet, Base Sepolia, Avalanche Fuji
       → queries ETH/USD from Stork Oracle (on-chain + REST)
       → moves 15 USDC from Base to Arc (liquidity low)
       → fetches gas oracle (pays 0.001 USDC via x402, auto)
       → invests 20 idle USDC into USYC (tokenized T-bills, earning yield)
       → sends: Alice 10 USDC, Bob 15 USDC, Carol 5 USDC
       → posts summary to Telegram

Done. Zero manual steps. Zero gas fees.
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     User Interface                               │
│              Telegram Bot  ·  CLI  ·  Web (ottoarc.xyz)          │
└───────────────────────────────┬──────────────────────────────────┘
                                │ natural language command
┌───────────────────────────────▼──────────────────────────────────┐
│                  OTTO Agent Framework (OpenClaw)                  │
│                                                                  │
│  ┌─────────────────┐    ┌────────────────────────────────────┐   │
│  │   agent.md      │    │         openclaw.json              │   │
│  │   Role, rules,  │    │  provider: Claude (Anthropic)      │   │
│  │   chain ref,    │    │  channel:  Telegram                │   │
│  │   tool docs     │    │  skills:   10 skill modules         │   │
│  └─────────────────┘    └────────────────────────────────────┘   │
│                                                                  │
│  Skill Scripts (bash) — 10 modules:                              │
│  arc-balance  ·  arc-wallet  ·  arc-transfer  ·  arc-gateway     │
│  arc-x402 ✨  ·  arc-vault 🔒  ·  arc-rebalancer 🔄              │
│  arc-oracle 📈  ·  arc-yield 📊  ·  arc-governance ⚖️             │
└───────────────────────────────┬──────────────────────────────────┘
                                │ tsx invoke.ts <tool> <args>
┌───────────────────────────────▼──────────────────────────────────┐
│                    arc-wallet-mcp                                │
│         MCP Server (Model Context Protocol) — 59 tools           │
│                                                                  │
│  ┌────────────┬────────────┬────────────┬────────────────────┐   │
│  │  balance   │  wallet    │ transfer   │  vault 🔒           │   │
│  │  gateway   │  deposit   │            │  (15 handlers)     │   │
│  ├────────────┼────────────┼────────────┼────────────────────┤   │
│  │  x402 ✨   │ stork 📈   │ usyc 📊    │  rebalance 🔄      │   │
│  │  fetch +   │ REST API + │ rate +     │  cross-chain       │   │
│  │  payer     │ on-chain   │ balance +  │  vault health      │   │
│  │  info      │ aggregator │ deposit +  │                    │   │
│  ├────────────┴────────────┴────────────┴────────────────────┤   │
│  │  vault-v2 ⚖️ (11)         governance ⚖️ (7)                │   │
│  │  deploy, shareholders,    gov_setup, gov_link,            │   │
│  │  propose, vote, execute   gov_propose, gov_vote, tally    │   │
│  └────────────┴────────────┴────────────┴────────────────────┘   │
└──────┬──────────────┬──────────────┬──────────────┬──────────────┘
       │              │              │              │
┌──────▼────────┐ ┌───▼──────────┐ ┌▼────────────┐ ┌▼───────────────┐
│ Circle DCW    │ │ Circle       │ │ Stork Oracle│ │ Hashnote USYC  │
│ SCA + EOA     │ │ Gateway      │ │ REST API +  │ │ Tokenized      │
│ Custodial     │ │ Cross-chain  │ │ On-chain    │ │ US T-bills     │
│ wallets       │ │ USDC         │ │ Aggregator  │ │ Yield on USDC  │
└───────────────┘ └──────────────┘ └─────────────┘ └────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│                  OTTOVault 🔒 (3 chains, verified)               │
│  Solidity contract · 0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA │
│                                                                  │
│  Holds org USDC · Per-tx cap: 10 USDC · Daily cap: 100 USDC    │
│  Agent role enforced on-chain · Whitelist · Emergency pause     │
│  adminTransfer · No prompt can override — the EVM enforces      │
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
Deployed on 3 chains (verified):
  Arc Testnet:     0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA
  Base Sepolia:    0x47C1feaC66381410f5B050c39F67f15BbD058Af1
  Avalanche Fuji:  0x47C1feaC66381410f5B050c39F67f15BbD058Af1
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

### Stork Oracle — Real-Time Price Feeds

Stork is a decentralized oracle network providing low-latency price feeds. OTTO uses Stork for real-time market data through two channels:

1. **REST API** — Fast off-chain price lookups (sub-second latency, requires API key)
2. **On-chain aggregator** — Trustless on-chain price data on Arc Testnet (contract: `0xacC0...0d62`)

The agent calls `stork_price` for quick off-chain lookups and `stork_onchain_price` for verified on-chain data. Both fall back gracefully — REST to mock data if the API key is missing, on-chain to an error with a hint.

```
Agent needs to decide whether to rebalance:
  → stork_price("ETHUSD") → $2,847.42 (Stork REST, 200ms)
  → stork_onchain_price("ETHUSD", "arcTestnet") → $2,847.38 (on-chain, verified)
  → price delta < threshold → hold position
```

This replaces the demo oracle for real use cases. The agent gets institutional-grade price data directly from Stork's network — the same oracle infrastructure used by DeFi protocols in production.

### USYC — Yield on Idle Treasury USDC

USYC is Hashnote's tokenized representation of short-term US Treasury bills. Instead of letting USDC sit idle in the vault, OTTO can invest it into USYC and earn T-bill yield — then redeem back to USDC when funds are needed.

```
Deployed on Arc Testnet:
  USYC Token:  0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C
  USDC:        0x3600000000000000000000000000000000000000
```

The agent calls:
- `usyc_rate` — current exchange rate and APY from Hashnote
- `usyc_balance` — USYC holdings with USD value estimate
- `usyc_deposit` — approve USDC + buy USYC (invest into T-bills)
- `usyc_redeem` — sell USYC back to USDC (withdraw)

All operations are on-chain and auditable. The agent can only operate with its own wallet funds — vault USDC requires a separate admin decision.

```
Agent detects 50 USDC idle in wallet for 3 days:
  → usyc_rate() → APY: 4.8%
  → usyc_deposit(20) → approve + buy → tx confirmed
  → Telegram: "Invested 20 USDC into USYC (4.8% APY). Remaining liquid: 30 USDC."

Two weeks later, payroll due:
  → usyc_redeem(20) → sell → USDC returned + yield earned
  → vault_payroll([...]) → pay team
```

This is the **earn** side of the autonomous treasury cycle: monitor → earn → spend → report.

---

## MCP Tools Catalog (59 tools across 11 modules)

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
| `stork_price` 📈 | Fetch latest price from Stork Oracle REST API |
| `stork_onchain_price` 📈 | Read price from Stork on-chain aggregator contract |
| `usyc_rate` 📊 | Current USYC exchange rate and APY from Hashnote |
| `usyc_balance` 📊 | USYC token balance with USD value estimate |
| `usyc_deposit` 📊 | Invest USDC into USYC (buy tokenized T-bills) |
| `usyc_redeem` 📊 | Redeem USYC back to USDC |
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
| `vault_check_whitelist` 🔒 | Check if an address is whitelisted on a vault |
| `vault_payroll` 🔒 | Batch payroll: multiple vault transfers in sequence with receipts |
| `rebalance_check` 🔄 | Check vault balances on all chains, report health + shortfall |
| `v2_deploy` ⚖️ | Deploy full V2 governance stack (VaultV2 + ShareToken + Governor) |
| `v2_status` ⚖️ | Full V2 vault state: CEO, agent, governor, share token, balances |
| `v2_shareholders` ⚖️ | Shareholder list with share balances, voting power, revenue claims |
| `v2_distribute_revenue` ⚖️ | Distribute USDC revenue to all shareholders pro-rata |
| `v2_claim_revenue` ⚖️ | Claim accumulated revenue for a shareholder |
| `v2_propose` ⚖️ | Create governance proposal (setCeo / dissolve) via OTTOGovernor |
| `v2_vote` ⚖️ | Cast governance vote (For / Against / Abstain) with token weight |
| `v2_execute` ⚖️ | Execute passed governance proposal on-chain |
| `v2_invest_yield` ⚖️ | Invest idle vault USDC into USYC (CEO only) |
| `v2_redeem_yield` ⚖️ | Redeem USYC back to USDC for the vault (CEO only) |
| `v2_dissolve_status` ⚖️ | Track dissolution progress: yield redeemed, USDC distributed, claims |
| `gov_setup` 💬 | Configure DAC: set vault, governor, share token addresses |
| `gov_link` 💬 | Link Telegram user ID to ETH wallet, verify share token balance |
| `gov_members` 💬 | List all linked members with roles, shares, voting power |
| `gov_my_info` 💬 | User's governance info: wallet, role, LP balance, vote history |
| `gov_propose` 💬 | Create governance proposal via Telegram chat |
| `gov_vote` 💬 | Cast weighted vote from Telegram (For / Against / Abstain) |
| `gov_tally` 💬 | Vote tally: FOR/AGAINST/ABSTAIN %, voter list, quorum progress |

---

## Demo Scenarios

### 1. Autonomous API Payment via x402

The flagship demo. The agent fetches a price feed that costs money — and pays for it automatically.

```
User → Telegram: "What's the current ETH price?"

Agent:
  → calls x402_fetch("https://x402-oracle.ottoarc.xyz/eth-price")
  ← HTTP 402: { amount: "0.001", currency: "USDC", chain: "eip155:84532" }
  → signs EIP-3009 transferWithAuthorization (from payer wallet)
  → retries with X-PAYMENT header
  ← HTTP 200: { price: 2847.42, source: "stork", timestamp: ... }
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

### 4. Stork Oracle — Real-Time Market Data

The agent queries Stork for price data through two channels — fast REST API and trustless on-chain aggregator.

```
User → Telegram: "What's ETH at right now?"

Agent:
  → stork_price("ETHUSD") → $2,847.42 (Stork REST, sub-second)
  → "ETH/USD: $2,847.42 (source: Stork Oracle)"

User → Telegram: "Verify that on-chain"

Agent:
  → stork_onchain_price("ETHUSD", "arcTestnet")
  → reads from 0xacC0...0d62 on Arc Testnet
  → "ETH/USD on-chain: $2,847.38 (Stork Aggregator, Arc Testnet)"
```

### 5. Yield on Idle USDC

The agent invests idle treasury USDC into Hashnote's tokenized T-bills (USYC) and redeems when funds are needed.

```
User → Telegram: "Invest idle USDC into yield"

Agent:
  → usyc_rate() → APY: 4.8%, rate: 1.024 USDC/USYC
  → get_usdc_balance(agent wallet) → 45 USDC
  → "Current USYC APY: 4.8%. Invest 20 USDC?" → User: "yes"
  → usyc_deposit(20) → approve + buy → tx confirmed
  → Telegram: "Invested 20 USDC into USYC. Remaining liquid: 25 USDC."

(Later)
User → Telegram: "Redeem USYC, need it for payroll"

Agent:
  → usyc_balance() → 20.04 USYC (~$20.52 incl. yield)
  → usyc_redeem(20.04) → sell → USDC returned
  → Telegram: "Redeemed 20.04 USYC → 20.52 USDC. Yield earned: $0.52"
```

### 6. Chat-Based Governance

DAC members govern their shared treasury through a Telegram group chat — no dApps, no MetaMask popups.

```
Alice → Group Chat: "link my wallet 0xA1c3..."

OTTO:
  → gov_link(alice_tg_id, "0xA1c3...")
  → reads ShareToken.balanceOf → 1,400 tokens (14.2%)
  → detects role: Shareholder
  → "Linked! You are Shareholder with 14.2% voting power."

Bob → Group Chat: "propose new CEO 0xNewCeo — better yield strategy"

OTTO:
  → gov_propose(bob_tg_id, "setCeo", "better yield strategy", "0xNewCeo")
  → creates on-chain proposal via OTTOGovernor
  → "Proposal #3 created: setCeo → 0xNewCeo. Vote with 'for' or 'against'."

Alice → "vote for"
Carol → "vote against"

OTTO (after each vote):
  → gov_vote(voter_tg_id, proposal_3, support)
  → records weighted vote (Alice: 1,400 FOR, Carol: 800 AGAINST)
  → "Current tally: FOR 63.6% / AGAINST 36.4%"

Anyone → "tally"
OTTO:
  → gov_tally(proposal_3)
  → "Proposal #3: FOR 63.6% (1,400) · AGAINST 36.4% (800) · Quorum: 72%"
```

Zero dApps. Zero wallet popups. Governance happens where the team already talks.

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

### Yield on Idle Treasury Funds
A treasury holds 50,000 USDC that won't be needed for two weeks. Today that capital sits idle — earning nothing. With OTTO: the agent detects idle funds, checks current USYC rates (Hashnote tokenized T-bills), invests the idle portion, and redeems automatically when payroll or rebalancing draws near. The treasury earns T-bill yield passively, and the agent handles the full cycle.

> "Invest idle USDC above 10,000 into USYC. Redeem before payroll."
> OTTO: invested 40,000 USDC at 4.8% APY. Redeemed 2 days before payroll with $92 yield earned.

### Treasury Reporting on Demand
The team lead asks for a snapshot of the treasury at any time — mid-meeting, from a phone. OTTO responds in seconds with balances across all chains, USYC yield positions, recent inflows/outflows, and a summary of x402 payments made. No dashboard login. No spreadsheet. Just a Telegram message.

### Chat-Based DAC Governance
A group of shareholders co-own a V2 treasury vault. Traditionally, governance means visiting a dApp, connecting a wallet, navigating a proposal list, and signing transactions. With OTTO in the group chat: members link wallets once, then propose CEO changes, vote by replying "for" or "against", and see weighted tallies — all without leaving Telegram. OTTO reads share balances on-chain and enforces one-vote-per-member with token-weighted power.

> "propose new CEO 0xNewAddr — she has a better yield strategy"
> Members vote in replies. OTTO tallies: FOR 63.6%, AGAINST 36.4%. Quorum reached. Ready to execute.

---

## x402 for Treasury Management — Why It Matters

A treasury agent doesn't operate in a vacuum. To make good decisions it needs external data, and in crypto that data often sits behind paywalls. x402 turns every paid API into a tool the agent can use autonomously — no subscriptions, no API keys, no human approval.

### Paying for Data to Make Decisions

The agent manages USDC across Arc, Base, and Avalanche. To decide **when** and **where** to move funds it needs information:

| Data | Why the Agent Needs It | Example |
|------|----------------------|---------|
| Price feeds (ETH/USD, BTC/USD) | Detect arbitrage opportunities, time rebalances | Agent queries Stork Oracle (REST or on-chain) → confirms price → rebalances via Gateway |
| Gas oracles | Pick the cheapest moment for cross-chain transfers | Agent checks gas on 3 chains → waits for a dip → executes transfer at lowest cost |
| Liquidity analytics (TVL, volumes) | Decide which chain needs more USDC | Agent queries DeFi analytics API → chain X TVL is dropping → preemptively moves funds out |

Each query costs fractions of a cent. The agent pays from its own payer wallet, gets the data, acts on it — all in one autonomous loop.

```
Agent decides to rebalance
  → x402_fetch("https://oracle.example/eth-price")     // pays $0.001
  → x402_fetch("https://gas.example/arc-testnet")       // pays $0.001
  → analyzes: "ETH rising, gas low on Arc — good time to move"
  → transfer_usdc_custodial(Base → Arc, 10 USDC)
  → Telegram: "Rebalanced. Spent $0.002 on data, moved 10 USDC."
```

### Paying for Compliance and Risk Checks

Before every outgoing payment — payroll, vendor, or ad-hoc — the agent can verify the recipient:

- **KYC/AML screening** — "Is this address flagged?" Pay $0.01 per check, get an instant answer
- **Compliance oracle** — "Can we send USDC to this jurisdiction?" The agent pays for a jurisdiction check before executing a cross-border payroll transfer
- **Credit / reputation scoring** — Before releasing funds from the vault, verify the counterparty's on-chain history

No annual compliance SaaS subscription. The agent pays per-check, only when it actually needs to send money.

### Paying for Infrastructure

Treasury operations depend on reliable infrastructure. x402 lets the agent pay for premium services on demand:

- **Premium RPC nodes** — Faster, more reliable reads for balance checks and transaction monitoring. Pay per-request instead of a monthly plan
- **Blockchain indexers** — Query transaction history for treasury reports. The agent pays the indexer directly when the team asks for a spending summary
- **Notification relays** — Priority webhook delivery for critical alerts (vault approaching daily limit, large inbound transfer detected)

### The Economic Model

Traditional treasury tooling:
```
Bloomberg terminal    $24,000/year
Chainalysis API       $5,000/year
Premium RPC node      $1,200/year
Compliance checks      $800/year
                    ─────────────
Total:               $31,000/year  (fixed cost, whether you use it or not)
```

OTTO with x402:
```
Price feed queries     ~$0.001 × 100/day = $3/month
Compliance checks      ~$0.01  × 30/month = $0.30/month
RPC / indexer calls    ~$0.001 × 500/day  = $15/month
                     ─────────────────────
Total:                ~$18/month  (pay only for what you use)
```

The agent spends from the same treasury it manages. These operational costs are visible in `x402_payer_info`, trackable, and capped by the payer wallet balance — the agent literally cannot overspend because the wallet runs dry before any damage is done.

### Full Autonomous Cycle

This is the end-state vision: a treasury agent that **earns, spends, and reports** — all without human intervention.

```
1. Vault receives USDC (incoming payment, yield, deposit)
2. Agent detects the inflow via balance monitoring
3. Agent queries Stork Oracle for price data (REST + on-chain verification)
4. Agent decides: "Arc is underweight, Base is overweight"
5. Agent runs compliance check on the rebalance path (pays via x402)
6. Agent executes cross-chain transfer via Gateway
7. Agent invests surplus idle USDC into USYC (T-bill yield)
8. Agent reports the full cycle to Telegram — including x402 costs and yield positions

Total human involvement: zero.
Total x402 spend: < $0.01.
Idle USDC: earning 4-5% APY via USYC.
```

---

## Why This Matters

**Treasuries don't sleep.** Chains don't pause for timezones. A custodial wallet sitting idle on one chain while another runs dry is a risk and an opportunity cost — but checking and rebalancing manually is not scalable. Meanwhile, idle USDC earns nothing. OTTO solves both: it rebalances automatically and puts surplus capital to work in yield-bearing USYC.

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
│    OTTOVault (deployed · Arc Testnet · 0xFFfeEd...)  │
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
| `arc-wallet-mcp` — full MCP server | ✅ Built | 59 tools across 11 modules |
| `x402_fetch` + `x402_payer_info` tools | ✅ Built | Auto-pay on HTTP 402 |
| x402 payer wallet (funded) | ✅ Ready | 20 USDC on Arc Testnet |
| OTTO agent framework | ✅ Built | Claude (Anthropic), Telegram, bash skills |
| All bash skill scripts | ✅ Built | 10 skills: arc-balance, arc-wallet, arc-transfer, arc-gateway, arc-x402, arc-vault, arc-rebalancer, arc-oracle, arc-yield, arc-governance |
| `invoke.ts` CLI bridge | ✅ Built | Dynamic imports, all 59 tools wired |
| **OTTOVault smart contract** | ✅ Deployed | All 3 chains · 43 Solidity tests + 101 vitest = 144 total, all passing |
| **Vault tools** (status, transfer, can_transfer, deposit, payroll) | ✅ Built | MCP tools + bash skills (15 vault handlers) |
| **User ownership** (register_address, transfer_admin, encode_admin_tx) | ✅ Built | Tier 3 signing flow via ottoarc.xyz |
| **Invoice / compliance** (create_invoice, check_invoice_status) | ✅ Built | Off-chain tracking with on-chain balance verification |
| **Stork Oracle** (stork_price, stork_onchain_price) | ✅ Built | REST API + on-chain aggregator on Arc Testnet |
| **USYC Yield** (usyc_rate, usyc_balance, usyc_deposit, usyc_redeem) | ✅ Built | Hashnote tokenized T-bills on Arc Testnet |
| Demo x402 oracle server | ✅ Built | Express, Stork-powered, Telegram auth, 3 endpoints |
| Rebalancer skill | ✅ Built | Cross-chain vault monitoring + auto-rebalance via heartbeat |
| Contract verification | ✅ Verified | Arc Testnet, Base Sepolia, Avalanche Fuji |
| **V2 Governance Treasury** (v2_deploy, v2_propose, v2_vote, v2_execute) | ✅ Built | 11 tools: shareholder-owned vault + OTTOGovernor + OTTOShareToken |
| **Chat Governance** (gov_setup, gov_link, gov_propose, gov_vote, gov_tally) | ✅ Built | 7 tools: Telegram wallet linking, chat voting, weighted tallies |
| CI/CD auto-deploy | ✅ Built | GitHub Actions → GCP via SSH + Telegram notifications |

---

## Why Arc + Circle

**Arc** is purpose-built for institutional USDC: fast finality, Circle-native settlement, and direct Gateway integration. There is no bridging overhead, no wrapped tokens, no liquidity fragmentation.

**Circle Gateway** enables something unique: a single unified USDC balance that spans multiple chains. The agent doesn't need to think about which chain to use — it just moves value where it's needed.

**Circle DCW** removes the key management problem entirely. The agent operates wallets through Circle's API without ever holding private keys — except for the dedicated x402 payer wallet, which is a minimal-risk EOA funded with a small working balance.

**x402** is the missing protocol layer for agentic commerce. Today, every AI agent that wants to access paid APIs needs a human to approve each payment. x402 eliminates that — the agent signs EIP-3009 authorizations programmatically, with no gas and no human in the loop.

**Stork Oracle** provides the market data layer. OTTO queries Stork for real-time price feeds — both via REST API (sub-second latency) and on-chain aggregator (trustless, verifiable). This gives the agent the data it needs to make informed rebalancing decisions.

**Hashnote USYC** turns idle USDC into a yield-bearing position. Instead of capital sitting dormant between payroll cycles, OTTO invests it into tokenized US T-bills — earning institutional-grade yield while maintaining on-chain liquidity.

Together, these form a complete stack for autonomous treasury management: custody (Circle DCW), liquidity (Gateway), payments (x402), data (Stork), yield (USYC), and on-chain limits (OTTOVault).

---

## Repository Structure

```
OTTO/                        # GitHub monorepo: vlprosvirkin/OTTO
├── mcp/                     # MCP server — 59 tools across 11 modules
│   └── src/tools/
│       ├── balance.ts       # get_usdc_balance, get_gateway_balance, check_wallet_gas
│       ├── wallet.ts        # create_wallet_set, create_multichain_wallet, ...
│       ├── transfer.ts      # transfer_usdc_custodial, transfer_usdc_eoa, ...
│       ├── deposit.ts       # deposit_usdc, withdraw_usdc
│       ├── gateway.ts       # get_gateway_info, get_supported_chains, ...
│       ├── x402.ts          # x402_fetch, x402_payer_info ✨
│       ├── vault.ts         # vault/admin/invoice/rebalance/payroll (15 handlers) 🔒
│       ├── stork.ts         # stork_price, stork_onchain_price 📈
│       └── usyc.ts          # usyc_rate, usyc_balance, usyc_deposit, usyc_redeem 📊
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
│       ├── arc-vault/       # OTTOVault + admin + invoice + payroll scripts (13) 🔒
│       ├── arc-rebalancer/  # Cross-chain vault monitoring 🔄
│       ├── arc-oracle/      # Stork Oracle price feeds (REST + on-chain) 📈
│       └── arc-yield/       # USYC yield management (deposit + redeem) 📊
│
├── contracts/               # Solidity (Foundry)
│   ├── src/OTTOVault.sol    # Treasury vault contract + adminTransfer
│   ├── test/OTTOVault.t.sol # 43 tests (unit + fuzz), all passing
│   └── script/Deploy.s.sol  # Multi-chain deployment script
│
├── demo-server/             # x402 oracle (Express + Stork + Telegram auth)
│   └── app.ts               # /eth-price, /arc-stats — Stork-powered, pay-per-request
│
└── docs/                    # Architecture & security docs
    ├── security.md          # Security architecture, permission tiers
    └── testing-flow.md      # End-to-end testing guide
```

---

## Hackathon Tracks

| Track | Fit | Demo |
|-------|-----|------|
| **Track 4** — Best Agentic Commerce on Arc | ⭐ Primary | x402 autonomous payment + Stork Oracle + USYC yield |
| **Track 2** — Best Chain Abstracted USDC | Secondary | Cross-chain rebalancer + Gateway transfers |
| **Track 3** — Global Payouts and Treasury | Bonus | Vault payroll + invoice compliance |

---

## One Line

> OTTO is the first AI treasury agent that moves money cross-chain via Circle Gateway, pays for data feeds autonomously via x402, queries Stork Oracle for real-time prices, invests idle USDC into yield-bearing USYC, enforces spending limits through a deployed Solidity vault, and reports to your team — all without a single manual transaction.
