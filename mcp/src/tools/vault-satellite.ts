/**
 * OTTOSatelliteVault — MCP Tools for lightweight satellite vaults
 *
 * Satellite vaults hold USDC on non-home chains (Base Sepolia, Avalanche Fuji).
 * No governance, no revenue distribution, no yield, no dissolution.
 * Agent can transfer within limits; CEO can manage policy.
 *
 * Environment variables:
 *   X402_PAYER_PRIVATE_KEY — Agent private key (same wallet used for x402)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, avalancheFuji } from "viem/chains";
import { USDC_ADDRESSES, type SupportedChain } from "../lib/circle/gateway-sdk.js";

// ─── Chain configs ──────────────────────────────────────────────────────────

interface SatelliteChainConfig {
  chain: Chain;
  name: string;
  explorerTx: string;
  explorerAddr: string;
  usdcAddress: Address;
  satelliteDeployer: Address;
}

const SATELLITE_CHAINS: Record<string, SatelliteChainConfig> = {
  baseSepolia: {
    chain: baseSepolia,
    name: "Base Sepolia (84532)",
    explorerTx: "https://sepolia.basescan.org/tx",
    explorerAddr: "https://sepolia.basescan.org/address",
    usdcAddress: USDC_ADDRESSES.baseSepolia as Address,
    satelliteDeployer: "0xfF6359409df7B9325179B7624d0e47b59E9261a5",
  },
  avalancheFuji: {
    chain: avalancheFuji,
    name: "Avalanche Fuji (43113)",
    explorerTx: "https://testnet.snowscan.xyz/tx",
    explorerAddr: "https://testnet.snowscan.xyz/address",
    usdcAddress: USDC_ADDRESSES.avalancheFuji as Address,
    satelliteDeployer: "0xfF6359409df7B9325179B7624d0e47b59E9261a5",
  },
};

// ─── ABIs ───────────────────────────────────────────────────────────────────

const SATELLITE_VAULT_ABI = [
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
    name: "setPaused",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_paused", type: "bool" }],
    outputs: [],
  },
  {
    name: "whitelist",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

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
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveChain(chainKey: string): SatelliteChainConfig {
  const cfg = SATELLITE_CHAINS[chainKey];
  if (!cfg) throw new Error(`Unknown satellite chain: ${chainKey}. Use: baseSepolia | avalancheFuji`);
  return cfg;
}

function getPublicClient(chainKey: string) {
  const cfg = resolveChain(chainKey);
  return createPublicClient({ chain: cfg.chain, transport: http() });
}

function getAgentWalletClient(chainKey: string) {
  const pk = process.env.X402_PAYER_PRIVATE_KEY;
  if (!pk) throw new Error("X402_PAYER_PRIVATE_KEY is not set.");
  const cfg = resolveChain(chainKey);
  const account = privateKeyToAccount(pk as `0x${string}`);
  return {
    client: createWalletClient({ account, chain: cfg.chain, transport: http() }),
    account,
  };
}

function formatUsdc(atomic: bigint): string {
  return (Number(atomic) / 1_000_000).toFixed(6);
}

// ─── 1. Status ──────────────────────────────────────────────────────────────

export interface SatelliteStatusParams {
  vault_address: string;
  chain: string;
}

export async function handleSatelliteStatus(params: SatelliteStatusParams): Promise<string> {
  const { vault_address, chain } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!chain) throw new Error("chain is required");

  const cfg = resolveChain(chain);
  const client = getPublicClient(chain);

  const result = (await client.readContract({
    address: vault_address as Address,
    abi: SATELLITE_VAULT_ABI,
    functionName: "status",
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];

  const [balance, maxPerTx, dailyLimit, dailySpent, remainingToday,
    whitelistEnabled, paused, agentAddr, ceoAddr] = result;

  return [
    `## OTTOSatelliteVault Status`,
    `**Contract**: ${vault_address}`,
    `**Chain**: ${cfg.name}`,
    ``,
    `### Balance`,
    `**USDC Balance**: ${formatUsdc(balance)} USDC`,
    ``,
    `### Spending Limits`,
    `**Per-tx cap**: ${formatUsdc(maxPerTx)} USDC`,
    `**Daily limit**: ${formatUsdc(dailyLimit)} USDC`,
    `**Spent today**: ${formatUsdc(dailySpent)} USDC`,
    `**Remaining today**: ${formatUsdc(remainingToday)} USDC`,
    ``,
    `### Roles`,
    `**CEO**: ${ceoAddr}`,
    `**Agent**: ${agentAddr}`,
    `**Whitelist**: ${whitelistEnabled ? "Enabled" : "Disabled"}`,
    `**Paused**: ${paused ? "YES" : "No"}`,
  ].join("\n");
}

// ─── 2. Agent Transfer ──────────────────────────────────────────────────────

export interface SatelliteTransferParams {
  vault_address: string;
  chain: string;
  to: string;
  amount_usdc: number;
}

export async function handleSatelliteTransfer(params: SatelliteTransferParams): Promise<string> {
  const { vault_address, chain, to, amount_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!to?.startsWith("0x")) throw new Error("to address is required");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("amount_usdc must be positive");

  const cfg = resolveChain(chain);
  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const publicClient = getPublicClient(chain);

  // Pre-check
  const [ok, reason] = (await publicClient.readContract({
    address: vault_address as Address,
    abi: SATELLITE_VAULT_ABI,
    functionName: "canTransfer",
    args: [to as Address, amountAtomic],
  })) as [boolean, string];

  if (!ok) {
    return JSON.stringify({ success: false, reason, vault: vault_address, chain });
  }

  const { client, account } = getAgentWalletClient(chain);

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: SATELLITE_VAULT_ABI,
    functionName: "transfer",
    args: [to as Address, amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "agentTransfer",
    to,
    amount_usdc,
    txHash,
    vault: vault_address,
    chain,
    explorerUrl: `${cfg.explorerTx}/${txHash}`,
  }, null, 2);
}

// ─── 3. Deposit ─────────────────────────────────────────────────────────────

export interface SatelliteDepositParams {
  vault_address: string;
  chain: string;
  amount_usdc: number;
}

export async function handleSatelliteDeposit(params: SatelliteDepositParams): Promise<string> {
  const { vault_address, chain, amount_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("amount_usdc must be positive");

  const cfg = resolveChain(chain);
  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient(chain);
  const publicClient = getPublicClient(chain);

  // Approve USDC spend
  const approveTx = await client.writeContract({
    address: cfg.usdcAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [vault_address as Address, amountAtomic],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 30_000 });

  // Deposit
  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: SATELLITE_VAULT_ABI,
    functionName: "deposit",
    args: [amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "deposit",
    amount_usdc,
    txHash,
    vault: vault_address,
    chain,
    explorerUrl: `${cfg.explorerTx}/${txHash}`,
  }, null, 2);
}

// ─── 4. CEO Transfer ────────────────────────────────────────────────────────

export interface SatelliteCeoTransferParams {
  vault_address: string;
  chain: string;
  to: string;
  amount_usdc: number;
}

export async function handleSatelliteCeoTransfer(params: SatelliteCeoTransferParams): Promise<string> {
  const { vault_address, chain, to, amount_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!to?.startsWith("0x")) throw new Error("to address is required");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("amount_usdc must be positive");

  const cfg = resolveChain(chain);
  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient(chain);
  const publicClient = getPublicClient(chain);

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: SATELLITE_VAULT_ABI,
    functionName: "ceoTransfer",
    args: [to as Address, amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "ceoTransfer",
    to,
    amount_usdc,
    txHash,
    vault: vault_address,
    chain,
    explorerUrl: `${cfg.explorerTx}/${txHash}`,
  }, null, 2);
}

// ─── 5. CEO Withdraw ────────────────────────────────────────────────────────

export interface SatelliteWithdrawParams {
  vault_address: string;
  chain: string;
  amount_usdc: number;
}

export async function handleSatelliteWithdraw(params: SatelliteWithdrawParams): Promise<string> {
  const { vault_address, chain, amount_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("amount_usdc must be positive");

  const cfg = resolveChain(chain);
  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient(chain);
  const publicClient = getPublicClient(chain);

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: SATELLITE_VAULT_ABI,
    functionName: "withdraw",
    args: [amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "ceoWithdraw",
    amount_usdc,
    txHash,
    vault: vault_address,
    chain,
    explorerUrl: `${cfg.explorerTx}/${txHash}`,
  }, null, 2);
}

// ─── 6. Set Limits ──────────────────────────────────────────────────────────

export interface SatelliteSetLimitsParams {
  vault_address: string;
  chain: string;
  max_per_tx_usdc: number;
  daily_limit_usdc: number;
}

export async function handleSatelliteSetLimits(params: SatelliteSetLimitsParams): Promise<string> {
  const { vault_address, chain, max_per_tx_usdc, daily_limit_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!max_per_tx_usdc || max_per_tx_usdc <= 0) throw new Error("max_per_tx_usdc must be positive");
  if (!daily_limit_usdc || daily_limit_usdc <= 0) throw new Error("daily_limit_usdc must be positive");

  const cfg = resolveChain(chain);
  const maxAtomic = BigInt(Math.round(max_per_tx_usdc * 1_000_000));
  const dailyAtomic = BigInt(Math.round(daily_limit_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient(chain);
  const publicClient = getPublicClient(chain);

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: SATELLITE_VAULT_ABI,
    functionName: "setLimits",
    args: [maxAtomic, dailyAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "setLimits",
    max_per_tx_usdc,
    daily_limit_usdc,
    txHash,
    vault: vault_address,
    chain,
    explorerUrl: `${cfg.explorerTx}/${txHash}`,
  }, null, 2);
}

// ─── 7. Whitelist Management ────────────────────────────────────────────────

export interface SatelliteWhitelistParams {
  vault_address: string;
  chain: string;
  address: string;
  allowed: boolean;
}

export async function handleSatelliteWhitelist(params: SatelliteWhitelistParams): Promise<string> {
  const { vault_address, chain, address: addr, allowed } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!addr?.startsWith("0x")) throw new Error("address is required");

  const cfg = resolveChain(chain);
  const { client, account } = getAgentWalletClient(chain);
  const publicClient = getPublicClient(chain);

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: SATELLITE_VAULT_ABI,
    functionName: "setWhitelist",
    args: [addr as Address, allowed],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: allowed ? "whitelistAdd" : "whitelistRemove",
    address: addr,
    txHash,
    vault: vault_address,
    chain,
    explorerUrl: `${cfg.explorerTx}/${txHash}`,
  }, null, 2);
}

// ─── 8. Whitelist Toggle ────────────────────────────────────────────────────

export interface SatelliteWhitelistToggleParams {
  vault_address: string;
  chain: string;
  enabled: boolean;
}

export async function handleSatelliteWhitelistToggle(params: SatelliteWhitelistToggleParams): Promise<string> {
  const { vault_address, chain, enabled } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");

  const cfg = resolveChain(chain);
  const { client, account } = getAgentWalletClient(chain);
  const publicClient = getPublicClient(chain);

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: SATELLITE_VAULT_ABI,
    functionName: "setWhitelistEnabled",
    args: [enabled],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "whitelistToggle",
    enabled,
    txHash,
    vault: vault_address,
    chain,
    explorerUrl: `${cfg.explorerTx}/${txHash}`,
  }, null, 2);
}

// ─── 9. Pause / Unpause ─────────────────────────────────────────────────────

export interface SatellitePauseParams {
  vault_address: string;
  chain: string;
  paused: boolean;
}

export async function handleSatellitePause(params: SatellitePauseParams): Promise<string> {
  const { vault_address, chain, paused: pauseVal } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");

  const cfg = resolveChain(chain);
  const { client, account } = getAgentWalletClient(chain);
  const publicClient = getPublicClient(chain);

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: SATELLITE_VAULT_ABI,
    functionName: "setPaused",
    args: [pauseVal],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: pauseVal ? "pause" : "unpause",
    txHash,
    vault: vault_address,
    chain,
    explorerUrl: `${cfg.explorerTx}/${txHash}`,
  }, null, 2);
}
