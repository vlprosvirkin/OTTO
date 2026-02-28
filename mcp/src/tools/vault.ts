/**
 * OTTOVault MCP Tools — Multi-chain
 *
 * Interact with OTTOVault treasury contracts on any supported chain.
 * Spending limits are enforced at the EVM level on each chain independently.
 *
 * Supported chains: arcTestnet | baseSepolia | avalancheFuji
 *
 * Environment variables:
 *   X402_PAYER_PRIVATE_KEY   — Agent private key (same wallet used for x402)
 *   VAULT_ADDRESS_ARC        — OTTOVault on Arc Testnet (default: deployed)
 *   VAULT_ADDRESS_BASE       — OTTOVault on Base Sepolia (set after deployment)
 *   VAULT_ADDRESS_FUJI       — OTTOVault on Avalanche Fuji (set after deployment)
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isAddress,
  getAddress,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { OTTO_VAULT_BYTECODE } from "./vault-bytecode.js";
import { baseSepolia, avalancheFuji } from "viem/chains";
import { arcTestnet } from "../lib/circle/gateway-sdk.js";

// ─── Chain registry ───────────────────────────────────────────────────────────

type SupportedChain = "arcTestnet" | "baseSepolia" | "avalancheFuji";

const CHAINS: Record<SupportedChain, Chain> = {
  arcTestnet,
  baseSepolia,
  avalancheFuji,
};

const CHAIN_NAMES: Record<SupportedChain, string> = {
  arcTestnet:    "Arc Testnet (5042002)",
  baseSepolia:   "Base Sepolia (84532)",
  avalancheFuji: "Avalanche Fuji (43113)",
};

const EXPLORER_TX: Record<SupportedChain, string> = {
  arcTestnet:    "https://explorer.testnet.arc.network/tx",
  baseSepolia:   "https://sepolia.basescan.org/tx",
  avalancheFuji: "https://testnet.snowtrace.io/tx",
};

// OTTOVault deployed addresses per chain
// Arc Testnet:    nonce 0 → 0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA
// Base Sepolia:   nonce 1 (redeployed with correct USDC) → 0x47C1feaC66381410f5B050c39F67f15BbD058Af1
// Avalanche Fuji: nonce 1 (redeployed with correct USDC) → 0x47C1feaC66381410f5B050c39F67f15BbD058Af1
const DEFAULT_VAULT_ADDRESSES: Record<SupportedChain, string> = {
  arcTestnet:    process.env.VAULT_ADDRESS_ARC  ?? "0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA",
  baseSepolia:   process.env.VAULT_ADDRESS_BASE ?? "0x47C1feaC66381410f5B050c39F67f15BbD058Af1",
  avalancheFuji: process.env.VAULT_ADDRESS_FUJI ?? "0x47C1feaC66381410f5B050c39F67f15BbD058Af1",
};

// ─── Contract ABI ─────────────────────────────────────────────────────────────

const VAULT_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "status",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "balance_", type: "uint256" },
      { name: "maxPerTx_", type: "uint256" },
      { name: "dailyLimit_", type: "uint256" },
      { name: "dailySpent_", type: "uint256" },
      { name: "remainingToday_", type: "uint256" },
      { name: "whitelistEnabled_", type: "bool" },
      { name: "paused_", type: "bool" },
      { name: "agent_", type: "address" },
      { name: "admin_", type: "address" },
    ],
  },
  {
    name: "canTransfer",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "reason", type: "string" },
    ],
  },
] as const;

// Admin-only functions (for encode_admin_tx and transferAdmin after deployment)
const VAULT_ADMIN_ABI = [
  {
    name: "setLimits",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_maxPerTx", type: "uint256" },
      { name: "_dailyLimit", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "setWhitelist",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "addr", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "setWhitelistEnabled",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "enabled", type: "bool" }],
    outputs: [],
  },
  {
    name: "setAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newAgent", type: "address" }],
    outputs: [],
  },
  {
    name: "transferAdmin",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newAdmin", type: "address" }],
    outputs: [],
  },
  {
    name: "setPaused",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_paused", type: "bool" }],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveChain(chain?: string): SupportedChain {
  if (!chain) return "arcTestnet";
  if (chain === "arcTestnet" || chain === "baseSepolia" || chain === "avalancheFuji") {
    return chain;
  }
  throw new Error(
    `Unsupported chain: "${chain}". Use: arcTestnet | baseSepolia | avalancheFuji`
  );
}

function resolveVaultAddress(chain: SupportedChain, vaultAddress?: string): Address {
  return (vaultAddress ?? DEFAULT_VAULT_ADDRESSES[chain]) as Address;
}

function getPublicClient(chain: SupportedChain) {
  return createPublicClient({ chain: CHAINS[chain], transport: http() });
}

function getAgentWalletClient(chain: SupportedChain) {
  const pk = process.env.X402_PAYER_PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      "X402_PAYER_PRIVATE_KEY is not set. Set it to the agent's EVM private key (0x-prefixed)."
    );
  }
  const account = privateKeyToAccount(pk as `0x${string}`);
  return {
    client: createWalletClient({ account, chain: CHAINS[chain], transport: http() }),
    account,
  };
}

function formatUsdc(atomic: bigint): string {
  return (Number(atomic) / 1_000_000).toFixed(6);
}

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

export interface VaultStatusParams {
  chain?: string;
  vault_address?: string;
}

/**
 * Read the full status of an OTTOVault on the specified chain.
 */
export async function handleVaultStatus(params: VaultStatusParams): Promise<string> {
  const chain = resolveChain(params.chain);
  const vaultAddr = resolveVaultAddress(chain, params.vault_address);
  const client = getPublicClient(chain);

  const result = (await client.readContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "status",
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];

  const [balance, maxPerTx, dailyLimit, dailySpent, remainingToday,
         whitelistEnabled, paused, agent, admin] = result;

  return [
    `## OTTOVault Status`,
    `**Contract**: ${vaultAddr}`,
    `**Chain**: ${CHAIN_NAMES[chain]}`,
    ``,
    `### Balance`,
    `**Vault Balance**: ${formatUsdc(balance)} USDC`,
    ``,
    `### Spending Limits`,
    `**Per-tx cap**: ${formatUsdc(maxPerTx)} USDC`,
    `**Daily limit**: ${formatUsdc(dailyLimit)} USDC`,
    `**Spent today**: ${formatUsdc(dailySpent)} USDC`,
    `**Remaining today**: ${formatUsdc(remainingToday)} USDC`,
    ``,
    `### Access Control`,
    `**Agent**: ${agent}`,
    `**Admin**: ${admin}`,
    `**Whitelist**: ${whitelistEnabled ? "Enabled" : "Disabled"}`,
    `**Paused**: ${paused ? "YES — transfers blocked" : "No"}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────

export interface VaultTransferParams {
  to: string;
  amount_usdc: number;
  chain?: string;
  vault_address?: string;
}

/**
 * Transfer USDC from an OTTOVault to a recipient.
 * Enforces per-tx and daily limits on-chain — no overrides possible.
 */
export async function handleVaultTransfer(params: VaultTransferParams): Promise<string> {
  const { to, amount_usdc } = params;
  const chain = resolveChain(params.chain);
  const vaultAddr = resolveVaultAddress(chain, params.vault_address);

  if (!to?.startsWith("0x")) throw new Error("Invalid recipient — must be 0x-prefixed");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("Amount must be positive");

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const toAddr = to as Address;
  const publicClient = getPublicClient(chain);

  // Pre-flight check
  const [ok, reason] = (await publicClient.readContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "canTransfer",
    args: [toAddr, amountAtomic],
  })) as [boolean, string];

  if (!ok) {
    return JSON.stringify({ success: false, reason, to, amount_usdc, chain, vault: vaultAddr });
  }

  // Execute
  const { client, account } = getAgentWalletClient(chain);
  const txHash = await client.writeContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "transfer",
    args: [toAddr, amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    txHash,
    blockNumber: receipt.blockNumber.toString(),
    to,
    amount_usdc,
    chain,
    vault: vaultAddr,
    explorerUrl: `${EXPLORER_TX[chain]}/${txHash}`,
  }, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface VaultCanTransferParams {
  to: string;
  amount_usdc: number;
  chain?: string;
  vault_address?: string;
}

/**
 * Preview whether a vault transfer would succeed — no transaction sent.
 */
export async function handleVaultCanTransfer(params: VaultCanTransferParams): Promise<string> {
  const { to, amount_usdc } = params;
  const chain = resolveChain(params.chain);
  const vaultAddr = resolveVaultAddress(chain, params.vault_address);
  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));

  const client = getPublicClient(chain);
  const [ok, reason] = (await client.readContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "canTransfer",
    args: [to as Address, amountAtomic],
  })) as [boolean, string];

  return JSON.stringify({
    ok,
    reason: ok ? "Transfer would succeed" : reason,
    to,
    amount_usdc,
    chain,
    vault: vaultAddr,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const USDC_ADDRESS: Record<SupportedChain, Address> = {
  arcTestnet:    "0x3600000000000000000000000000000000000000",
  baseSepolia:   "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  avalancheFuji: "0x5425890298aed601595a70ab815c96711a31bc65",
};

export interface VaultDepositParams {
  amount_usdc: number;
  chain?: string;
  vault_address?: string;
}

/**
 * Deposit USDC from the agent wallet into an OTTOVault.
 * Requires: agent wallet has sufficient USDC on the target chain.
 * Steps: approve(vault, amount) → deposit(amount)
 */
export async function handleVaultDeposit(params: VaultDepositParams): Promise<string> {
  const { amount_usdc } = params;
  const chain = resolveChain(params.chain);
  const vaultAddr = resolveVaultAddress(chain, params.vault_address);

  if (!amount_usdc || amount_usdc <= 0) throw new Error("Amount must be positive");

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient(chain);
  const publicClient = getPublicClient(chain);
  const usdcAddr = USDC_ADDRESS[chain];

  // Check agent balance first
  const balance = (await publicClient.readContract({
    address: usdcAddr,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  if (balance < amountAtomic) {
    return JSON.stringify({
      success: false,
      reason: `Insufficient agent USDC balance: ${formatUsdc(balance)} USDC (need ${formatUsdc(amountAtomic)})`,
      chain,
      vault: vaultAddr,
    });
  }

  // Step 1: approve vault to pull USDC
  const approveTx = await client.writeContract({
    address: usdcAddr,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [vaultAddr, amountAtomic],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 30_000 });

  // Step 2: deposit into vault
  const depositTx = await client.writeContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "deposit",
    args: [amountAtomic],
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    depositTxHash: depositTx,
    approveTxHash: approveTx,
    amount_usdc,
    chain,
    vault: vaultAddr,
    explorerUrl: `${EXPLORER_TX[chain]}/${depositTx}`,
  }, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface RebalanceCheckParams {
  min_usdc?: number;
}

/**
 * Check vault balances on all 3 chains and recommend rebalancing actions.
 * Returns a JSON report: which chains are healthy, low, or critical.
 */
export async function handleRebalanceCheck(params: RebalanceCheckParams): Promise<string> {
  const min = params.min_usdc ?? 5;
  const chains: SupportedChain[] = ["arcTestnet", "baseSepolia", "avalancheFuji"];

  const results = await Promise.all(chains.map(async (chain) => {
    const vaultAddr = resolveVaultAddress(chain);
    const client = getPublicClient(chain);

    const raw = (await client.readContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "status",
    })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];

    const [balance, maxPerTx, dailyLimit, , remainingToday, , paused] = raw;
    const balanceUsdc = Number(balance) / 1_000_000;
    const status = paused ? "paused" : balanceUsdc < min ? (balanceUsdc === 0 ? "empty" : "low") : "healthy";

    return {
      chain,
      chainName: CHAIN_NAMES[chain],
      vault: vaultAddr,
      balance_usdc: balanceUsdc,
      max_per_tx_usdc: Number(maxPerTx) / 1_000_000,
      daily_limit_usdc: Number(dailyLimit) / 1_000_000,
      remaining_today_usdc: Number(remainingToday) / 1_000_000,
      status,
      needs_funding: balanceUsdc < min,
      shortfall_usdc: balanceUsdc < min ? min - balanceUsdc : 0,
    };
  }));

  const needFunding = results.filter((r) => r.needs_funding);
  const healthy = results.filter((r) => !r.needs_funding);

  return JSON.stringify({
    threshold_usdc: min,
    chains: results,
    summary: {
      healthy: healthy.map((r) => r.chain),
      needs_funding: needFunding.map((r) => r.chain),
      total_shortfall_usdc: needFunding.reduce((s, r) => s + r.shortfall_usdc, 0),
      recommendation: needFunding.length === 0
        ? "All vaults healthy — no rebalancing needed."
        : `Fund ${needFunding.map((r) => r.chain).join(", ")} with at least ${needFunding.map((r) => `${r.shortfall_usdc.toFixed(2)} USDC on ${r.chain}`).join("; ")}.`,
    },
  }, null, 2);
}

// ─── Registry helpers ────────────────────────────────────────────────────────

const OTTO_DIR = join(process.env.HOME ?? "/tmp", ".otto");
const USER_VAULTS_PATH = join(OTTO_DIR, "user-vaults.json");
const USERS_PATH       = join(OTTO_DIR, "users.json");
const INVOICES_PATH    = join(OTTO_DIR, "invoices.json");

function ottoDirEnsure(): void {
  mkdirSync(OTTO_DIR, { recursive: true });
}

// ── Vault registry ──

type UserVaultRegistry = Record<string, Partial<Record<SupportedChain, string>>>;

function loadUserVaults(): UserVaultRegistry {
  if (!existsSync(USER_VAULTS_PATH)) return {};
  try { return JSON.parse(readFileSync(USER_VAULTS_PATH, "utf8")); } catch { return {}; }
}

function saveUserVaults(registry: UserVaultRegistry): void {
  ottoDirEnsure();
  writeFileSync(USER_VAULTS_PATH, JSON.stringify(registry, null, 2));
}

// ── User registry (Telegram user_id → eth_address) ──

type UserRecord = { eth_address?: string };
type UserRegistry = Record<string, UserRecord>;

function loadUsers(): UserRegistry {
  if (!existsSync(USERS_PATH)) return {};
  try { return JSON.parse(readFileSync(USERS_PATH, "utf8")); } catch { return {}; }
}

function saveUsers(registry: UserRegistry): void {
  ottoDirEnsure();
  writeFileSync(USERS_PATH, JSON.stringify(registry, null, 2));
}

// ── Invoice registry ──

type InvoiceStatus = "pending" | "paid" | "expired";

interface Invoice {
  invoice_id: string;
  vault_address: string;
  chain: SupportedChain;
  expected_amount_usdc: number;
  expected_sender?: string;
  created_at: string;
  expires_at: string;
  initial_vault_balance_usdc: number;
  status: InvoiceStatus;
}

type InvoiceRegistry = Record<string, Invoice>;

function loadInvoices(): InvoiceRegistry {
  if (!existsSync(INVOICES_PATH)) return {};
  try { return JSON.parse(readFileSync(INVOICES_PATH, "utf8")); } catch { return {}; }
}

function saveInvoices(registry: InvoiceRegistry): void {
  ottoDirEnsure();
  writeFileSync(INVOICES_PATH, JSON.stringify(registry, null, 2));
}

const VAULT_CONSTRUCTOR_ABI = [
  {
    type: "constructor",
    inputs: [
      { name: "_usdc", type: "address" },
      { name: "_agent", type: "address" },
      { name: "_maxPerTx", type: "uint256" },
      { name: "_dailyLimit", type: "uint256" },
      { name: "_whitelistEnabled", type: "bool" },
    ],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────

export interface DeployUserVaultParams {
  user_id: string;
  chain?: string;
  max_per_tx_usdc?: number;
  daily_limit_usdc?: number;
}

/**
 * Deploy a personal OTTOVault on testnet for a given user (identified by Telegram user_id).
 * If the user has registered an ETH address via register_user_address, admin ownership is
 * immediately transferred to that address so OTTO only acts as agent (limited executor).
 * Default limits: 10 USDC/tx, 100 USDC/day.
 */
export async function handleDeployUserVault(params: DeployUserVaultParams): Promise<string> {
  const { user_id } = params;
  const chain = resolveChain(params.chain);
  const maxPerTxUsdc = params.max_per_tx_usdc ?? 10;
  const dailyLimitUsdc = params.daily_limit_usdc ?? 100;

  if (!user_id) throw new Error("user_id is required");

  const registry = loadUserVaults();
  if (registry[user_id]?.[chain]) {
    return JSON.stringify({
      already_exists: true,
      vault: registry[user_id][chain],
      chain,
      user_id,
      message: `Vault already deployed for user ${user_id} on ${chain}`,
    });
  }

  const { client, account } = getAgentWalletClient(chain);
  const publicClient = getPublicClient(chain);
  const usdcAddr = USDC_ADDRESS[chain];
  const maxPerTxAtomic = BigInt(Math.round(maxPerTxUsdc * 1_000_000));
  const dailyLimitAtomic = BigInt(Math.round(dailyLimitUsdc * 1_000_000));

  // Check if user has registered their own ETH address as admin
  const users = loadUsers();
  const userEthAddr = users[user_id]?.eth_address;

  const txHash = await client.deployContract({
    abi: VAULT_CONSTRUCTOR_ABI,
    bytecode: OTTO_VAULT_BYTECODE,
    args: [usdcAddr, account.address, maxPerTxAtomic, dailyLimitAtomic, false],
    account,
    gas: 2_000_000n, // explicit gas to avoid estimation issues on Arc Testnet
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
  const vaultAddr = receipt.contractAddress;

  if (!vaultAddr || receipt.status !== "success") {
    return JSON.stringify({ success: false, txHash, reason: "Deployment failed or no contract address" });
  }

  // Persist mapping
  if (!registry[user_id]) registry[user_id] = {};
  registry[user_id][chain] = vaultAddr;
  saveUserVaults(registry);

  // If user has a registered ETH address, hand admin control over immediately
  let transferAdminTxHash: string | undefined;
  let adminAddr = account.address as string;

  if (userEthAddr && userEthAddr.toLowerCase() !== account.address.toLowerCase()) {
    const transferTx = await client.writeContract({
      address: vaultAddr,
      abi: VAULT_ADMIN_ABI,
      functionName: "transferAdmin",
      args: [userEthAddr as Address],
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: transferTx, timeout: 30_000 });
    transferAdminTxHash = transferTx;
    adminAddr = userEthAddr;
  }

  return JSON.stringify({
    success: true,
    vault: vaultAddr,
    chain,
    chainName: CHAIN_NAMES[chain],
    user_id,
    txHash,
    admin: adminAddr,
    agent: account.address,
    admin_controlled_by_user: !!userEthAddr,
    transfer_admin_tx: transferAdminTxHash ?? null,
    max_per_tx_usdc: maxPerTxUsdc,
    daily_limit_usdc: dailyLimitUsdc,
    explorerUrl: `${EXPLORER_TX[chain]}/${txHash}`,
  }, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface GetUserVaultParams {
  user_id: string;
  chain?: string;
}

/**
 * Look up a user's vault address(es) from the registry.
 * If chain is omitted, returns all vaults for the user.
 */
export async function handleGetUserVault(params: GetUserVaultParams): Promise<string> {
  const { user_id } = params;
  if (!user_id) throw new Error("user_id is required");

  const registry = loadUserVaults();
  const userVaults = registry[user_id] ?? {};

  if (params.chain) {
    const chain = resolveChain(params.chain);
    const vaultAddr = userVaults[chain];
    return JSON.stringify({
      user_id,
      chain,
      vault: vaultAddr ?? null,
      exists: !!vaultAddr,
    });
  }

  const vaults = (Object.keys(CHAINS) as SupportedChain[]).map((chain) => ({
    chain,
    chainName: CHAIN_NAMES[chain],
    vault: userVaults[chain] ?? null,
  }));

  return JSON.stringify({
    user_id,
    vaults,
    total_deployed: vaults.filter((v) => v.vault).length,
  }, null, 2);
}

// ─── User address registration ────────────────────────────────────────────────

export interface RegisterUserAddressParams {
  user_id: string;
  eth_address: string;
}

/**
 * Register a user's own ETH wallet address.
 * This address will become the admin of any future vaults deployed for this user.
 * For existing custodial vaults, call transfer_vault_admin to hand over control.
 */
export async function handleRegisterUserAddress(params: RegisterUserAddressParams): Promise<string> {
  const { user_id, eth_address } = params;
  if (!user_id) throw new Error("user_id is required");
  if (!eth_address) throw new Error("eth_address is required");

  // Validate and normalize the address
  if (!isAddress(eth_address)) {
    return JSON.stringify({ success: false, reason: `Invalid ETH address: ${eth_address}` });
  }
  const checksummed = getAddress(eth_address);

  const users = loadUsers();
  const previous = users[user_id]?.eth_address;
  if (!users[user_id]) users[user_id] = {};
  users[user_id].eth_address = checksummed;
  saveUsers(users);

  return JSON.stringify({
    success: true,
    user_id,
    eth_address: checksummed,
    previous_address: previous ?? null,
    message: previous
      ? `Updated ETH address from ${previous} to ${checksummed}`
      : `Registered ETH address ${checksummed} for user ${user_id}`,
    note: "Future vault deployments will set you as admin. Use transfer_vault_admin to claim existing vaults.",
  }, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface GetUserAddressParams {
  user_id: string;
}

/**
 * Get a user's registered ETH wallet address.
 */
export async function handleGetUserAddress(params: GetUserAddressParams): Promise<string> {
  const { user_id } = params;
  if (!user_id) throw new Error("user_id is required");

  const users = loadUsers();
  const record = users[user_id];

  return JSON.stringify({
    user_id,
    eth_address: record?.eth_address ?? null,
    registered: !!record?.eth_address,
  });
}

// ─── Admin ownership transfer ─────────────────────────────────────────────────

export interface TransferVaultAdminParams {
  user_id: string;
  chain?: string;
  vault_address?: string;
}

/**
 * Transfer admin ownership of a user's vault from OTTO wallet to the user's registered ETH address.
 * Only works if OTTO is currently the admin (e.g. custodial vaults deployed before user registered address).
 */
export async function handleTransferVaultAdmin(params: TransferVaultAdminParams): Promise<string> {
  const { user_id } = params;
  const chain = resolveChain(params.chain);

  if (!user_id) throw new Error("user_id is required");

  // Get user's registered ETH address
  const users = loadUsers();
  const userEthAddr = users[user_id]?.eth_address;
  if (!userEthAddr) {
    return JSON.stringify({
      success: false,
      reason: "No ETH address registered for this user. Call register_user_address first.",
    });
  }

  // Resolve vault address
  let vaultAddr: Address;
  if (params.vault_address) {
    vaultAddr = params.vault_address as Address;
  } else {
    const registry = loadUserVaults();
    const addr = registry[user_id]?.[chain];
    if (!addr) {
      return JSON.stringify({
        success: false,
        reason: `No vault found for user ${user_id} on ${chain}. Deploy one first.`,
      });
    }
    vaultAddr = addr as Address;
  }

  const { client, account } = getAgentWalletClient(chain);
  const publicClient = getPublicClient(chain);

  // Verify OTTO is currently admin
  const statusResult = (await publicClient.readContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "status",
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];
  const currentAdmin = statusResult[8]; // admin_ is index 8

  if (currentAdmin.toLowerCase() !== account.address.toLowerCase()) {
    return JSON.stringify({
      success: false,
      reason: `OTTO is not the current admin. Current admin: ${currentAdmin}`,
      current_admin: currentAdmin,
    });
  }

  const txHash = await client.writeContract({
    address: vaultAddr,
    abi: VAULT_ADMIN_ABI,
    functionName: "transferAdmin",
    args: [userEthAddr as Address],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    vault: vaultAddr,
    chain,
    new_admin: userEthAddr,
    previous_admin: account.address,
    txHash,
    explorerUrl: `${EXPLORER_TX[chain]}/${txHash}`,
    message: `Admin transferred to your wallet ${userEthAddr}. OTTO can no longer change vault settings.`,
  }, null, 2);
}

// ─── Encode admin transaction (Tier 3 — requires user's wallet signature) ────

export interface EncodeAdminTxParams {
  function: "setLimits" | "setWhitelist" | "setWhitelistEnabled" | "setAgent" | "transferAdmin" | "setPaused" | "withdraw";
  chain?: string;
  vault_address?: string;
  // setLimits
  max_per_tx_usdc?: number;
  daily_limit_usdc?: number;
  // setWhitelist
  address?: string;
  allowed?: boolean;
  // setWhitelistEnabled / setPaused
  enabled?: boolean;
  paused?: boolean;
  // setAgent / transferAdmin
  new_address?: string;
  // withdraw
  amount_usdc?: number;
}

const CHAIN_IDS: Record<SupportedChain, number> = {
  arcTestnet:    5042002,
  baseSepolia:   84532,
  avalancheFuji: 43113,
};

const SIGN_BASE_URL = process.env.OTTO_SIGN_URL ?? "https://ottoarc.xyz/sign";

/**
 * Encode calldata for an admin-only vault operation.
 * Returns the raw calldata that must be signed by the vault admin (user's own wallet).
 * OTTO cannot execute admin operations — they require the user's private key.
 */
export async function handleEncodeAdminTx(params: EncodeAdminTxParams): Promise<string> {
  const chain = resolveChain(params.chain);
  const vaultAddr = resolveVaultAddress(chain, params.vault_address);
  const fn = params.function;

  let data: `0x${string}`;
  let description: string;

  switch (fn) {
    case "setLimits": {
      const maxPerTx = params.max_per_tx_usdc;
      const daily = params.daily_limit_usdc;
      if (maxPerTx == null || daily == null) throw new Error("setLimits requires max_per_tx_usdc and daily_limit_usdc");
      data = encodeFunctionData({
        abi: VAULT_ADMIN_ABI,
        functionName: "setLimits",
        args: [BigInt(Math.round(maxPerTx * 1_000_000)), BigInt(Math.round(daily * 1_000_000))],
      });
      description = `Set per-tx limit to ${maxPerTx} USDC, daily limit to ${daily} USDC`;
      break;
    }
    case "setWhitelist": {
      const addr = params.address;
      const allowed = params.allowed;
      if (!addr || allowed == null) throw new Error("setWhitelist requires address and allowed");
      if (!isAddress(addr)) throw new Error(`Invalid address: ${addr}`);
      data = encodeFunctionData({
        abi: VAULT_ADMIN_ABI,
        functionName: "setWhitelist",
        args: [addr as Address, allowed],
      });
      description = `${allowed ? "Add" : "Remove"} ${addr} ${allowed ? "to" : "from"} recipient whitelist`;
      break;
    }
    case "setWhitelistEnabled": {
      const enabled = params.enabled;
      if (enabled == null) throw new Error("setWhitelistEnabled requires enabled (true/false)");
      data = encodeFunctionData({ abi: VAULT_ADMIN_ABI, functionName: "setWhitelistEnabled", args: [enabled] });
      description = `${enabled ? "Enable" : "Disable"} recipient whitelist enforcement`;
      break;
    }
    case "setAgent": {
      const newAgent = params.new_address;
      if (!newAgent || !isAddress(newAgent)) throw new Error("setAgent requires a valid new_address");
      data = encodeFunctionData({ abi: VAULT_ADMIN_ABI, functionName: "setAgent", args: [newAgent as Address] });
      description = `Replace vault agent with ${newAgent}`;
      break;
    }
    case "transferAdmin": {
      const newAdmin = params.new_address;
      if (!newAdmin || !isAddress(newAdmin)) throw new Error("transferAdmin requires a valid new_address");
      data = encodeFunctionData({ abi: VAULT_ADMIN_ABI, functionName: "transferAdmin", args: [newAdmin as Address] });
      description = `Transfer admin ownership to ${newAdmin}`;
      break;
    }
    case "setPaused": {
      const paused = params.paused;
      if (paused == null) throw new Error("setPaused requires paused (true/false)");
      data = encodeFunctionData({ abi: VAULT_ADMIN_ABI, functionName: "setPaused", args: [paused] });
      description = paused ? "Emergency pause — block all agent transfers" : "Unpause vault transfers";
      break;
    }
    case "withdraw": {
      const amount = params.amount_usdc;
      if (amount == null) throw new Error("withdraw requires amount_usdc");
      data = encodeFunctionData({
        abi: VAULT_ADMIN_ABI,
        functionName: "withdraw",
        args: [BigInt(Math.round(amount * 1_000_000))],
      });
      description = `Emergency withdraw ${amount} USDC (bypasses agent limits)`;
      break;
    }
    default:
      throw new Error(`Unknown admin function: ${fn}`);
  }

  const chainId = CHAIN_IDS[chain];
  const signingUrl = `${SIGN_BASE_URL}?to=${vaultAddr}&data=${encodeURIComponent(data)}&chainId=${chainId}&desc=${encodeURIComponent(description)}`;

  return JSON.stringify({
    function: fn,
    description,
    to: vaultAddr,
    data,
    chain,
    chainId,
    signing_url: signingUrl,
    instructions: [
      "Admin-only operation — requires your wallet signature.",
      `1. Open: ${signingUrl}`,
      "2. Connect your admin wallet (MetaMask / Rabby / Frame)",
      "3. Click Sign & Send — done.",
      "",
      "Or via CLI:",
      `cast send ${vaultAddr} ${data} --rpc-url <RPC> --private-key <YOUR_KEY>`,
    ].join("\n"),
  }, null, 2);
}

// ─── Invoice system (deposit compliance) ─────────────────────────────────────

export interface CreateInvoiceParams {
  user_id?: string;
  chain?: string;
  vault_address?: string;
  expected_amount_usdc: number;
  expected_sender?: string;
  expires_hours?: number;
}

/**
 * Create a payment invoice for incoming USDC to a vault.
 * Returns invoice details including payment instructions.
 * Use check_invoice_status to verify payment.
 */
export async function handleCreateInvoice(params: CreateInvoiceParams): Promise<string> {
  const chain = resolveChain(params.chain);
  const { expected_amount_usdc } = params;
  if (!expected_amount_usdc || expected_amount_usdc <= 0) throw new Error("expected_amount_usdc must be positive");

  // Resolve vault address
  let vaultAddr: string;
  if (params.vault_address) {
    vaultAddr = params.vault_address;
  } else if (params.user_id) {
    const registry = loadUserVaults();
    const addr = registry[params.user_id]?.[chain];
    if (!addr) throw new Error(`No vault for user ${params.user_id} on ${chain}. Deploy one first.`);
    vaultAddr = addr;
  } else {
    vaultAddr = DEFAULT_VAULT_ADDRESSES[chain];
  }

  // Capture current vault balance as baseline
  const publicClient = getPublicClient(chain);
  const statusResult = (await publicClient.readContract({
    address: vaultAddr as Address,
    abi: VAULT_ABI,
    functionName: "status",
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];
  const currentBalanceUsdc = Number(statusResult[0]) / 1_000_000;

  const invoiceId = `INV-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (params.expires_hours ?? 24) * 3_600_000);

  const invoice: Invoice = {
    invoice_id: invoiceId,
    vault_address: vaultAddr,
    chain,
    expected_amount_usdc,
    expected_sender: params.expected_sender,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    initial_vault_balance_usdc: currentBalanceUsdc,
    status: "pending",
  };

  const invoices = loadInvoices();
  invoices[invoiceId] = invoice;
  saveInvoices(invoices);

  return JSON.stringify({
    ...invoice,
    payment_instructions: [
      `Send ${expected_amount_usdc} USDC to vault ${vaultAddr} on ${CHAIN_NAMES[chain]}`,
      params.expected_sender ? `Expected sender: ${params.expected_sender}` : "Any sender accepted",
      `Expires: ${expiresAt.toISOString()}`,
      `Use check_invoice_status with invoice_id="${invoiceId}" to verify payment`,
    ].join("\n"),
  }, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface CheckInvoiceStatusParams {
  invoice_id: string;
}

/**
 * Check whether a payment invoice has been fulfilled.
 * Compares current vault balance against baseline captured at invoice creation.
 */
export async function handleCheckInvoiceStatus(params: CheckInvoiceStatusParams): Promise<string> {
  const { invoice_id } = params;
  if (!invoice_id) throw new Error("invoice_id is required");

  const invoices = loadInvoices();
  const invoice = invoices[invoice_id];
  if (!invoice) return JSON.stringify({ success: false, reason: `Invoice ${invoice_id} not found` });

  // Check expiry
  const now = new Date();
  if (invoice.status === "pending" && new Date(invoice.expires_at) < now) {
    invoice.status = "expired";
    invoices[invoice_id] = invoice;
    saveInvoices(invoices);
  }

  if (invoice.status !== "pending") {
    return JSON.stringify({ ...invoice, message: `Invoice ${invoice.status}` });
  }

  // Query current vault balance
  const publicClient = getPublicClient(invoice.chain);
  const statusResult = (await publicClient.readContract({
    address: invoice.vault_address as Address,
    abi: VAULT_ABI,
    functionName: "status",
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];
  const currentBalanceUsdc = Number(statusResult[0]) / 1_000_000;
  const increase = currentBalanceUsdc - invoice.initial_vault_balance_usdc;

  if (increase >= invoice.expected_amount_usdc - 0.0001) {
    invoice.status = "paid";
    invoices[invoice_id] = invoice;
    saveInvoices(invoices);
  }

  return JSON.stringify({
    ...invoice,
    current_vault_balance_usdc: currentBalanceUsdc,
    balance_increased_by_usdc: Math.max(0, increase),
    message: invoice.status === "paid"
      ? `Invoice paid ✓ Balance increased by ${increase.toFixed(6)} USDC`
      : `Pending — waiting for ${invoice.expected_amount_usdc} USDC (current increase: ${Math.max(0, increase).toFixed(6)} USDC)`,
  }, null, 2);
}
