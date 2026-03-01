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
 *
 * Vault addresses are resolved from ~/.otto/user-vaults.json registry (per user_id).
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isAddress,
  getAddress,
  keccak256,
  toHex,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

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
  arcTestnet:    "https://testnet.arcscan.app/tx",
  baseSepolia:   "https://sepolia.basescan.org/tx",
  avalancheFuji: "https://testnet.snowtrace.io/tx",
};

// Vault addresses resolved from user-vaults.json registry or on-chain via CREATE2.

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
      { name: "ceo_", type: "address" },
      { name: "governor_", type: "address" },
      { name: "state_", type: "uint8" },
      { name: "totalInvestedInYield_", type: "uint256" },
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
  {
    name: "whitelist",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "whitelistEnabled",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// CEO-only functions (V2: "admin" → "ceo")
const VAULT_CEO_ABI = [
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
    name: "transferCeo",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newCeo", type: "address" }],
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
    name: "ceoTransfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
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

async function resolveVaultAddress(chain: SupportedChain, vaultAddress?: string, userId?: string, ethAddress?: string): Promise<Address> {
  if (vaultAddress) return vaultAddress as Address;

  const registry = loadUserVaults();

  // Direct lookup by user_id
  if (userId) {
    const addr = registry[userId]?.[chain];
    if (addr) return addr as Address;
  }

  // Reverse lookup by eth_address: find user_id in users.json, then check registry
  if (ethAddress) {
    const users = loadUsers();
    const foundId = Object.entries(users).find(
      ([, u]) => u.eth_address?.toLowerCase() === ethAddress.toLowerCase()
    )?.[0];
    if (foundId) {
      const addr = registry[foundId]?.[chain];
      if (addr) return addr as Address;
    }
  }

  // On-chain discovery via OTTORegistry: look up DAC by salt derived from eth_address
  if (ethAddress) {
    try {
      const salt = keccak256(toHex(ethAddress.toLowerCase()));
      const client = getPublicClient(chain);
      const dac = await client.readContract({
        address: REGISTRY_ADDRESS,
        abi: REGISTRY_ABI,
        functionName: "getDac",
        args: [salt],
      }) as { vault: Address; shareToken: Address; governor: Address; ceo: Address; createdAt: bigint };

      if (dac.vault && dac.vault !== "0x0000000000000000000000000000000000000000") {
        // Found on-chain! Cache vault address + all DAC contracts
        const uid = userId ?? ethAddress.toLowerCase();
        if (!registry[uid]) registry[uid] = {};
        registry[uid][chain] = dac.vault;
        saveUserVaults(registry);
        cacheDacContracts({
          vault: dac.vault,
          shareToken: dac.shareToken,
          governor: dac.governor,
          ceo: dac.ceo,
        });
        return dac.vault;
      }
    } catch {
      // Registry lookup failed (e.g. chain doesn't have Registry deployed) — continue to error
    }
  }

  throw new Error(`No vault found for chain ${chain}. Deploy a vault first or provide vault_address.`);
}

// Default deploy params (must match frontend vault-config.ts)
const OTTO_AGENT_ADDRESS: Address = "0xA9A48d73f67b0c820fDE57c8B0639c6f850Ae96e";
const DEFAULT_MAX_PER_TX = BigInt(10_000_000);   // 10 USDC
const DEFAULT_DAILY_LIMIT = BigInt(100_000_000);  // 100 USDC

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
  user_id?: string;
  eth_address?: string;
}

/**
 * Read the full status of an OTTOVault on the specified chain.
 */
const STATE_LABELS = ["Active", "Dissolving", "Dissolved"];

export async function handleVaultStatus(params: VaultStatusParams): Promise<string> {
  const chain = resolveChain(params.chain);
  const vaultAddr = await resolveVaultAddress(chain, params.vault_address, params.user_id, params.eth_address);
  const client = getPublicClient(chain);

  const result = (await client.readContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "status",
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address, Address, number, bigint];

  const [balance, maxPerTx, dailyLimit, dailySpent, remainingToday,
         whitelistEnabled, paused, agent, ceo, governor, state, totalInvestedInYield] = result;

  return [
    `## OTTOVault V2 Status`,
    `**Contract**: ${vaultAddr}`,
    `**Chain**: ${CHAIN_NAMES[chain]}`,
    `**State**: ${STATE_LABELS[state] ?? "Unknown"}`,
    ``,
    `### Balance`,
    `**Vault Balance**: ${formatUsdc(balance)} USDC`,
    totalInvestedInYield > 0n ? `**Yield Invested**: ${formatUsdc(totalInvestedInYield)} USDC` : "",
    ``,
    `### Spending Limits`,
    `**Per-tx cap**: ${formatUsdc(maxPerTx)} USDC`,
    `**Daily limit**: ${formatUsdc(dailyLimit)} USDC`,
    `**Spent today**: ${formatUsdc(dailySpent)} USDC`,
    `**Remaining today**: ${formatUsdc(remainingToday)} USDC`,
    ``,
    `### Access Control`,
    `**Agent**: ${agent}`,
    `**CEO**: ${ceo}`,
    `**Governor**: ${governor}`,
    `**Whitelist**: ${whitelistEnabled ? "Enabled" : "Disabled"}`,
    `**Paused**: ${paused ? "YES — transfers blocked" : "No"}`,
  ].filter(Boolean).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────

export interface VaultTransferParams {
  to: string;
  amount_usdc: number;
  chain?: string;
  vault_address?: string;
  user_id?: string;
  eth_address?: string;
}

/**
 * Transfer USDC from an OTTOVault to a recipient.
 * Enforces per-tx and daily limits on-chain — no overrides possible.
 */
export async function handleVaultTransfer(params: VaultTransferParams): Promise<string> {
  const { to, amount_usdc } = params;
  const chain = resolveChain(params.chain);
  const vaultAddr = await resolveVaultAddress(chain, params.vault_address, params.user_id, params.eth_address);

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
  user_id?: string;
  eth_address?: string;
}

/**
 * Preview whether a vault transfer would succeed — no transaction sent.
 */
export async function handleVaultCanTransfer(params: VaultCanTransferParams): Promise<string> {
  const { to, amount_usdc } = params;
  const chain = resolveChain(params.chain);
  const vaultAddr = await resolveVaultAddress(chain, params.vault_address, params.user_id, params.eth_address);
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
  user_id?: string;
  eth_address?: string;
}

/**
 * Deposit USDC from the agent wallet into an OTTOVault.
 * Requires: agent wallet has sufficient USDC on the target chain.
 * Steps: approve(vault, amount) → deposit(amount)
 */
export async function handleVaultDeposit(params: VaultDepositParams): Promise<string> {
  const { amount_usdc } = params;
  const chain = resolveChain(params.chain);
  const vaultAddr = await resolveVaultAddress(chain, params.vault_address, params.user_id, params.eth_address);

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
  user_id?: string;
  eth_address?: string;
}

/**
 * Check vault balances on all 3 chains and recommend rebalancing actions.
 * Returns a JSON report: which chains are healthy, low, or critical.
 */
export async function handleRebalanceCheck(params: RebalanceCheckParams): Promise<string> {
  const min = params.min_usdc ?? 5;
  const chains: SupportedChain[] = ["arcTestnet", "baseSepolia", "avalancheFuji"];

  const results = await Promise.all(chains.map(async (chain) => {
    const vaultAddr = await resolveVaultAddress(chain, undefined, params.user_id, params.eth_address);
    const client = getPublicClient(chain);

    const raw = (await client.readContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "status",
    })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address, Address, number, bigint];

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
const DAC_CONTRACTS_PATH = join(OTTO_DIR, "dac-contracts.json");
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

// ── DAC contracts cache (vault → { shareToken, governor, ceo }) ──

interface DacContracts {
  vault: string;
  shareToken: string;
  governor: string;
  ceo: string;
}

type DacContractsRegistry = Record<string, DacContracts>; // keyed by vault address (lowercase)

function loadDacContracts(): DacContractsRegistry {
  if (!existsSync(DAC_CONTRACTS_PATH)) return {};
  try { return JSON.parse(readFileSync(DAC_CONTRACTS_PATH, "utf8")); } catch { return {}; }
}

function saveDacContracts(registry: DacContractsRegistry): void {
  ottoDirEnsure();
  writeFileSync(DAC_CONTRACTS_PATH, JSON.stringify(registry, null, 2));
}

function cacheDacContracts(dac: { vault: string; shareToken: string; governor: string; ceo: string }): void {
  const registry = loadDacContracts();
  registry[dac.vault.toLowerCase()] = {
    vault: dac.vault,
    shareToken: dac.shareToken,
    governor: dac.governor,
    ceo: dac.ceo,
  };
  saveDacContracts(registry);
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

// OTTORegistry — on-chain lookup for user vaults (Arc Testnet)
// Vaults are deployed by users from the frontend (ottoarc.xyz), NOT by the MCP.
const REGISTRY_ADDRESS: Address = "0xbACA262d37A956651E3b35271AF76Bb4eDfc1e67";

const REGISTRY_ABI = [
  {
    name: "getDac",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "salt", type: "bytes32" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "vault", type: "address" },
        { name: "shareToken", type: "address" },
        { name: "governor", type: "address" },
        { name: "ceo", type: "address" },
        { name: "createdAt", type: "uint256" },
      ],
    }],
  },
  {
    name: "getDacByVault",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "vault", type: "address" },
        { name: "shareToken", type: "address" },
        { name: "governor", type: "address" },
        { name: "ceo", type: "address" },
        { name: "createdAt", type: "uint256" },
      ],
    }],
  },
  {
    name: "dacCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────

// NOTE: deploy_user_vault removed — V2 vaults are deployed by users from the frontend
// (ottoarc.xyz) via MetaMask. The MCP only reads vault addresses from the on-chain Registry
// or the local user-vaults.json cache. See resolveVaultAddress() for the lookup flow.

// ─── DAC contracts lookup ─────────────────────────────────────────────────────

export interface GetDacContractsParams {
  vault_address?: string;
  user_id?: string;
  eth_address?: string;
  chain?: string;
}

/**
 * Resolve all DAC contracts (Vault, ShareToken, Governor, CEO) for a given vault.
 * Checks local cache first, then falls back to on-chain Registry.getDacByVault().
 */
export async function handleGetDacContracts(params: GetDacContractsParams): Promise<string> {
  const chain = resolveChain(params.chain);

  // Resolve vault address first
  const vaultAddr = await resolveVaultAddress(chain, params.vault_address, params.user_id, params.eth_address);

  // Check local cache
  const cached = loadDacContracts()[vaultAddr.toLowerCase()];
  if (cached) {
    return JSON.stringify({
      ...cached,
      chain,
      chainName: CHAIN_NAMES[chain],
      source: "cache",
    }, null, 2);
  }

  // On-chain lookup via Registry.getDacByVault
  try {
    const client = getPublicClient(chain);
    const dac = await client.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "getDacByVault",
      args: [vaultAddr],
    }) as { vault: Address; shareToken: Address; governor: Address; ceo: Address; createdAt: bigint };

    if (dac.vault && dac.vault !== "0x0000000000000000000000000000000000000000") {
      cacheDacContracts({
        vault: dac.vault,
        shareToken: dac.shareToken,
        governor: dac.governor,
        ceo: dac.ceo,
      });

      return JSON.stringify({
        vault: dac.vault,
        shareToken: dac.shareToken,
        governor: dac.governor,
        ceo: dac.ceo,
        chain,
        chainName: CHAIN_NAMES[chain],
        source: "on-chain",
      }, null, 2);
    }
  } catch { /* Registry not available on this chain */ }

  return JSON.stringify({
    vault: vaultAddr,
    shareToken: null,
    governor: null,
    ceo: null,
    chain,
    chainName: CHAIN_NAMES[chain],
    source: "not_found",
    note: "DAC not found in Registry. Vault may be a V1 vault or not registered.",
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

// ─── CEO ownership transfer ───────────────────────────────────────────────────

export interface TransferVaultAdminParams {
  user_id: string;
  chain?: string;
  vault_address?: string;
}

/**
 * Transfer CEO role of a user's vault from OTTO wallet to the user's registered ETH address.
 * Only works if OTTO is currently the CEO.
 */
export async function handleTransferVaultAdmin(params: TransferVaultAdminParams): Promise<string> {
  const { user_id } = params;
  const chain = resolveChain(params.chain);

  if (!user_id) throw new Error("user_id is required");

  const users = loadUsers();
  const userEthAddr = users[user_id]?.eth_address;
  if (!userEthAddr) {
    return JSON.stringify({
      success: false,
      reason: "No ETH address registered for this user. Call register_user_address first.",
    });
  }

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

  // Verify OTTO is currently CEO (index 8 in V2 status)
  const statusResult = (await publicClient.readContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "status",
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address, Address, number, bigint];
  const currentCeo = statusResult[8]; // ceo_ is index 8

  if (currentCeo.toLowerCase() !== account.address.toLowerCase()) {
    return JSON.stringify({
      success: false,
      reason: `OTTO is not the current CEO. Current CEO: ${currentCeo}`,
      current_ceo: currentCeo,
    });
  }

  const txHash = await client.writeContract({
    address: vaultAddr,
    abi: VAULT_CEO_ABI,
    functionName: "transferCeo",
    args: [userEthAddr as Address],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    vault: vaultAddr,
    chain,
    new_ceo: userEthAddr,
    previous_ceo: account.address,
    txHash,
    explorerUrl: `${EXPLORER_TX[chain]}/${txHash}`,
    message: `CEO transferred to your wallet ${userEthAddr}. OTTO can no longer change vault settings.`,
  }, null, 2);
}

// ─── Encode admin transaction (Tier 3 — requires user's wallet signature) ────

export interface EncodeAdminTxParams {
  function: "setLimits" | "setWhitelist" | "setWhitelistEnabled" | "setAgent" | "transferCeo" | "setPaused" | "withdraw";
  chain?: string;
  vault_address?: string;
  user_id?: string;
  eth_address?: string;
  // setLimits
  max_per_tx_usdc?: number;
  daily_limit_usdc?: number;
  // setWhitelist
  address?: string;
  allowed?: boolean;
  // setWhitelistEnabled / setPaused
  enabled?: boolean;
  paused?: boolean;
  // setAgent / transferCeo
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
  const vaultAddr = await resolveVaultAddress(chain, params.vault_address, params.user_id, params.eth_address);
  const fn = params.function;

  let data: `0x${string}`;
  let description: string;

  switch (fn) {
    case "setLimits": {
      const maxPerTx = params.max_per_tx_usdc;
      const daily = params.daily_limit_usdc;
      if (maxPerTx == null || daily == null) throw new Error("setLimits requires max_per_tx_usdc and daily_limit_usdc");
      data = encodeFunctionData({
        abi: VAULT_CEO_ABI,
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
        abi: VAULT_CEO_ABI,
        functionName: "setWhitelist",
        args: [addr as Address, allowed],
      });
      description = `${allowed ? "Add" : "Remove"} ${addr} ${allowed ? "to" : "from"} recipient whitelist`;
      break;
    }
    case "setWhitelistEnabled": {
      const enabled = params.enabled;
      if (enabled == null) throw new Error("setWhitelistEnabled requires enabled (true/false)");
      data = encodeFunctionData({ abi: VAULT_CEO_ABI, functionName: "setWhitelistEnabled", args: [enabled] });
      description = `${enabled ? "Enable" : "Disable"} recipient whitelist enforcement`;
      break;
    }
    case "setAgent": {
      const newAgent = params.new_address;
      if (!newAgent || !isAddress(newAgent)) throw new Error("setAgent requires a valid new_address");
      data = encodeFunctionData({ abi: VAULT_CEO_ABI, functionName: "setAgent", args: [newAgent as Address] });
      description = `Replace vault agent with ${newAgent}`;
      break;
    }
    case "transferCeo": {
      const newCeo = params.new_address;
      if (!newCeo || !isAddress(newCeo)) throw new Error("transferCeo requires a valid new_address");
      data = encodeFunctionData({ abi: VAULT_CEO_ABI, functionName: "transferCeo", args: [newCeo as Address] });
      description = `Transfer CEO role to ${newCeo}`;
      break;
    }
    case "setPaused": {
      const paused = params.paused;
      if (paused == null) throw new Error("setPaused requires paused (true/false)");
      data = encodeFunctionData({ abi: VAULT_CEO_ABI, functionName: "setPaused", args: [paused] });
      description = paused ? "Emergency pause — block all agent transfers" : "Unpause vault transfers";
      break;
    }
    case "withdraw": {
      const amount = params.amount_usdc;
      if (amount == null) throw new Error("withdraw requires amount_usdc");
      data = encodeFunctionData({
        abi: VAULT_CEO_ABI,
        functionName: "withdraw",
        args: [BigInt(Math.round(amount * 1_000_000))],
      });
      description = `CEO withdraw ${amount} USDC (bypasses agent limits)`;
      break;
    }
    default:
      throw new Error(`Unknown CEO function: ${fn}`);
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
      "CEO-only operation — requires your wallet signature.",
      `1. Open: ${signingUrl}`,
      "2. Connect your CEO wallet (MetaMask / Rabby / Frame)",
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
    throw new Error("Either vault_address or user_id is required to create an invoice.");
  }

  // Capture current vault balance as baseline
  const publicClient = getPublicClient(chain);
  const statusResult = (await publicClient.readContract({
    address: vaultAddr as Address,
    abi: VAULT_ABI,
    functionName: "status",
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address, Address, number, bigint];
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
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address, Address, number, bigint];
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

// ─── Whitelist check (read-only) ──────────────────────────────────────────────

export interface VaultCheckWhitelistParams {
  address: string;
  chain?: string;
  vault_address?: string;
  user_id?: string;
  eth_address?: string;
}

/**
 * Check whether an address is whitelisted on an OTTOVault.
 * Read-only — no transaction sent.
 */
export async function handleVaultCheckWhitelist(params: VaultCheckWhitelistParams): Promise<string> {
  const { address } = params;
  if (!address) throw new Error("address is required");
  if (!isAddress(address)) throw new Error(`Invalid address: ${address}`);

  const chain = resolveChain(params.chain);
  const vaultAddr = await resolveVaultAddress(chain, params.vault_address, params.user_id, params.eth_address);
  const client = getPublicClient(chain);

  const [whitelisted, whitelistEnabled] = await Promise.all([
    client.readContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "whitelist",
      args: [address as Address],
    }) as Promise<boolean>,
    client.readContract({
      address: vaultAddr,
      abi: VAULT_ABI,
      functionName: "whitelistEnabled",
    }) as Promise<boolean>,
  ]);

  let effective: string;
  if (!whitelistEnabled) {
    effective = "ALLOWED (whitelist disabled)";
  } else if (whitelisted) {
    effective = "ALLOWED";
  } else {
    effective = "BLOCKED";
  }

  return JSON.stringify({
    address: getAddress(address),
    whitelisted,
    whitelist_enabled: whitelistEnabled,
    effective,
    chain,
    vault: vaultAddr,
  }, null, 2);
}

// ─── Payroll (batch vault transfer) ───────────────────────────────────────────

export interface VaultPayrollRecipient {
  address: string;
  amount_usdc: number;
}

export interface VaultPayrollParams {
  recipients: VaultPayrollRecipient[];
  chain?: string;
  vault_address?: string;
  user_id?: string;
  eth_address?: string;
}

/**
 * Batch transfer USDC from an OTTOVault to multiple recipients (payroll).
 * Pre-flight checks verify vault state before any transfer. Partial failure tolerant.
 */
export async function handleVaultPayroll(params: VaultPayrollParams): Promise<string> {
  const { recipients } = params;
  if (!recipients || recipients.length === 0) throw new Error("recipients array is required and must not be empty");

  const chain = resolveChain(params.chain);
  const vaultAddr = await resolveVaultAddress(chain, params.vault_address, params.user_id, params.eth_address);
  const publicClient = getPublicClient(chain);

  // Validate all recipients
  for (const r of recipients) {
    if (!r.address || !isAddress(r.address)) throw new Error(`Invalid address: ${r.address}`);
    if (!r.amount_usdc || r.amount_usdc <= 0) throw new Error(`Invalid amount for ${r.address}: ${r.amount_usdc}`);
  }

  const totalUsdc = recipients.reduce((s, r) => s + r.amount_usdc, 0);

  // Pre-flight: read vault status once
  const statusResult = (await publicClient.readContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "status",
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address, Address, number, bigint];

  const [balance, maxPerTx, , , remainingToday, , paused] = statusResult;
  const balanceUsdc = Number(balance) / 1_000_000;
  const maxPerTxUsdc = Number(maxPerTx) / 1_000_000;
  const remainingTodayUsdc = Number(remainingToday) / 1_000_000;

  // Pre-flight checks
  if (paused) {
    return JSON.stringify({ success: false, reason: "Vault is paused", chain, vault: vaultAddr });
  }
  if (totalUsdc > balanceUsdc) {
    return JSON.stringify({
      success: false,
      reason: `Total payroll (${totalUsdc} USDC) exceeds vault balance (${balanceUsdc} USDC)`,
      total_usdc: totalUsdc,
      vault_balance_usdc: balanceUsdc,
      chain,
      vault: vaultAddr,
    });
  }
  if (totalUsdc > remainingTodayUsdc) {
    return JSON.stringify({
      success: false,
      reason: `Total payroll (${totalUsdc} USDC) exceeds remaining daily allowance (${remainingTodayUsdc} USDC)`,
      total_usdc: totalUsdc,
      remaining_daily_usdc: remainingTodayUsdc,
      chain,
      vault: vaultAddr,
    });
  }
  for (const r of recipients) {
    if (r.amount_usdc > maxPerTxUsdc) {
      return JSON.stringify({
        success: false,
        reason: `Recipient ${r.address}: ${r.amount_usdc} USDC exceeds per-tx cap (${maxPerTxUsdc} USDC)`,
        chain,
        vault: vaultAddr,
      });
    }
  }

  // Execute transfers sequentially
  const { client, account } = getAgentWalletClient(chain);
  const results: Array<{
    address: string;
    amount_usdc: number;
    success: boolean;
    txHash?: string;
    error?: string;
  }> = [];

  for (const r of recipients) {
    const amountAtomic = BigInt(Math.round(r.amount_usdc * 1_000_000));
    try {
      const txHash = await client.writeContract({
        address: vaultAddr,
        abi: VAULT_ABI,
        functionName: "transfer",
        args: [r.address as Address, amountAtomic],
        account,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
      results.push({
        address: r.address,
        amount_usdc: r.amount_usdc,
        success: receipt.status === "success",
        txHash,
      });
    } catch (err: unknown) {
      results.push({
        address: r.address,
        amount_usdc: r.amount_usdc,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  return JSON.stringify({
    success: failed.length === 0,
    chain,
    vault: vaultAddr,
    total_usdc: totalUsdc,
    recipients_count: recipients.length,
    succeeded_count: succeeded.length,
    failed_count: failed.length,
    results,
    summary: failed.length === 0
      ? `All ${recipients.length} payments completed successfully (${totalUsdc} USDC total)`
      : `${succeeded.length}/${recipients.length} payments succeeded, ${failed.length} failed`,
  }, null, 2);
}
