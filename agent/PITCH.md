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
│  arc-gateway  ·  arc-x402                                        │
└───────────────────────────────┬──────────────────────────────────┘
                                │ tsx invoke.ts <tool> <args>
┌───────────────────────────────▼──────────────────────────────────┐
│                    arc-wallet-mcp                                │
│              MCP Server (Model Context Protocol)                 │
│                                                                  │
│  ┌──────────────┬──────────────┬─────────────┬────────────────┐  │
│  │   balance    │   wallet     │  transfer   │     x402       │  │
│  │              │              │             │                │  │
│  │ get_usdc_    │ create_      │ transfer_   │ x402_fetch ✨   │  │
│  │ balance      │ wallet_set   │ usdc_       │                │  │
│  │              │              │ custodial   │ x402_payer_    │  │
│  │ get_gateway_ │ create_      │             │ info ✨         │  │
│  │ balance      │ multichain_  │ transfer_   │                │  │
│  │              │ wallet       │ usdc_eoa    │                │  │
│  │ check_wallet │              │             │                │  │
│  │ _gas         │ get_wallet_  │ deposit_    │                │  │
│  │              │ info         │ usdc        │                │  │
│  │              │              │             │                │  │
│  │              │ get_user_    │ withdraw_   │                │  │
│  │              │ wallets      │ usdc        │                │  │
│  │              │              │             │                │  │
│  │              │ get_eoa_     │ get_        │                │  │
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

## What's Built vs What's Needed

| Component | Status | Notes |
|-----------|--------|-------|
| `arc-wallet-mcp` — full MCP server | ✅ Built | 19 tools across 5 modules |
| `x402_fetch` + `x402_payer_info` tools | ✅ Built | Auto-pay on HTTP 402 |
| x402 payer wallet (funded) | ✅ Ready | 20 USDC on Arc Testnet |
| OTTO agent framework | ✅ Built | Claude, Telegram, bash skills |
| All bash skill scripts | ✅ Built | arc-balance, arc-wallet, arc-transfer, arc-gateway, arc-x402 |
| `invoke.ts` CLI bridge | ✅ Built | Dynamic imports, all tools wired |
| Demo x402 oracle server | ⬜ To build | Express, 1 endpoint, ~40 lines |
| Rebalancer skill | ⬜ To build | Bash threshold logic, ~30 lines |

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
ArcHackathon/
├── arc-wallet-mcp/          # MCP server — Circle API tools
│   └── src/tools/
│       ├── balance.ts       # get_usdc_balance, get_gateway_balance
│       ├── wallet.ts        # create_wallet_set, create_multichain_wallet, ...
│       ├── transfer.ts      # transfer_usdc_custodial, transfer_usdc_eoa, ...
│       ├── deposit.ts       # deposit_usdc, withdraw_usdc
│       ├── gateway.ts       # get_gateway_info, get_supported_chains, ...
│       └── x402.ts          # x402_fetch, x402_payer_info ✨
│
└── arc-openclaw/            # OTTO agent
    ├── agent.md             # Agent identity, rules, tool documentation
    ├── openclaw.json        # Runtime config (model, channels, skills)
    ├── scripts/
    │   ├── invoke.ts        # CLI bridge: agent → MCP tools
    │   └── setup_x402_payer.ts  # Payer wallet setup utility
    └── skills/
        ├── arc-balance/     # Balance query scripts
        ├── arc-wallet/      # Wallet management scripts
        ├── arc-transfer/    # Transfer and deposit scripts
        ├── arc-gateway/     # Gateway info scripts
        └── arc-x402/        # x402 payment scripts ✨
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

> OTTO is the first AI treasury agent that moves money cross-chain, pays for data feeds autonomously via x402, and reports to your team — all without a single manual transaction.
