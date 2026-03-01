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
  handleGetUserVault,
  handleGetDacContracts,
  handleRegisterUserAddress,
  handleGetUserAddress,
  handleTransferVaultAdmin,
  handleEncodeAdminTx,
  handleCreateInvoice,
  handleCheckInvoiceStatus,
  handleVaultCheckWhitelist,
  handleVaultPayroll,
} from "./tools/vault.js";
import {
  handleStorkPrice,
  handleStorkOnChainPrice,
} from "./tools/stork.js";
import {
  handleUsycRate,
  handleUsycBalance,
  handleUsycDeposit,
  handleUsycRedeem,
} from "./tools/usyc.js";
import {
  handleVaultV2Status,
  handleVaultV2Shareholders,
  handleVaultV2DistributeRevenue,
  handleVaultV2ClaimRevenue,
  handleVaultV2Propose,
  handleVaultV2Vote,
  handleVaultV2Execute,
  handleVaultV2InvestYield,
  handleVaultV2RedeemYield,
  handleVaultV2DissolveStatus,
  handleVaultV2Transfer,
  handleVaultV2Deposit,
  handleVaultV2Whitelist,
  handleVaultV2WhitelistToggle,
  handleVaultV2CeoTransfer,
  handleVaultV2Withdraw,
  handleVaultV2SetLimits,
  handleVaultV2Pause,
  handleVaultV2Finalize,
} from "./tools/vault-v2.js";
import {
  handleGovSetup,
  handleGovLink,
  handleGovMembers,
  handleGovMyInfo,
  handleGovPropose,
  handleGovVote,
  handleGovTally,
  handleGovAddMembers,
  handleGovDacs,
} from "./tools/governance.js";

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

// deploy_user_vault removed — V2 vaults are deployed by users from the frontend (ottoarc.xyz)

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
  "get_dac_contracts",
  {
    title: "Get all DAC contracts for a vault",
    description:
      "Resolve all DAC contracts (Vault, ShareToken, Governor, CEO) for a given vault address. " +
      "Checks local cache first, then falls back to on-chain OTTORegistry.getDacByVault(). " +
      "Use this to discover the full contract set associated with a user's vault.",
    inputSchema: {
      vault_address: z.string().optional().describe("Direct vault address (0x-prefixed)"),
      user_id: z.string().optional().describe("Telegram user ID to resolve vault from"),
      eth_address: z.string().optional().describe("User's ETH address to resolve vault from"),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional()
        .describe("Chain to look up (default: arcTestnet)"),
    },
  },
  async ({ vault_address, user_id, eth_address, chain }) => ({
    content: [{
      type: "text" as const,
      text: await handleGetDacContracts({ vault_address, user_id, eth_address, chain }),
    }],
  })
);

server.registerTool(
  "register_user_address",
  {
    title: "Register user's ETH wallet address",
    description:
      "Register a Telegram user's own ETH wallet address. " +
      "Future vault deployments will set this address as CEO instead of OTTO. " +
      "For existing vaults, use transfer_vault_admin to hand over CEO role. " +
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
    title: "Transfer vault CEO role to user's wallet",
    description:
      "Transfer CEO role of a user's OTTOVault V2 from OTTO to the user's registered ETH address. " +
      "Requires the user to have called register_user_address first. " +
      "After this, OTTO can no longer change vault limits, whitelist, or pause state. " +
      "Only works if OTTO is currently the CEO.",
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
    title: "Encode vault CEO transaction calldata",
    description:
      "Encode calldata for a CEO-only OTTOVault V2 operation. " +
      "CEO operations (setLimits, setWhitelist, setPaused, withdraw, etc.) require the vault CEO's private key. " +
      "Returns the raw calldata that the user must sign and broadcast from their own wallet. " +
      "OTTO cannot execute these — they are protected at the EVM level.",
    inputSchema: {
      function: z.enum(["setLimits", "setWhitelist", "setWhitelistEnabled", "setAgent", "transferCeo", "setPaused", "withdraw"])
        .describe("CEO function to encode"),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional(),
      vault_address: z.string().optional(),
      max_per_tx_usdc: z.number().positive().optional().describe("For setLimits: new per-tx cap in USDC"),
      daily_limit_usdc: z.number().positive().optional().describe("For setLimits: new daily limit in USDC"),
      address: z.string().optional().describe("For setWhitelist/setAgent/transferCeo: target address"),
      allowed: z.boolean().optional().describe("For setWhitelist: true=add, false=remove"),
      enabled: z.boolean().optional().describe("For setWhitelistEnabled: true=enable, false=disable"),
      paused: z.boolean().optional().describe("For setPaused: true=pause, false=unpause"),
      new_address: z.string().optional().describe("For setAgent/transferCeo: new agent or CEO address"),
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

server.registerTool(
  "vault_check_whitelist",
  {
    title: "Check if address is whitelisted on vault",
    description:
      "Check whether a specific address is on the OTTOVault recipient whitelist. " +
      "Read-only — no transaction sent. Returns whitelist status and effective permission " +
      "(ALLOWED, BLOCKED, or ALLOWED with whitelist disabled).",
    inputSchema: {
      address: z.string().describe("EVM address to check (0x-prefixed)"),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional()
        .describe("Chain (default: arcTestnet)"),
      vault_address: z.string().optional()
        .describe("OTTOVault contract address (overrides per-chain default)"),
    },
  },
  async ({ address, chain, vault_address }) => ({
    content: [{ type: "text" as const, text: await handleVaultCheckWhitelist({ address, chain, vault_address }) }],
  })
);

server.registerTool(
  "vault_payroll",
  {
    title: "Batch transfer USDC from vault (payroll)",
    description:
      "Transfer USDC from an OTTOVault to multiple recipients in one batch. " +
      "Pre-flight checks validate: vault not paused, total ≤ balance, total ≤ daily allowance, " +
      "each amount ≤ per-tx cap. Partial failure tolerant — continues after individual failures. " +
      "Returns per-recipient results and summary. Uses vault limits (not Circle wallet).",
    inputSchema: {
      recipients: z.array(z.object({
        address: z.string().describe("Recipient EVM address"),
        amount_usdc: z.number().positive().describe("Amount in USDC"),
      })).min(1).describe("Array of {address, amount_usdc} recipients"),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional()
        .describe("Chain (default: arcTestnet)"),
      vault_address: z.string().optional()
        .describe("OTTOVault contract address (overrides per-chain default)"),
    },
  },
  async ({ recipients, chain, vault_address }) => ({
    content: [{ type: "text" as const, text: await handleVaultPayroll({ recipients, chain, vault_address }) }],
  })
);

// ─── Stork Oracle Tools ───────────────────────────────────────────────────────

server.tool(
  "stork_price_feed",
  [
    "Fetch real-time price data from Stork Oracle REST API.",
    "Returns latest price for the specified asset (default: ETHUSD).",
    "Requires STORK_API_KEY env var — falls back to mock data if not set.",
    "Use this for market data, portfolio valuation, and trading decisions.",
  ].join(" "),
  {
    assets: z.string().optional()
      .describe("Asset pair to query (default: ETHUSD). Comma-separated for multiple."),
  },
  async ({ assets }) => ({
    content: [{
      type: "text" as const,
      text: await handleStorkPrice({ assets }),
    }],
  })
);

server.tool(
  "stork_onchain_price",
  [
    "Read price from Stork on-chain aggregator contract.",
    "Returns the latest on-chain price for the specified asset.",
    "Available on Arc Testnet where Stork aggregator is deployed.",
    "Use this for trustless on-chain price verification.",
  ].join(" "),
  {
    asset: z.string().optional()
      .describe("Asset name (default: ETHUSD)"),
    chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional()
      .describe("Chain (default: arcTestnet — where Stork is deployed)"),
  },
  async ({ asset, chain }) => ({
    content: [{
      type: "text" as const,
      text: await handleStorkOnChainPrice({ asset, chain }),
    }],
  })
);

// ─── USYC Yield Tools ────────────────────────────────────────────────────────

server.tool(
  "usyc_rate",
  [
    "Fetch the current USYC (Hashnote tokenized T-bills) exchange rate.",
    "Returns the price per USYC token and estimated APY.",
    "Use this before usyc_deposit to show the user current yield rates.",
  ].join(" "),
  {},
  async () => ({
    content: [{
      type: "text" as const,
      text: await handleUsycRate(),
    }],
  })
);

server.tool(
  "usyc_balance",
  [
    "Get USYC token balance for an address on Arc Testnet.",
    "Also fetches current rate to show estimated USD value.",
    "If no address is provided, checks the agent's own wallet.",
  ].join(" "),
  {
    address: z.string().optional()
      .describe("EVM address to check (default: agent wallet)"),
    chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional()
      .describe("Chain (default: arcTestnet — where USYC is deployed)"),
  },
  async ({ address, chain }) => ({
    content: [{
      type: "text" as const,
      text: await handleUsycBalance({ address, chain }),
    }],
  })
);

server.tool(
  "usyc_deposit",
  [
    "Invest idle USDC into USYC (Hashnote tokenized US T-bills).",
    "Approves USDC spend then calls buy() to convert USDC → USYC.",
    "USYC earns yield from short-term US Treasury bills.",
    "Only available on Arc Testnet. Requires agent wallet to hold USDC.",
    "Check usyc_rate first to show current yield, then confirm with user.",
  ].join(" "),
  {
    amount_usdc: z.number().positive()
      .describe("Amount of USDC to invest into USYC"),
    chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional()
      .describe("Chain (default: arcTestnet)"),
  },
  async ({ amount_usdc, chain }) => ({
    content: [{
      type: "text" as const,
      text: await handleUsycDeposit({ amount_usdc, chain }),
    }],
  })
);

server.tool(
  "usyc_redeem",
  [
    "Redeem USYC back to USDC (sell tokenized T-bills).",
    "Converts USYC → USDC at the current exchange rate.",
    "Only available on Arc Testnet.",
    "Check usyc_balance first to see available USYC holdings.",
  ].join(" "),
  {
    amount_usyc: z.number().positive()
      .describe("Amount of USYC to redeem to USDC"),
    chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]).optional()
      .describe("Chain (default: arcTestnet)"),
  },
  async ({ amount_usyc, chain }) => ({
    content: [{
      type: "text" as const,
      text: await handleUsycRedeem({ amount_usyc, chain }),
    }],
  })
);

// ─── OTTOVault V2 Governance Tools ────────────────────────────────────────────

// v2_deploy removed — V2 vaults are deployed by users from the frontend (ottoarc.xyz)

server.tool(
  "v2_status",
  [
    "Get the full status of an OTTOVault V2 governance treasury.",
    "Returns: USDC balance, yield invested, spending limits, roles (CEO, agent, governor),",
    "vault state (Active/Dissolving/Dissolved), share token address.",
    "Use this before any V2 governance operation.",
  ].join(" "),
  {
    vault_address: z.string().describe("OTTOVaultV2 contract address"),
  },
  async ({ vault_address }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2Status({ vault_address }) }],
  })
);

server.registerTool(
  "v2_shareholders",
  {
    title: "Get V2 shareholder details",
    description:
      "Get detailed shareholder information for a V2 vault: " +
      "token balance, ownership %, voting power, and pending revenue per holder.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      shareholders: z.array(z.string()).min(1).describe("Array of shareholder addresses to query"),
    },
  },
  async ({ vault_address, shareholders }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2Shareholders({ vault_address, shareholders }) }],
  })
);

server.registerTool(
  "v2_distribute_revenue",
  {
    title: "Distribute revenue to shareholders",
    description:
      "CEO: distribute USDC revenue to all shareholders proportional to their token holdings. " +
      "Uses the Synthetix staking-rewards pattern — O(1) gas regardless of shareholder count. " +
      "Shareholders claim with v2_claim_revenue.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      amount_usdc: z.number().positive().describe("Amount of USDC to distribute"),
    },
  },
  async ({ vault_address, amount_usdc }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2DistributeRevenue({ vault_address, amount_usdc }) }],
  })
);

server.tool(
  "v2_claim_revenue",
  [
    "Claim pending revenue from a V2 vault.",
    "Transfers accumulated USDC to the caller based on their share token holdings.",
    "Check v2_shareholders first to see pending amounts.",
  ].join(" "),
  {
    vault_address: z.string().describe("OTTOVaultV2 contract address"),
  },
  async ({ vault_address }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2ClaimRevenue({ vault_address }) }],
  })
);

server.registerTool(
  "v2_propose",
  {
    title: "Create governance proposal",
    description:
      "Create a governance proposal to execute an action on the V2 vault. " +
      "Any shareholder can propose. Supported actions: setCeo (change CEO), dissolve (start dissolution). " +
      "After creation, shareholders vote with v2_vote. Execute with v2_execute after voting period.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      governor_address: z.string().describe("OTTOGovernor contract address"),
      action: z.enum(["setCeo", "dissolve"]).describe("Action: setCeo or dissolve"),
      new_ceo: z.string().optional().describe("New CEO address (required for setCeo action)"),
      description: z.string().describe("Human-readable proposal description"),
    },
  },
  async (p) => ({
    content: [{ type: "text" as const, text: await handleVaultV2Propose(p as Parameters<typeof handleVaultV2Propose>[0]) }],
  })
);

server.registerTool(
  "v2_vote",
  {
    title: "Cast vote on governance proposal",
    description:
      "Cast a vote on an active governance proposal. " +
      "Vote weight is proportional to share token holdings at the snapshot block. " +
      "Support: 0 = Against, 1 = For, 2 = Abstain. Quorum: 51% of total supply.",
    inputSchema: {
      governor_address: z.string().describe("OTTOGovernor contract address"),
      proposal_id: z.string().describe("Proposal ID (from v2_propose)"),
      support: z.number().int().min(0).max(2).describe("0=Against, 1=For, 2=Abstain"),
    },
  },
  async ({ governor_address, proposal_id, support }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2Vote({ governor_address, proposal_id, support }) }],
  })
);

server.registerTool(
  "v2_execute",
  {
    title: "Execute passed governance proposal",
    description:
      "Execute a governance proposal that has passed (Succeeded state). " +
      "Requires the voting period to have ended and quorum + majority reached. " +
      "This actually applies the action (setCeo or dissolve) on the vault.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      governor_address: z.string().describe("OTTOGovernor contract address"),
      action: z.enum(["setCeo", "dissolve"]).describe("Action that was proposed"),
      new_ceo: z.string().optional().describe("New CEO address (for setCeo)"),
      description: z.string().describe("Exact description from the proposal"),
    },
  },
  async (p) => ({
    content: [{ type: "text" as const, text: await handleVaultV2Execute(p as Parameters<typeof handleVaultV2Execute>[0]) }],
  })
);

server.registerTool(
  "v2_invest_yield",
  {
    title: "Invest idle USDC into yield (CEO)",
    description:
      "CEO: invest idle vault USDC into yield-generating assets (USYC T-bills) via the configured teller. " +
      "Requires setYieldStrategy to have been called first. Active state only.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      amount_usdc: z.number().positive().describe("Amount of USDC to invest"),
    },
  },
  async ({ vault_address, amount_usdc }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2InvestYield({ vault_address, amount_usdc }) }],
  })
);

server.registerTool(
  "v2_redeem_yield",
  {
    title: "Redeem yield back to USDC (CEO)",
    description:
      "CEO: redeem yield tokens (USYC) back to USDC via the configured teller. " +
      "Works in both Active and Dissolving states (needed for consolidation before dissolution).",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      amount_usyc: z.number().positive().describe("Amount of USYC to redeem"),
    },
  },
  async ({ vault_address, amount_usyc }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2RedeemYield({ vault_address, amount_usyc }) }],
  })
);

server.registerTool(
  "v2_dissolve_status",
  {
    title: "Get dissolution status",
    description:
      "Get dissolution status for a V2 vault: vault state, dissolution pool, " +
      "per-shareholder claimable amounts, and claimed status. " +
      "Use after dissolve() has been executed to track the dissolution process.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      shareholders: z.array(z.string()).min(1).describe("Array of shareholder addresses"),
    },
  },
  async ({ vault_address, shareholders }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2DissolveStatus({ vault_address, shareholders }) }],
  })
);

// ─── V2 Operational Tools ──────────────────────────────────────────────────

server.registerTool(
  "v2_transfer",
  {
    title: "Agent transfer USDC",
    description:
      "Agent: transfer USDC from V2 vault to a recipient. " +
      "Subject to per-tx and daily limits. Pre-checks canTransfer().",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      to: z.string().describe("Recipient address"),
      amount_usdc: z.number().positive().describe("Amount in USDC"),
    },
  },
  async ({ vault_address, to, amount_usdc }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2Transfer({ vault_address, to, amount_usdc }) }],
  })
);

server.registerTool(
  "v2_deposit",
  {
    title: "Deposit USDC into vault",
    description:
      "Deposit USDC into a V2 vault. Automatically approves USDC spend. " +
      "Blocked if whitelist is enabled and sender is not whitelisted.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      amount_usdc: z.number().positive().describe("Amount of USDC to deposit"),
    },
  },
  async ({ vault_address, amount_usdc }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2Deposit({ vault_address, amount_usdc }) }],
  })
);

server.registerTool(
  "v2_whitelist",
  {
    title: "Add/remove whitelist address",
    description:
      "CEO: add or remove an address from the vault whitelist. " +
      "When whitelist is enabled, only whitelisted addresses can deposit or receive transfers.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      address: z.string().describe("Address to whitelist/unwhitelist"),
      allowed: z.boolean().describe("true to add, false to remove"),
    },
  },
  async ({ vault_address, address, allowed }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2Whitelist({ vault_address, address, allowed }) }],
  })
);

server.registerTool(
  "v2_whitelist_toggle",
  {
    title: "Enable/disable whitelist",
    description: "CEO: enable or disable the whitelist for deposits and transfers.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      enabled: z.boolean().describe("true to enable, false to disable"),
    },
  },
  async ({ vault_address, enabled }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2WhitelistToggle({ vault_address, enabled }) }],
  })
);

server.registerTool(
  "v2_ceo_transfer",
  {
    title: "CEO transfer USDC",
    description:
      "CEO: transfer USDC from vault to a recipient. Not subject to agent limits. " +
      "Only works in Active state.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      to: z.string().describe("Recipient address"),
      amount_usdc: z.number().positive().describe("Amount in USDC"),
    },
  },
  async ({ vault_address, to, amount_usdc }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2CeoTransfer({ vault_address, to, amount_usdc }) }],
  })
);

server.registerTool(
  "v2_withdraw",
  {
    title: "CEO withdraw USDC",
    description: "CEO: withdraw USDC from vault to CEO address.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      amount_usdc: z.number().positive().describe("Amount in USDC"),
    },
  },
  async ({ vault_address, amount_usdc }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2Withdraw({ vault_address, amount_usdc }) }],
  })
);

server.registerTool(
  "v2_set_limits",
  {
    title: "Set spending limits",
    description: "CEO: set per-transaction and daily spending limits for the agent.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      max_per_tx_usdc: z.number().positive().describe("Max USDC per transaction"),
      daily_limit_usdc: z.number().positive().describe("Daily USDC limit"),
    },
  },
  async ({ vault_address, max_per_tx_usdc, daily_limit_usdc }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2SetLimits({ vault_address, max_per_tx_usdc, daily_limit_usdc }) }],
  })
);

server.registerTool(
  "v2_pause",
  {
    title: "Pause/unpause vault",
    description: "CEO: pause or unpause the vault. When paused, agent transfers are blocked.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
      paused: z.boolean().describe("true to pause, false to unpause"),
    },
  },
  async ({ vault_address, paused }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2Pause({ vault_address, paused }) }],
  })
);

server.registerTool(
  "v2_finalize",
  {
    title: "Finalize dissolution & auto-distribute",
    description:
      "Finalize a dissolution: freezes share tokens and automatically distributes " +
      "all remaining USDC pro-rata to every shareholder. No manual claiming needed. " +
      "Anyone can call this once vault is in Dissolving state.",
    inputSchema: {
      vault_address: z.string().describe("OTTOVaultV2 contract address"),
    },
  },
  async ({ vault_address }) => ({
    content: [{ type: "text" as const, text: await handleVaultV2Finalize({ vault_address }) }],
  })
);

// ─── Chat Governance Tools ──────────────────────────────────────────────────

server.tool(
  "gov_setup",
  [
    "Configure a DAC (Decentralized Autonomous Company) for chat-based governance.",
    "Sets the V2 vault, governor, and share token addresses.",
    "Supports multiple DACs — each identified by vault_address.",
    "Optionally set name, shareholders list, invite_link for the Telegram group.",
  ].join(" "),
  {
    vault_address: z.string().describe("OTTOVaultV2 contract address"),
    governor_address: z.string().describe("OTTOGovernor contract address"),
    share_token_address: z.string().describe("OTTOShareToken contract address"),
    name: z.string().optional().describe("DAC display name (default: 'DAC')"),
    shareholders: z.array(z.string()).optional().describe("Shareholder addresses (for governance activation gate)"),
    chat_id: z.string().optional().describe("Telegram group chat ID"),
    invite_link: z.string().optional().describe("Telegram group invite link"),
  },
  async ({ vault_address, governor_address, share_token_address, name, shareholders, chat_id, invite_link }) => ({
    content: [{ type: "text" as const, text: await handleGovSetup({ vault_address, governor_address, share_token_address, name, shareholders, chat_id, invite_link }) }],
  })
);

server.tool(
  "gov_link",
  [
    "Link a Telegram user to their on-chain wallet for DAC governance.",
    "Verifies the address holds share tokens. Determines role (CEO/Shareholder).",
    "After linking, the user can propose and vote via chat.",
  ].join(" "),
  {
    user_id: z.string().describe("Telegram user ID (numeric string)"),
    eth_address: z.string().describe("User's ETH wallet address (0x-prefixed)"),
    display_name: z.string().optional().describe("User's display name in chat"),
    vault_address: z.string().optional().describe("Vault address (required if multiple DACs)"),
  },
  async ({ user_id, eth_address, display_name, vault_address }) => ({
    content: [{ type: "text" as const, text: await handleGovLink({ user_id, eth_address, display_name, vault_address }) }],
  })
);

server.tool(
  "gov_members",
  [
    "List all linked DAC members with their on-chain roles, share token balances,",
    "and voting power. Reads live data from the ShareToken contract.",
  ].join(" "),
  {
    vault_address: z.string().optional().describe("Vault address (required if multiple DACs)"),
  },
  async ({ vault_address }) => ({
    content: [{ type: "text" as const, text: await handleGovMembers({ vault_address }) }],
  })
);

server.tool(
  "gov_my_info",
  [
    "Show a specific user's governance info: wallet, role, shares, voting power,",
    "and vote history across all proposals. User must be linked first.",
  ].join(" "),
  {
    user_id: z.string().describe("Telegram user ID"),
    vault_address: z.string().optional().describe("Vault address (required if multiple DACs)"),
  },
  async ({ user_id, vault_address }) => ({
    content: [{ type: "text" as const, text: await handleGovMyInfo({ user_id, vault_address }) }],
  })
);

server.tool(
  "gov_propose",
  [
    "Create a governance proposal from chat.",
    "The proposer must be a linked shareholder with share tokens.",
    "Creates an on-chain proposal via the OTTOGovernor contract.",
    "Supported actions: setCeo (replace CEO), dissolve (start dissolution).",
    "Governance must be active (all shareholders linked) before proposals can be created.",
  ].join(" "),
  {
    user_id: z.string().describe("Telegram user ID of the proposer"),
    action: z.enum(["setCeo", "dissolve"]).describe("Governance action"),
    description: z.string().describe("Human-readable proposal description"),
    new_ceo: z.string().optional().describe("New CEO address (required for setCeo)"),
    vault_address: z.string().optional().describe("Vault address (required if multiple DACs)"),
  },
  async ({ user_id, action, description, new_ceo, vault_address }) => ({
    content: [{ type: "text" as const, text: await handleGovPropose({ user_id, action, description, new_ceo, vault_address }) }],
  })
);

server.tool(
  "gov_vote",
  [
    "Cast a vote on an active governance proposal from chat.",
    "One vote per member, weighted by share token holdings.",
    "Support: 0 = Against, 1 = For, 2 = Abstain.",
    "Governance must be active (all shareholders linked) before voting.",
  ].join(" "),
  {
    user_id: z.string().describe("Telegram user ID of the voter"),
    proposal_id: z.string().describe("On-chain proposal ID"),
    support: z.number().int().min(0).max(2).describe("0=Against, 1=For, 2=Abstain"),
    vault_address: z.string().optional().describe("Vault address (required if multiple DACs)"),
  },
  async ({ user_id, proposal_id, support, vault_address }) => ({
    content: [{ type: "text" as const, text: await handleGovVote({ user_id, proposal_id, support, vault_address }) }],
  })
);

server.tool(
  "gov_tally",
  [
    "Get the current vote tally for a governance proposal.",
    "Shows FOR/AGAINST/ABSTAIN percentages, voter list, and who hasn't voted yet.",
    "If no proposal_id is given, shows the most recent proposal.",
  ].join(" "),
  {
    proposal_id: z.string().optional().describe("Proposal ID (defaults to most recent)"),
    vault_address: z.string().optional().describe("Vault address (required if multiple DACs)"),
  },
  async ({ proposal_id, vault_address }) => ({
    content: [{ type: "text" as const, text: await handleGovTally({ proposal_id, vault_address }) }],
  })
);

server.tool(
  "gov_add_members",
  [
    "Batch-add multiple members to a DAC. Admin convenience tool.",
    "For each member, verifies share token balance > 0 and determines role.",
    "Members with 0 shares are skipped. Shows governance activation status.",
  ].join(" "),
  {
    vault_address: z.string().optional().describe("Vault address (required if multiple DACs)"),
    members: z.array(z.object({
      user_id: z.string().describe("Telegram user ID"),
      eth_address: z.string().describe("ETH wallet address"),
      display_name: z.string().optional().describe("Display name"),
    })).describe("Array of members to add"),
  },
  async ({ vault_address, members }) => ({
    content: [{ type: "text" as const, text: await handleGovAddMembers({ vault_address, members }) }],
  })
);

server.tool(
  "gov_dacs",
  [
    "List all configured DACs with member counts, governance status,",
    "and Telegram invite links. Use to discover available DACs.",
  ].join(" "),
  {},
  async () => ({
    content: [{ type: "text" as const, text: await handleGovDacs() }],
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
