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
  http,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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

// ─── User Vault Registry ────────────────────────────────────────────────────

const USER_VAULTS_PATH = join(
  process.env.HOME ?? "/tmp",
  ".otto",
  "user-vaults.json"
);

type UserVaultRegistry = Record<string, Partial<Record<SupportedChain, string>>>;

function loadUserVaults(): UserVaultRegistry {
  if (!existsSync(USER_VAULTS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(USER_VAULTS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveUserVaults(registry: UserVaultRegistry): void {
  const dir = join(process.env.HOME ?? "/tmp", ".otto");
  mkdirSync(dir, { recursive: true });
  writeFileSync(USER_VAULTS_PATH, JSON.stringify(registry, null, 2));
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
 * The agent wallet is both deployer (admin) and operator.
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

  return JSON.stringify({
    success: true,
    vault: vaultAddr,
    chain,
    chainName: CHAIN_NAMES[chain],
    user_id,
    txHash,
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
