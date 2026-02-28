#!/usr/bin/env node
/**
 * Arc Wallet MCP Server
 *
 * MCP server exposing Arc Multichain Wallet operations via Circle Gateway.
 *
 * Requires environment variables:
 *   CIRCLE_API_KEY
 *   CIRCLE_ENTITY_SECRET
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   ARC_TESTNET_RPC_KEY (optional)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  handleGetGatewayBalance,
  handleGetUsdcBalance,
  handleCheckWalletGas,
} from "./tools/balance.js";
import {
  handleDepositUsdc,
  handleWithdrawUsdc,
} from "./tools/deposit.js";
import {
  handleTransferUsdcEoa,
  handleTransferUsdcCustodial,
  handleExecuteGatewayMint,
} from "./tools/transfer.js";
import {
  handleCreateWalletSet,
  handleCreateMultichainWallet,
  handleGetWalletInfo,
  handleGetEoaWallets,
  handleInitEoaWallet,
  handleGetTransactionHistory,
  handleGetUserWallets,
} from "./tools/wallet.js";
import {
  handleGetGatewayInfo,
  handleGetSupportedChains,
  handleGetTransferStatus,
} from "./tools/gateway.js";
import {
  handleX402Fetch,
  handleX402PayerInfo,
} from "./tools/x402.js";
import {
  handleVaultStatus,
  handleVaultTransfer,
  handleVaultCanTransfer,
} from "./tools/vault.js";

const CHAIN_ENUM = z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]);

const server = new McpServer({
  name: "arc-wallet-mcp",
  version: "1.0.0",
});

// ─── Balance Tools ─────────────────────────────────────────────────────────────

server.tool(
  "get_gateway_balance",
  "Get the unified USDC balance for an address across all Gateway domains (Arc Testnet, Base Sepolia, Avalanche Fuji). Returns per-domain breakdown and total unified balance.",
  { address: z.string().describe("The EVM wallet address to check (0x-prefixed)") },
  async ({ address }) => ({
    content: [{ type: "text" as const, text: await handleGetGatewayBalance({ address }) }],
  })
);

server.tool(
  "get_usdc_balance",
  "Get the on-chain USDC token balance for an address on a specific chain.",
  {
    address: z.string().describe("The EVM wallet address (0x-prefixed)"),
    chain: CHAIN_ENUM.describe("Chain: arcTestnet | baseSepolia | avalancheFuji"),
  },
  async ({ address, chain }) => ({
    content: [{ type: "text" as const, text: await handleGetUsdcBalance({ address, chain }) }],
  })
);

server.tool(
  "check_wallet_gas",
  "Check if a Circle wallet has sufficient native token balance (gas) on a specific chain.",
  {
    wallet_id: z.string().describe("The Circle wallet ID to check"),
    chain: CHAIN_ENUM.describe("Chain: arcTestnet | baseSepolia | avalancheFuji"),
  },
  async ({ wallet_id, chain }) => ({
    content: [{ type: "text" as const, text: await handleCheckWalletGas({ wallet_id, chain }) }],
  })
);

// ─── Deposit Tools ─────────────────────────────────────────────────────────────

server.tool(
  "deposit_usdc",
  "Deposit USDC from a Circle custodial wallet into the Gateway contract. The deposited amount becomes unified balance across all chains. Optionally sets up an EOA delegate.",
  {
    wallet_id: z.string().describe("The Circle SCA wallet ID that holds USDC"),
    chain: CHAIN_ENUM.describe("Chain to deposit on"),
    amount_usdc: z.number().positive().describe("Amount of USDC to deposit (e.g. 10.5)"),
    user_id: z.string().optional().describe("(Optional) User ID to setup EOA delegate"),
  },
  async ({ wallet_id, chain, amount_usdc, user_id }) => ({
    content: [{ type: "text" as const, text: await handleDepositUsdc({ wallet_id, chain, amount_usdc, user_id }) }],
  })
);

server.tool(
  "withdraw_usdc",
  "Withdraw USDC from the Gateway contract back to the custodial wallet. Note: withdrawals have a delay period.",
  {
    wallet_id: z.string().describe("The Circle SCA wallet ID"),
    chain: CHAIN_ENUM.describe("Chain to withdraw on"),
    amount_usdc: z.number().positive().describe("Amount of USDC to withdraw"),
  },
  async ({ wallet_id, chain, amount_usdc }) => ({
    content: [{ type: "text" as const, text: await handleWithdrawUsdc({ wallet_id, chain, amount_usdc }) }],
  })
);

// ─── Transfer Tools ────────────────────────────────────────────────────────────

server.tool(
  "transfer_usdc_eoa",
  "Transfer USDC cross-chain via Circle Gateway using an EOA wallet for signing. Requires the user to have deposited USDC into Gateway first. Amount must be > 2.01 USDC to cover fees.",
  {
    user_id: z.string().describe("User ID (to look up EOA signer wallet)"),
    depositor_wallet_id: z.string().describe("Circle wallet ID that deposited USDC into Gateway"),
    source_chain: CHAIN_ENUM.describe("Source chain with Gateway balance"),
    destination_chain: CHAIN_ENUM.describe("Destination chain to receive USDC"),
    amount_usdc: z.number().positive().describe("Amount to transfer (must be > 2.01 USDC)"),
    recipient_address: z.string().optional().describe("(Optional) Recipient address. Defaults to depositor wallet."),
  },
  async ({ user_id, depositor_wallet_id, source_chain, destination_chain, amount_usdc, recipient_address }) => ({
    content: [{ type: "text" as const, text: await handleTransferUsdcEoa({ user_id, depositor_wallet_id, source_chain, destination_chain, amount_usdc, recipient_address }) }],
  })
);

server.tool(
  "transfer_usdc_custodial",
  "Transfer USDC cross-chain via Circle Gateway using a Circle custodial SCA wallet for signing. Amount must be > 1.01 USDC to cover fees.",
  {
    wallet_id: z.string().describe("Circle SCA wallet ID that deposited and will sign the transfer"),
    source_chain: CHAIN_ENUM.describe("Source chain"),
    destination_chain: CHAIN_ENUM.describe("Destination chain"),
    amount_usdc: z.number().positive().describe("Amount to transfer (must be > 1.01 USDC)"),
    recipient_address: z.string().optional().describe("(Optional) Recipient address on destination chain"),
    user_id: z.string().optional().describe("(Optional) User ID to record transaction in database"),
  },
  async ({ wallet_id, source_chain, destination_chain, amount_usdc, recipient_address, user_id }) => ({
    content: [{ type: "text" as const, text: await handleTransferUsdcCustodial({ wallet_id, source_chain, destination_chain, amount_usdc, recipient_address, user_id }) }],
  })
);

server.tool(
  "execute_gateway_mint",
  "Execute a gatewayMint transaction on the destination chain using an existing attestation and signature. Use this to finalize a cross-chain transfer.",
  {
    wallet_id: z.string().describe("Circle wallet ID to execute the mint"),
    destination_chain: CHAIN_ENUM.describe("Destination chain for mint"),
    attestation: z.string().describe("Attestation payload (hex) from Gateway API"),
    signature: z.string().describe("Attestation signature (hex) from Gateway API"),
  },
  async ({ wallet_id, destination_chain, attestation, signature }) => ({
    content: [{ type: "text" as const, text: await handleExecuteGatewayMint({ wallet_id, destination_chain, attestation, signature }) }],
  })
);

// ─── Wallet Tools ──────────────────────────────────────────────────────────────

server.tool(
  "create_wallet_set",
  "Create a Circle wallet set — a container for multiple wallets across different chains.",
  {
    name: z.string().describe("Human-readable name for the wallet set"),
  },
  async ({ name }) => ({
    content: [{ type: "text" as const, text: await handleCreateWalletSet({ name }) }],
  })
);

server.tool(
  "create_multichain_wallet",
  "Create a multichain SCA wallet. The wallet is accessible on all supported chains (Arc Testnet, Base Sepolia, Avalanche Fuji) with the same address.",
  {
    wallet_set_id: z.string().describe("Circle wallet set ID (from create_wallet_set)"),
    user_id: z.string().optional().describe("(Optional) User ID to store wallet in database"),
  },
  async ({ wallet_set_id, user_id }) => ({
    content: [{ type: "text" as const, text: await handleCreateMultichainWallet({ wallet_set_id, user_id }) }],
  })
);

server.tool(
  "get_wallet_info",
  "Get information about a Circle wallet by its ID (address, blockchain, type, state).",
  {
    wallet_id: z.string().describe("The Circle wallet ID"),
  },
  async ({ wallet_id }) => ({
    content: [{ type: "text" as const, text: await handleGetWalletInfo({ wallet_id }) }],
  })
);

server.tool(
  "get_eoa_wallets",
  "List all Gateway EOA signer wallets for a user. These wallets sign burn intents for cross-chain transfers.",
  {
    user_id: z.string().describe("User ID to list EOA wallets for"),
  },
  async ({ user_id }) => ({
    content: [{ type: "text" as const, text: await handleGetEoaWallets({ user_id }) }],
  })
);

server.tool(
  "init_eoa_wallet",
  "Initialize (get or create) a Gateway EOA signer wallet for a user. Requires the user to already have an SCA wallet.",
  {
    user_id: z.string().describe("User ID to initialize EOA wallet for"),
    blockchain: z.string().optional().describe("Blockchain hint (default: ARC-TESTNET). EOA works on all chains."),
  },
  async ({ user_id, blockchain }) => ({
    content: [{ type: "text" as const, text: await handleInitEoaWallet({ user_id, blockchain }) }],
  })
);

server.tool(
  "get_transaction_history",
  "Get the transaction history for a user (deposits, transfers). Sorted by most recent first.",
  {
    user_id: z.string().describe("User ID to fetch transaction history for"),
    limit: z.number().int().positive().max(100).optional().describe("Max transactions to return (default: 20)"),
    tx_type: z.enum(["deposit", "transfer", "unify"]).optional().describe("Filter by type: deposit | transfer | unify"),
  },
  async ({ user_id, limit, tx_type }) => ({
    content: [{ type: "text" as const, text: await handleGetTransactionHistory({ user_id, limit, tx_type }) }],
  })
);

server.tool(
  "get_user_wallets",
  "Get all wallets stored in database for a user (both SCA and EOA wallets).",
  {
    user_id: z.string().describe("User ID to fetch wallets for"),
  },
  async ({ user_id }) => ({
    content: [{ type: "text" as const, text: await handleGetUserWallets({ user_id }) }],
  })
);

// ─── Gateway Tools ─────────────────────────────────────────────────────────────

server.tool(
  "get_gateway_info",
  "Fetch Circle Gateway configuration: version, supported domains/chains, contract addresses.",
  {},
  async () => ({
    content: [{ type: "text" as const, text: await handleGetGatewayInfo() }],
  })
);

server.tool(
  "get_supported_chains",
  "Get all supported chains with domain IDs, USDC contract addresses, and Circle blockchain names.",
  {},
  async () => ({
    content: [{ type: "text" as const, text: await handleGetSupportedChains() }],
  })
);

server.tool(
  "get_transfer_status",
  "Check the status of a cross-chain transfer by its transfer ID from the Circle Gateway API.",
  {
    transfer_id: z.string().describe("Transfer ID from a previous transfer operation"),
  },
  async ({ transfer_id }) => ({
    content: [{ type: "text" as const, text: await handleGetTransferStatus({ transfer_id }) }],
  })
);

// ─── x402 Nanopayment Tools ────────────────────────────────────────────────────

server.tool(
  "x402_fetch",
  [
    "Make an HTTP request to an x402-enabled API endpoint.",
    "If the server responds with 402 Payment Required, the agent automatically pays in USDC",
    "via Circle Gateway (gas-free, offchain) and retries the request.",
    "Use this to autonomously pay for: oracle data feeds, AI model inference,",
    "market data APIs, premium content, or any x402-enabled service.",
    "Returns the response body plus a payment receipt if payment was made.",
    "Requires X402_PAYER_PRIVATE_KEY env var — check with x402_payer_info first.",
  ].join(" "),
  {
    url: z.string().url().describe("The URL to fetch (must be an x402-enabled endpoint)"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional()
      .describe("HTTP method (default: GET)"),
    body: z.string().optional()
      .describe("Request body as JSON string (for POST/PUT/PATCH)"),
    headers: z.record(z.string()).optional()
      .describe("Additional HTTP headers to include"),
  },
  async ({ url, method, body, headers }) => ({
    content: [{
      type: "text" as const,
      text: await handleX402Fetch({ url, method, body, headers }),
    }],
  })
);

server.tool(
  "x402_payer_info",
  [
    "Get information about the configured x402 payment wallet.",
    "Shows the payer address and supported networks for nanopayments.",
    "Use this before x402_fetch to verify the agent wallet is configured and funded.",
  ].join(" "),
  {},
  async () => ({
    content: [{
      type: "text" as const,
      text: await handleX402PayerInfo({}),
    }],
  })
);

// ─── OTTOVault Tools ───────────────────────────────────────────────────────────

server.tool(
  "vault_status",
  [
    "Get the full status of the OTTOVault treasury contract on Arc Testnet.",
    "Returns: USDC balance, per-tx cap, daily limit, amount spent today, remaining allowance,",
    "whitelist state, pause state, agent address, admin address.",
    "Use this before vault_transfer to verify limits and check vault balance.",
  ].join(" "),
  {
    vault_address: z.string().optional()
      .describe("OTTOVault contract address (default: deployed on Arc Testnet)"),
  },
  async ({ vault_address }) => ({
    content: [{
      type: "text" as const,
      text: await handleVaultStatus({ vault_address }),
    }],
  })
);

server.tool(
  "vault_transfer",
  [
    "Transfer USDC from the OTTOVault treasury to a recipient.",
    "The vault enforces per-tx and daily spending limits at the EVM level — these cannot be bypassed.",
    "The agent's X402_PAYER_PRIVATE_KEY must match the vault's registered agent address.",
    "Always call vault_status first to check available balance and limits.",
    "Requires confirmation before calling for amounts > 1 USDC.",
  ].join(" "),
  {
    to: z.string().describe("Recipient EVM address (0x-prefixed)"),
    amount_usdc: z.number().positive().describe("Amount in USDC to transfer (e.g. 5.0)"),
    vault_address: z.string().optional()
      .describe("OTTOVault contract address (default: deployed on Arc Testnet)"),
  },
  async ({ to, amount_usdc, vault_address }) => ({
    content: [{
      type: "text" as const,
      text: await handleVaultTransfer({ to, amount_usdc, vault_address }),
    }],
  })
);

server.tool(
  "vault_can_transfer",
  [
    "Preview whether a vault transfer would succeed WITHOUT sending a transaction.",
    "Returns ok=true if the transfer would go through, or ok=false with a human-readable reason.",
    "Checks: pause state, per-tx limit, daily limit, whitelist, vault balance.",
    "Use this before vault_transfer to avoid failed transactions.",
  ].join(" "),
  {
    to: z.string().describe("Recipient EVM address (0x-prefixed)"),
    amount_usdc: z.number().positive().describe("Amount in USDC to preview"),
    vault_address: z.string().optional()
      .describe("OTTOVault contract address (default: deployed on Arc Testnet)"),
  },
  async ({ to, amount_usdc, vault_address }) => ({
    content: [{
      type: "text" as const,
      text: await handleVaultCanTransfer({ to, amount_usdc, vault_address }),
    }],
  })
);

// ─── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Arc Wallet MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
