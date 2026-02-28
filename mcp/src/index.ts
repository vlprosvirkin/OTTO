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
  handleVaultDeposit,
  handleRebalanceCheck,
  handleDeployUserVault,
  handleGetUserVault,
  handleRegisterUserAddress,
  handleGetUserAddress,
  handleTransferVaultAdmin,
  handleEncodeAdminTx,
  handleCreateInvoice,
  handleCheckInvoiceStatus,
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

const VAULT_CHAIN_ENUM = z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional();

server.tool(
  "vault_status",
  [
    "Get the full status of an OTTOVault treasury contract.",
    "Returns: USDC balance, per-tx cap, daily limit, spent today, remaining allowance,",
    "whitelist state, pause state, agent address, admin address.",
    "Supports all chains: arcTestnet (default), baseSepolia, avalancheFuji.",
    "Use this before vault_transfer to verify limits and check vault balance.",
  ].join(" "),
  {
    chain: VAULT_CHAIN_ENUM.describe("Chain: arcTestnet (default) | baseSepolia | avalancheFuji"),
    vault_address: z.string().optional()
      .describe("OTTOVault contract address (overrides per-chain default from env)"),
  },
  async ({ chain, vault_address }) => ({
    content: [{
      type: "text" as const,
      text: await handleVaultStatus({ chain, vault_address }),
    }],
  })
);

server.tool(
  "vault_transfer",
  [
    "Transfer USDC from an OTTOVault treasury to a recipient.",
    "The vault enforces per-tx and daily spending limits at the EVM level — cannot be bypassed.",
    "The agent's X402_PAYER_PRIVATE_KEY must match the vault's registered agent address.",
    "Supports all chains: arcTestnet (default), baseSepolia, avalancheFuji.",
    "Always call vault_status first. Requires user confirmation for amounts > 1 USDC.",
  ].join(" "),
  {
    to: z.string().describe("Recipient EVM address (0x-prefixed)"),
    amount_usdc: z.number().positive().describe("Amount in USDC to transfer (e.g. 5.0)"),
    chain: VAULT_CHAIN_ENUM.describe("Chain: arcTestnet (default) | baseSepolia | avalancheFuji"),
    vault_address: z.string().optional()
      .describe("OTTOVault contract address (overrides per-chain default from env)"),
  },
  async ({ to, amount_usdc, chain, vault_address }) => ({
    content: [{
      type: "text" as const,
      text: await handleVaultTransfer({ to, amount_usdc, chain, vault_address }),
    }],
  })
);

server.tool(
  "vault_can_transfer",
  [
    "Preview whether a vault transfer would succeed WITHOUT sending a transaction.",
    "Returns ok=true if the transfer would go through, or ok=false with a human-readable reason.",
    "Checks: pause state, per-tx limit, daily limit, whitelist, vault balance.",
    "Supports all chains: arcTestnet (default), baseSepolia, avalancheFuji.",
    "Use this before vault_transfer to avoid failed transactions.",
  ].join(" "),
  {
    to: z.string().describe("Recipient EVM address (0x-prefixed)"),
    amount_usdc: z.number().positive().describe("Amount in USDC to preview"),
    chain: VAULT_CHAIN_ENUM.describe("Chain: arcTestnet (default) | baseSepolia | avalancheFuji"),
    vault_address: z.string().optional()
      .describe("OTTOVault contract address (overrides per-chain default from env)"),
  },
  async ({ to, amount_usdc, chain, vault_address }) => ({
    content: [{
      type: "text" as const,
      text: await handleVaultCanTransfer({ to, amount_usdc, chain, vault_address }),
    }],
  })
);

server.registerTool(
  "vault_deposit",
  {
    title: "Deposit USDC into OTTOVault",
    description:
      "Deposit USDC from the agent's own wallet into an OTTOVault on any chain. " +
      "Runs approve() then deposit() in sequence. Agent must hold USDC on the target chain. " +
      "Use this to top up a vault that has run low.",
    inputSchema: {
      amount_usdc: z.number().positive().describe("Amount of USDC to deposit (e.g. 10 = 10 USDC)"),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional()
        .describe("Target chain (default: arcTestnet)"),
      vault_address: z.string().optional()
        .describe("OTTOVault contract address (overrides per-chain default)"),
    },
  },
  async ({ amount_usdc, chain, vault_address }) => ({
    content: [{
      type: "text" as const,
      text: await handleVaultDeposit({ amount_usdc, chain, vault_address }),
    }],
  })
);

server.registerTool(
  "rebalance_check",
  {
    title: "Check vault balances and rebalancing needs",
    description:
      "Checks OTTOVault balances on all 3 chains (arcTestnet, baseSepolia, avalancheFuji) " +
      "and returns a JSON report: which vaults are healthy, low, or empty, " +
      "total shortfall, and recommended actions. " +
      "Use this as the first step in the rebalancing playbook before calling vault_deposit or transfer.",
    inputSchema: {
      min_usdc: z.number().positive().optional()
        .describe("Minimum acceptable vault balance per chain in USDC (default: 5)"),
    },
  },
  async ({ min_usdc }) => ({
    content: [{
      type: "text" as const,
      text: await handleRebalanceCheck({ min_usdc }),
    }],
  })
);

server.registerTool(
  "deploy_user_vault",
  {
    title: "Deploy a personal OTTOVault for a user",
    description:
      "Deploy a new OTTOVault smart contract on testnet linked to a Telegram user_id. " +
      "The vault enforces per-tx and daily spending limits at the EVM level. " +
      "Deployment is idempotent — calling again returns the existing address. " +
      "The agent wallet becomes both admin and agent of the vault. " +
      "Default: 10 USDC/tx cap, 100 USDC/day limit.",
    inputSchema: {
      user_id: z.string().describe("Telegram user ID (numeric string, e.g. '97729005')"),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional()
        .describe("Chain to deploy on (default: arcTestnet)"),
      max_per_tx_usdc: z.number().positive().optional()
        .describe("Max USDC per single transfer (default: 10)"),
      daily_limit_usdc: z.number().positive().optional()
        .describe("Max USDC per day (default: 100)"),
    },
  },
  async ({ user_id, chain, max_per_tx_usdc, daily_limit_usdc }) => ({
    content: [{
      type: "text" as const,
      text: await handleDeployUserVault({ user_id, chain, max_per_tx_usdc, daily_limit_usdc }),
    }],
  })
);

server.registerTool(
  "get_user_vault",
  {
    title: "Get vault address(es) for a user",
    description:
      "Look up the deployed OTTOVault address(es) for a Telegram user_id. " +
      "Returns vault addresses per chain (null if not deployed). " +
      "If chain is specified, returns only that chain's vault.",
    inputSchema: {
      user_id: z.string().describe("Telegram user ID (numeric string)"),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional()
        .describe("Specific chain to look up (optional — omit for all chains)"),
    },
  },
  async ({ user_id, chain }) => ({
    content: [{
      type: "text" as const,
      text: await handleGetUserVault({ user_id, chain }),
    }],
  })
);

server.registerTool(
  "register_user_address",
  {
    title: "Register user's ETH wallet address",
    description:
      "Register a Telegram user's own ETH wallet address. " +
      "Future vault deployments will set this address as admin (owner) instead of OTTO. " +
      "For existing custodial vaults, use transfer_vault_admin to hand over control. " +
      "Validates checksum format. Can be called again to update the address.",
    inputSchema: {
      user_id: z.string().describe("Telegram user ID (numeric string)"),
      eth_address: z.string().describe("User's ETH wallet address (0x-prefixed, EIP-55 checksum)"),
    },
  },
  async ({ user_id, eth_address }) => ({
    content: [{ type: "text" as const, text: await handleRegisterUserAddress({ user_id, eth_address }) }],
  })
);

server.registerTool(
  "get_user_address",
  {
    title: "Get user's registered ETH address",
    description: "Look up the ETH wallet address registered for a Telegram user.",
    inputSchema: {
      user_id: z.string().describe("Telegram user ID (numeric string)"),
    },
  },
  async ({ user_id }) => ({
    content: [{ type: "text" as const, text: await handleGetUserAddress({ user_id }) }],
  })
);

server.registerTool(
  "transfer_vault_admin",
  {
    title: "Transfer vault admin to user's wallet",
    description:
      "Transfer admin ownership of a user's OTTOVault from OTTO to the user's registered ETH address. " +
      "Requires the user to have called register_user_address first. " +
      "After this, OTTO can no longer change vault limits, whitelist, or pause state. " +
      "Only works if OTTO is currently the admin (custodial vaults).",
    inputSchema: {
      user_id: z.string().describe("Telegram user ID (numeric string)"),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional()
        .describe("Chain of the vault (default: arcTestnet)"),
      vault_address: z.string().optional()
        .describe("Vault contract address (overrides user registry lookup)"),
    },
  },
  async ({ user_id, chain, vault_address }) => ({
    content: [{ type: "text" as const, text: await handleTransferVaultAdmin({ user_id, chain, vault_address }) }],
  })
);

server.registerTool(
  "encode_admin_tx",
  {
    title: "Encode vault admin transaction calldata",
    description:
      "Encode calldata for an admin-only OTTOVault operation. " +
      "Admin operations (setLimits, setWhitelist, setPaused, withdraw, etc.) require the vault admin's private key. " +
      "Returns the raw calldata that the user must sign and broadcast from their own wallet. " +
      "OTTO cannot execute these — they are protected at the EVM level.",
    inputSchema: {
      function: z.enum(["setLimits", "setWhitelist", "setWhitelistEnabled", "setAgent", "transferAdmin", "setPaused", "withdraw"])
        .describe("Admin function to encode"),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional(),
      vault_address: z.string().optional(),
      max_per_tx_usdc: z.number().positive().optional().describe("For setLimits: new per-tx cap in USDC"),
      daily_limit_usdc: z.number().positive().optional().describe("For setLimits: new daily limit in USDC"),
      address: z.string().optional().describe("For setWhitelist/setAgent/transferAdmin: target address"),
      allowed: z.boolean().optional().describe("For setWhitelist: true=add, false=remove"),
      enabled: z.boolean().optional().describe("For setWhitelistEnabled: true=enable, false=disable"),
      paused: z.boolean().optional().describe("For setPaused: true=pause, false=unpause"),
      new_address: z.string().optional().describe("For setAgent/transferAdmin: new agent or admin address"),
      amount_usdc: z.number().positive().optional().describe("For withdraw: amount in USDC"),
    },
  },
  async (p) => ({
    content: [{ type: "text" as const, text: await handleEncodeAdminTx(p as Parameters<typeof handleEncodeAdminTx>[0]) }],
  })
);

server.registerTool(
  "create_invoice",
  {
    title: "Create payment invoice for vault deposit",
    description:
      "Create a payment invoice for incoming USDC to an OTTOVault. " +
      "Records expected amount and optionally expected sender for compliance tracking. " +
      "Captures current vault balance as baseline. Use check_invoice_status to verify payment.",
    inputSchema: {
      expected_amount_usdc: z.number().positive().describe("Expected payment amount in USDC"),
      user_id: z.string().optional().describe("Telegram user ID to look up their vault (optional if vault_address given)"),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional(),
      vault_address: z.string().optional().describe("Vault address (overrides user registry lookup)"),
      expected_sender: z.string().optional().describe("Expected sender address for compliance (optional)"),
      expires_hours: z.number().positive().optional().describe("Invoice expiry in hours (default: 24)"),
    },
  },
  async (p) => ({
    content: [{ type: "text" as const, text: await handleCreateInvoice(p as Parameters<typeof handleCreateInvoice>[0]) }],
  })
);

server.registerTool(
  "check_invoice_status",
  {
    title: "Check if payment invoice has been fulfilled",
    description:
      "Check whether an invoice has been paid by comparing current vault balance to the baseline. " +
      "Returns status: pending | paid | expired and the balance increase observed.",
    inputSchema: {
      invoice_id: z.string().describe("Invoice ID returned by create_invoice"),
    },
  },
  async ({ invoice_id }) => ({
    content: [{ type: "text" as const, text: await handleCheckInvoiceStatus({ invoice_id }) }],
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
