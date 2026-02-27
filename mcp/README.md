# Arc Wallet MCP Server

MCP (Model Context Protocol) server for Arc Multichain Wallet — exposes USDC cross-chain operations via Circle Gateway to Claude.

## Tools Available

### Balance
| Tool | Description |
|------|-------------|
| `get_gateway_balance` | Unified USDC balance across all Gateway domains |
| `get_usdc_balance` | On-chain USDC balance on a specific chain |
| `check_wallet_gas` | Native token gas balance for a Circle wallet |

### Deposit / Withdraw
| Tool | Description |
|------|-------------|
| `deposit_usdc` | Deposit USDC from custodial wallet into Gateway |
| `withdraw_usdc` | Withdraw USDC from Gateway back to custodial wallet |

### Cross-Chain Transfers
| Tool | Description |
|------|-------------|
| `transfer_usdc_eoa` | Transfer via EOA signing (recommended for user flows) |
| `transfer_usdc_custodial` | Transfer via SCA signing (simpler) |
| `execute_gateway_mint` | Execute mint on destination with existing attestation |

### Wallet Management
| Tool | Description |
|------|-------------|
| `create_wallet_set` | Create a Circle wallet set |
| `create_multichain_wallet` | Create SCA wallet on all chains |
| `get_wallet_info` | Get wallet details by Circle wallet ID |
| `get_eoa_wallets` | List EOA signer wallets for a user |
| `init_eoa_wallet` | Get or create EOA signer wallet for a user |
| `get_user_wallets` | Get all wallets from database for a user |
| `get_transaction_history` | Transaction history (deposits, transfers) |

### Gateway Info
| Tool | Description |
|------|-------------|
| `get_gateway_info` | Circle Gateway configuration and domain status |
| `get_supported_chains` | Supported chains with domain IDs and addresses |
| `get_transfer_status` | Status of a cross-chain transfer by ID |

## Supported Chains

| Chain | Domain ID | Native Token |
|-------|-----------|-------------|
| Arc Testnet | 26 | USDC (native) |
| Base Sepolia | 6 | ETH |
| Avalanche Fuji | 1 | AVAX |

## Setup

### 1. Install dependencies

```bash
cd arc-wallet-mcp
npm install
npm run build
```

### 2. Configure environment variables

Copy `.env.example` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:
- `CIRCLE_API_KEY` — Circle Developer API key
- `CIRCLE_ENTITY_SECRET` — Circle entity secret
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase anon key

### 3. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "arc-wallet": {
      "command": "node",
      "args": ["/Users/vlprosvirkin/Projects/ArcHackathon/arc-wallet-mcp/dist/index.js"],
      "env": {
        "CIRCLE_API_KEY": "your_circle_api_key",
        "CIRCLE_ENTITY_SECRET": "your_entity_secret",
        "NEXT_PUBLIC_SUPABASE_URL": "https://your-project.supabase.co",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "your_supabase_anon_key"
      }
    }
  }
}
```

Or using `tsx` for development (no build step):

```json
{
  "mcpServers": {
    "arc-wallet": {
      "command": "npx",
      "args": ["tsx", "/Users/vlprosvirkin/Projects/ArcHackathon/arc-wallet-mcp/src/index.ts"],
      "env": {
        "CIRCLE_API_KEY": "...",
        "CIRCLE_ENTITY_SECRET": "...",
        "NEXT_PUBLIC_SUPABASE_URL": "...",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "..."
      }
    }
  }
}
```

## Example Interactions with Claude

```
"What is the unified USDC balance for address 0x...?"
→ get_gateway_balance

"Deposit 10 USDC from my wallet abc-123 on Base Sepolia"
→ deposit_usdc

"Transfer 5 USDC from Arc Testnet to Avalanche Fuji for user xyz"
→ transfer_usdc_eoa

"Show me the transaction history for user uuid-..."
→ get_transaction_history

"What chains does Arc Gateway support?"
→ get_supported_chains
```

## Architecture

```
arc-wallet-mcp/
├── src/
│   ├── index.ts                    # MCP server (tool registration)
│   ├── tools/
│   │   ├── balance.ts              # Balance query tools
│   │   ├── deposit.ts              # Deposit/withdraw tools
│   │   ├── transfer.ts             # Cross-chain transfer tools
│   │   ├── wallet.ts               # Wallet management tools
│   │   └── gateway.ts              # Gateway info tools
│   └── lib/
│       ├── circle/
│       │   ├── sdk.ts              # Circle SDK initialization
│       │   ├── gateway-sdk.ts      # Core Gateway operations
│       │   └── create-gateway-eoa-wallets.ts
│       └── supabase/
│           └── client.ts           # Supabase client
├── package.json
└── tsconfig.json
```

## Notes

- This server is configured for **testnet only** (Arc Testnet, Base Sepolia, Avalanche Fuji)
- Transfers require a minimum of **2.01 USDC** (EOA) or **1.01 USDC** (custodial) to cover Gateway fees
- EOA wallet signs burn intents; it must be added as a delegate to the depositor wallet before transfers
- The Supabase database is shared with the arc-multichain-wallet Next.js app
