#!/usr/bin/env tsx
/**
 * CLI bridge: calls OTTO MCP handlers from shell scripts.
 *
 * Uses dynamic imports so modules (especially Supabase) are only
 * loaded when the specific tool is actually called.
 *
 * Usage:
 *   tsx invoke.ts <tool_name> <json_args>
 *
 * Example:
 *   tsx invoke.ts get_gateway_balance '{"address":"0xabc..."}'
 */

// Load .env from agent root (works regardless of cwd)
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const _SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const _ROOT = resolve(_SCRIPT_DIR, "..");
try {
  for (const line of readFileSync(resolve(_ROOT, ".env"), "utf-8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k && v && !process.env[k]) process.env[k] = v;
  }
} catch { /* .env optional */ }

// MCP tools — ../mcp/src/tools (relative to agent/)
const MCP = resolve(_SCRIPT_DIR, "../../mcp/src/tools");

type AnyArgs = Record<string, unknown>;

const HANDLERS: Record<string, (args: AnyArgs) => Promise<string>> = {
  // ── Balance (no Supabase) ──────────────────────────────────────────────
  get_gateway_balance: async (a) => {
    const { handleGetGatewayBalance } = await import(`${MCP}/balance.js`);
    return handleGetGatewayBalance(a as { address: string });
  },
  get_usdc_balance: async (a) => {
    const { handleGetUsdcBalance } = await import(`${MCP}/balance.js`);
    return handleGetUsdcBalance(a as { address: string; chain: string });
  },
  check_wallet_gas: async (a) => {
    const { handleCheckWalletGas } = await import(`${MCP}/balance.js`);
    return handleCheckWalletGas(a as { wallet_id: string; chain: string });
  },

  // ── Gateway (no Supabase) ──────────────────────────────────────────────
  get_gateway_info: async () => {
    const { handleGetGatewayInfo } = await import(`${MCP}/gateway.js`);
    return handleGetGatewayInfo();
  },
  get_supported_chains: async () => {
    const { handleGetSupportedChains } = await import(`${MCP}/gateway.js`);
    return handleGetSupportedChains();
  },
  get_transfer_status: async (a) => {
    const { handleGetTransferStatus } = await import(`${MCP}/gateway.js`);
    return handleGetTransferStatus(a as { transfer_id: string });
  },

  // ── Deposit / Withdraw (uses Supabase optionally) ─────────────────────
  deposit_usdc: async (a) => {
    const { handleDepositUsdc } = await import(`${MCP}/deposit.js`);
    return handleDepositUsdc(a as { wallet_id: string; chain: string; amount_usdc: number; user_id?: string });
  },
  withdraw_usdc: async (a) => {
    const { handleWithdrawUsdc } = await import(`${MCP}/deposit.js`);
    return handleWithdrawUsdc(a as { wallet_id: string; chain: string; amount_usdc: number });
  },

  // ── Transfer (uses Supabase optionally) ───────────────────────────────
  transfer_usdc_eoa: async (a) => {
    const { handleTransferUsdcEoa } = await import(`${MCP}/transfer.js`);
    return handleTransferUsdcEoa(a as { user_id: string; depositor_wallet_id: string; source_chain: string; destination_chain: string; amount_usdc: number; recipient_address?: string });
  },
  transfer_usdc_custodial: async (a) => {
    const { handleTransferUsdcCustodial } = await import(`${MCP}/transfer.js`);
    return handleTransferUsdcCustodial(a as { wallet_id: string; source_chain: string; destination_chain: string; amount_usdc: number; recipient_address?: string; user_id?: string });
  },
  execute_gateway_mint: async (a) => {
    const { handleExecuteGatewayMint } = await import(`${MCP}/transfer.js`);
    return handleExecuteGatewayMint(a as { wallet_id: string; destination_chain: string; attestation: string; signature: string });
  },

  // ── Wallet (uses Supabase) ─────────────────────────────────────────────
  create_wallet_set: async (a) => {
    const { handleCreateWalletSet } = await import(`${MCP}/wallet.js`);
    return handleCreateWalletSet(a as { name: string });
  },
  create_multichain_wallet: async (a) => {
    const { handleCreateMultichainWallet } = await import(`${MCP}/wallet.js`);
    return handleCreateMultichainWallet(a as { wallet_set_id: string; user_id?: string });
  },
  get_wallet_info: async (a) => {
    const { handleGetWalletInfo } = await import(`${MCP}/wallet.js`);
    return handleGetWalletInfo(a as { wallet_id: string });
  },
  get_eoa_wallets: async (a) => {
    const { handleGetEoaWallets } = await import(`${MCP}/wallet.js`);
    return handleGetEoaWallets(a as { user_id: string });
  },
  init_eoa_wallet: async (a) => {
    const { handleInitEoaWallet } = await import(`${MCP}/wallet.js`);
    return handleInitEoaWallet(a as { user_id: string; blockchain?: string });
  },
  get_transaction_history: async (a) => {
    const { handleGetTransactionHistory } = await import(`${MCP}/wallet.js`);
    return handleGetTransactionHistory(a as { user_id: string; limit?: number; tx_type?: string });
  },
  get_user_wallets: async (a) => {
    const { handleGetUserWallets } = await import(`${MCP}/wallet.js`);
    return handleGetUserWallets(a as { user_id: string });
  },

  // ── OTTOVault (no Supabase) ───────────────────────────────────────────
  vault_status: async (a) => {
    const { handleVaultStatus } = await import(`${MCP}/vault.js`);
    return handleVaultStatus(a as { chain?: string; vault_address?: string; user_id?: string; eth_address?: string });
  },
  vault_transfer: async (a) => {
    const { handleVaultTransfer } = await import(`${MCP}/vault.js`);
    return handleVaultTransfer(a as { to: string; amount_usdc: number; chain?: string; vault_address?: string; user_id?: string; eth_address?: string });
  },
  vault_can_transfer: async (a) => {
    const { handleVaultCanTransfer } = await import(`${MCP}/vault.js`);
    return handleVaultCanTransfer(a as { to: string; amount_usdc: number; chain?: string; vault_address?: string; user_id?: string; eth_address?: string });
  },
  vault_deposit: async (a) => {
    const { handleVaultDeposit } = await import(`${MCP}/vault.js`);
    return handleVaultDeposit(a as { amount_usdc: number; chain?: string; vault_address?: string; user_id?: string; eth_address?: string });
  },
  rebalance_check: async (a) => {
    const { handleRebalanceCheck } = await import(`${MCP}/vault.js`);
    return handleRebalanceCheck(a as { min_usdc?: number; user_id?: string; eth_address?: string });
  },
  deploy_user_vault: async (a) => {
    const { handleDeployUserVault } = await import(`${MCP}/vault.js`);
    return handleDeployUserVault(a as { user_id: string; chain?: string; max_per_tx_usdc?: number; daily_limit_usdc?: number });
  },
  get_user_vault: async (a) => {
    const { handleGetUserVault } = await import(`${MCP}/vault.js`);
    return handleGetUserVault(a as { user_id: string; chain?: string });
  },
  register_user_address: async (a) => {
    const { handleRegisterUserAddress } = await import(`${MCP}/vault.js`);
    return handleRegisterUserAddress(a as { user_id: string; eth_address: string });
  },
  get_user_address: async (a) => {
    const { handleGetUserAddress } = await import(`${MCP}/vault.js`);
    return handleGetUserAddress(a as { user_id: string });
  },
  transfer_vault_admin: async (a) => {
    const { handleTransferVaultAdmin } = await import(`${MCP}/vault.js`);
    return handleTransferVaultAdmin(a as { user_id: string; chain?: string; vault_address?: string });
  },
  encode_admin_tx: async (a) => {
    const { handleEncodeAdminTx } = await import(`${MCP}/vault.js`);
    return handleEncodeAdminTx(a as AnyArgs & { function: string });
  },
  create_invoice: async (a) => {
    const { handleCreateInvoice } = await import(`${MCP}/vault.js`);
    return handleCreateInvoice(a as { expected_amount_usdc: number; user_id?: string; chain?: string; vault_address?: string; expected_sender?: string; expires_hours?: number });
  },
  check_invoice_status: async (a) => {
    const { handleCheckInvoiceStatus } = await import(`${MCP}/vault.js`);
    return handleCheckInvoiceStatus(a as { invoice_id: string });
  },
  vault_check_whitelist: async (a) => {
    const { handleVaultCheckWhitelist } = await import(`${MCP}/vault.js`);
    return handleVaultCheckWhitelist(a as { address: string; chain?: string; vault_address?: string; user_id?: string; eth_address?: string });
  },
  vault_payroll: async (a) => {
    const { handleVaultPayroll } = await import(`${MCP}/vault.js`);
    return handleVaultPayroll(a as { recipients: Array<{ address: string; amount_usdc: number }>; chain?: string; vault_address?: string; user_id?: string; eth_address?: string });
  },

  // ── x402 (no Supabase) ────────────────────────────────────────────────
  x402_fetch: async (a) => {
    const { handleX402Fetch } = await import(`${MCP}/x402.js`);
    return handleX402Fetch(a as { url: string; method?: string; body?: string });
  },
  x402_payer_info: async () => {
    const { handleX402PayerInfo } = await import(`${MCP}/x402.js`);
    return handleX402PayerInfo({} as never);
  },

  // ── Stork Oracle (no Supabase) ──────────────────────────────────────
  stork_price_feed: async (a) => {
    const { handleStorkPrice } = await import(`${MCP}/stork.js`);
    return handleStorkPrice(a as { assets?: string });
  },
  stork_onchain_price: async (a) => {
    const { handleStorkOnChainPrice } = await import(`${MCP}/stork.js`);
    return handleStorkOnChainPrice(a as { asset?: string; chain?: string });
  },

  // ── USYC Yield (no Supabase) ───────────────────────────────────────
  usyc_rate: async () => {
    const { handleUsycRate } = await import(`${MCP}/usyc.js`);
    return handleUsycRate();
  },
  usyc_balance: async (a) => {
    const { handleUsycBalance } = await import(`${MCP}/usyc.js`);
    return handleUsycBalance(a as { address?: string; chain?: string });
  },
  usyc_deposit: async (a) => {
    const { handleUsycDeposit } = await import(`${MCP}/usyc.js`);
    return handleUsycDeposit(a as { amount_usdc: number; chain?: string });
  },
  usyc_redeem: async (a) => {
    const { handleUsycRedeem } = await import(`${MCP}/usyc.js`);
    return handleUsycRedeem(a as { amount_usyc: number; chain?: string });
  },

  // ── OTTOVault V2 Governance (no Supabase) ─────────────────────────
  v2_deploy: async (a) => {
    const { handleVaultV2Deploy } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Deploy(a as { factory_address: string; salt: string; shareholders: string[]; shares_bps: number[]; max_per_tx_usdc?: number; daily_limit_usdc?: number; whitelist_enabled?: boolean });
  },
  v2_status: async (a) => {
    const { handleVaultV2Status } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Status(a as { vault_address: string });
  },
  v2_shareholders: async (a) => {
    const { handleVaultV2Shareholders } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Shareholders(a as { vault_address: string; shareholders: string[] });
  },
  v2_distribute_revenue: async (a) => {
    const { handleVaultV2DistributeRevenue } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2DistributeRevenue(a as { vault_address: string; amount_usdc: number });
  },
  v2_claim_revenue: async (a) => {
    const { handleVaultV2ClaimRevenue } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2ClaimRevenue(a as { vault_address: string });
  },
  v2_propose: async (a) => {
    const { handleVaultV2Propose } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Propose(a as { vault_address: string; governor_address: string; action: "setCeo" | "dissolve"; new_ceo?: string; description: string });
  },
  v2_vote: async (a) => {
    const { handleVaultV2Vote } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Vote(a as { governor_address: string; proposal_id: string; support: number });
  },
  v2_execute: async (a) => {
    const { handleVaultV2Execute } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Execute(a as { vault_address: string; governor_address: string; action: "setCeo" | "dissolve"; new_ceo?: string; description: string });
  },
  v2_invest_yield: async (a) => {
    const { handleVaultV2InvestYield } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2InvestYield(a as { vault_address: string; amount_usdc: number });
  },
  v2_redeem_yield: async (a) => {
    const { handleVaultV2RedeemYield } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2RedeemYield(a as { vault_address: string; amount_usyc: number });
  },
  v2_dissolve_status: async (a) => {
    const { handleVaultV2DissolveStatus } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2DissolveStatus(a as { vault_address: string; shareholders: string[] });
  },
  v2_transfer: async (a) => {
    const { handleVaultV2Transfer } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Transfer(a as { vault_address: string; to: string; amount_usdc: number });
  },
  v2_deposit: async (a) => {
    const { handleVaultV2Deposit } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Deposit(a as { vault_address: string; amount_usdc: number });
  },
  v2_whitelist: async (a) => {
    const { handleVaultV2Whitelist } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Whitelist(a as { vault_address: string; address: string; allowed: boolean });
  },
  v2_whitelist_toggle: async (a) => {
    const { handleVaultV2WhitelistToggle } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2WhitelistToggle(a as { vault_address: string; enabled: boolean });
  },
  v2_ceo_transfer: async (a) => {
    const { handleVaultV2CeoTransfer } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2CeoTransfer(a as { vault_address: string; to: string; amount_usdc: number });
  },
  v2_withdraw: async (a) => {
    const { handleVaultV2Withdraw } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Withdraw(a as { vault_address: string; amount_usdc: number });
  },
  v2_set_limits: async (a) => {
    const { handleVaultV2SetLimits } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2SetLimits(a as { vault_address: string; max_per_tx_usdc: number; daily_limit_usdc: number });
  },
  v2_pause: async (a) => {
    const { handleVaultV2Pause } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Pause(a as { vault_address: string; paused: boolean });
  },
  v2_finalize: async (a) => {
    const { handleVaultV2Finalize } = await import(`${MCP}/vault-v2.js`);
    return handleVaultV2Finalize(a as { vault_address: string });
  },

  // ── Chat Governance (multi-DAC) ──────────────────────────────────────
  gov_setup: async (a) => {
    const { handleGovSetup } = await import(`${MCP}/governance.js`);
    return handleGovSetup(a as { vault_address: string; governor_address: string; share_token_address: string; name?: string; shareholders?: string[]; chat_id?: string; invite_link?: string });
  },
  gov_link: async (a) => {
    const { handleGovLink } = await import(`${MCP}/governance.js`);
    return handleGovLink(a as { user_id: string; eth_address: string; display_name?: string; vault_address?: string });
  },
  gov_members: async (a) => {
    const { handleGovMembers } = await import(`${MCP}/governance.js`);
    return handleGovMembers(a as { vault_address?: string });
  },
  gov_my_info: async (a) => {
    const { handleGovMyInfo } = await import(`${MCP}/governance.js`);
    return handleGovMyInfo(a as { user_id: string; vault_address?: string });
  },
  gov_propose: async (a) => {
    const { handleGovPropose } = await import(`${MCP}/governance.js`);
    return handleGovPropose(a as { user_id: string; action: "setCeo" | "dissolve"; description: string; new_ceo?: string; vault_address?: string });
  },
  gov_vote: async (a) => {
    const { handleGovVote } = await import(`${MCP}/governance.js`);
    return handleGovVote(a as { user_id: string; proposal_id: string; support: number; vault_address?: string });
  },
  gov_tally: async (a) => {
    const { handleGovTally } = await import(`${MCP}/governance.js`);
    return handleGovTally(a as { proposal_id?: string; vault_address?: string });
  },
  gov_add_members: async (a) => {
    const { handleGovAddMembers } = await import(`${MCP}/governance.js`);
    return handleGovAddMembers(a as { vault_address?: string; members: Array<{ user_id: string; eth_address: string; display_name?: string }> });
  },
  gov_dacs: async () => {
    const { handleGovDacs } = await import(`${MCP}/governance.js`);
    return handleGovDacs();
  },
};

async function main() {
  const [, , toolName, argsJson] = process.argv;

  if (!toolName) {
    console.error("Usage: tsx invoke.ts <tool_name> [json_args]");
    console.error("\nAvailable tools:");
    Object.keys(HANDLERS).forEach((t) => console.error(`  ${t}`));
    process.exit(1);
  }

  const handler = HANDLERS[toolName];
  if (!handler) {
    console.error(`Unknown tool: ${toolName}`);
    process.exit(1);
  }

  let args: AnyArgs = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch {
      console.error(`Invalid JSON args: ${argsJson}`);
      process.exit(1);
    }
  }

  const result = await handler(args);
  console.log(result);
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
