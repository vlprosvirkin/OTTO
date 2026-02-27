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

## Structure

```
OTTO/
├── mcp/          # MCP server — 20 Circle/Arc tools
├── agent/        # OpenClaw agent — Claude, Telegram, bash skills
└── demo-server/  # x402 oracle demo server (coming soon)
```

## Stack

| Layer | Technology |
|-------|-----------|
| AI Agent | Claude (Anthropic) via OpenClaw |
| Agent Tools | MCP (Model Context Protocol) |
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

`get_usdc_balance` · `get_gateway_balance` · `check_wallet_gas` · `transfer_usdc_custodial` · `transfer_usdc_eoa` · `deposit_usdc` · `withdraw_usdc` · `create_multichain_wallet` · `get_wallet_info` · `get_user_wallets` · `get_transaction_history` · `get_gateway_info` · `get_supported_chains` · `get_transfer_status` · **`x402_fetch`** · **`x402_payer_info`**

---

> Encode × Arc Enterprise & DeFi Hackathon · Tracks: Agentic Commerce · Chain Abstracted USDC · Global Payouts

See [PITCH.md](./PITCH.md) for full project documentation.
