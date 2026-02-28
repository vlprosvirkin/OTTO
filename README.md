# OTTO — Onchain Treasury & Transfer Operator

**Autonomous AI treasury agent built on Arc.**

OTTO manages USDC across multiple chains — monitoring balances, rebalancing liquidity via Circle Gateway, executing payroll, and paying for external data feeds using the x402 nanopayment protocol. Every action is confirmed with zero manual approvals, zero gas fees, and a Telegram notification when it's done.

```
Human: "Rebalance the treasury and pay the team"

OTTO: checks balances on Arc Testnet, Base Sepolia, Avalanche Fuji
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
│                        User                                      │
│              Telegram Bot  /  ottoarc.xyz                        │
└────────────────────┬────────────────────────┬────────────────────┘
                     │ chat commands           │ admin tx signing
                     ▼                         ▼
┌────────────────────────────┐   ┌─────────────────────────────────┐
│   OTTO Agent (Claude)      │   │  ottoarc.xyz/sign               │
│   OpenClaw + MCP tools     │   │  MetaMask / Rabby / Frame       │
│                            │   │  EIP-1193 → eth_sendTransaction  │
│  Tier 1 — autonomous       │   └──────────────┬──────────────────┘
│  Tier 2 — "да/yes" confirm │                  │ signed admin tx
│  Tier 3 — encode only,     │                  │
│           never execute    │                  │
└────────────┬───────────────┘                  │
             │ agent role only                  │ admin role only
             ▼                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                      OTTOVault.sol (EVM)                         │
│                                                                  │
│   agent  ──▶  transfer(to, amount)                               │
│               │  ✗ amount > maxPerTx        → revert             │
│               │  ✗ dailySpent > dailyLimit  → revert             │
│               │  ✗ !whitelist[to]           → revert             │
│               └─ on-chain enforcement, no override possible      │
│                                                                  │
│   admin  ──▶  setLimits · setWhitelist · setPaused               │
│               setAgent · transferAdmin · withdraw                │
│               (requires user's private key — OTTO never has it)  │
└──────────────────────────┬───────────────────────────────────────┘
                           │ USDC
                           ▼
         Arc Testnet · Base Sepolia · Avalanche Fuji
         unified via Circle Gateway (no gas, no bridging)
```

### Repo structure

```
OTTO/
├── mcp/          # MCP server — 29 Circle/Arc/Vault tools
├── agent/        # OpenClaw agent — Claude, Telegram, bash skills
├── contracts/    # OTTOVault.sol — on-chain spending limits
├── demo-server/  # x402 oracle server
└── docs/         # Architecture & security docs
```

### Stack

| Layer | Technology |
|-------|-----------|
| AI Agent | Claude (Anthropic) via OpenClaw |
| Agent Tools | MCP (Model Context Protocol) |
| On-chain Treasury | OTTOVault.sol — per-tx & daily limits enforced in EVM |
| Cross-chain Liquidity | Circle Gateway |
| Custodial Wallets | Circle Developer Controlled Wallets |
| Nanopayments | x402 protocol |
| Notification | Telegram Bot |
| Chains | Arc Testnet · Base Sepolia · Avalanche Fuji |

## Setup

```bash
# 1. MCP server
cd mcp && npm install

# 2. Agent
cd agent && npm install

# 3. Configure environment
cp agent/.env.example agent/.env
# Fill in: CIRCLE_API_KEY, ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN

# 4. Setup x402 payer wallet
cd agent && npm run setup-payer
```

## MCP Tools

`get_usdc_balance` · `get_gateway_balance` · `check_wallet_gas` · `transfer_usdc_custodial` · `transfer_usdc_eoa` · `deposit_usdc` · `withdraw_usdc` · `create_multichain_wallet` · `get_wallet_info` · `get_user_wallets` · `get_transaction_history` · `get_gateway_info` · `get_supported_chains` · `get_transfer_status` · **`x402_fetch`** · **`x402_payer_info`** · `vault_status` · `vault_transfer` · `vault_deposit` · `deploy_user_vault` · `register_user_address` · `transfer_vault_admin` · `encode_admin_tx` · `create_invoice` · `check_invoice_status`

---

## Documentation

| Doc | Description |
|-----|-------------|
| [PITCH.md](./PITCH.md) | Full project overview and hackathon pitch |
| [docs/security.md](./docs/security.md) | Security architecture — OTTOVault, permission tiers, admin/agent model, Tier 3 signing flow |
| [docs/testing-flow.md](./docs/testing-flow.md) | End-to-end testing guide — 10 phases, every feature, CLI + Telegram |

---

> Encode × Arc Enterprise & DeFi Hackathon · Tracks: Agentic Commerce · Chain Abstracted USDC · Global Payouts

## License

This project is licensed under the Business Source License (BSL) 1.1.

OTTO is free for research, hackathons, and evaluation.
Commercial use requires a separate license.

Change Date: Feb 1, 2030 (converts to MIT)

Licensing contact: vlprosvirkin@gmail.com
