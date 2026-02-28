/**
 * OTTOVault MCP Tools
 *
 * Interact with the on-chain OTTOVault treasury contract.
 * The vault enforces per-tx and daily spending limits at the EVM level —
 * limits that no prompt injection or AI compromise can override.
 *
 * Requires environment variables:
 *   X402_PAYER_PRIVATE_KEY  — Agent private key (same wallet used for x402)
 *   VAULT_ADDRESS           — OTTOVault contract address
 *                             (default: Arc Testnet deployment)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "../lib/circle/gateway-sdk.js";

// ─── Contract ─────────────────────────────────────────────────────────────────

const DEFAULT_VAULT_ADDRESS =
  "0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA" as const;

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
  {
    name: "vaultBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "remainingDailyAllowance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVaultAddress(): Address {
  return (
    process.env.VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS
  ) as Address;
}

function getPublicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http() });
}

function getAgentWalletClient() {
  const pk = process.env.X402_PAYER_PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      "X402_PAYER_PRIVATE_KEY is not set. " +
        "Set it to the agent's EVM private key (0x-prefixed)."
    );
  }
  const account = privateKeyToAccount(pk as `0x${string}`);
  return {
    client: createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(),
    }),
    account,
  };
}

function formatUsdc(atomic: bigint): string {
  return (Number(atomic) / 1_000_000).toFixed(6);
}

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

export interface VaultStatusParams {
  vault_address?: string;
}

/**
 * Read the full status of the OTTOVault in one call.
 * Returns balance, limits, daily spend, whitelist state, pause state.
 */
export async function handleVaultStatus(
  params: VaultStatusParams
): Promise<string> {
  const vaultAddr = (params.vault_address ?? getVaultAddress()) as Address;
  const client = getPublicClient();

  const result = (await client.readContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "status",
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];

  const [
    balance,
    maxPerTx,
    dailyLimit,
    dailySpent,
    remainingToday,
    whitelistEnabled,
    paused,
    agent,
    admin,
  ] = result;

  const lines = [
    `## OTTOVault Status`,
    `**Contract**: ${vaultAddr}`,
    `**Chain**: Arc Testnet (chainId 5042002)`,
    ``,
    `### Balances`,
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
    `**Paused**: ${paused ? "YES — transfers are blocked" : "No"}`,
  ];

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────

export interface VaultTransferParams {
  to: string;
  amount_usdc: number;
  vault_address?: string;
}

/**
 * Transfer USDC from the OTTOVault to a recipient.
 * The agent's private key (X402_PAYER_PRIVATE_KEY) must match the vault's agent address.
 * The vault enforces per-tx and daily limits on-chain — no overrides possible.
 */
export async function handleVaultTransfer(
  params: VaultTransferParams
): Promise<string> {
  const { to, amount_usdc } = params;
  const vaultAddr = (params.vault_address ?? getVaultAddress()) as Address;

  if (!to || !to.startsWith("0x")) {
    throw new Error("Invalid recipient address — must be 0x-prefixed");
  }
  if (!amount_usdc || amount_usdc <= 0) {
    throw new Error("Invalid amount — must be positive USDC");
  }

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const toAddr = to as Address;

  // Pre-flight check
  const publicClient = getPublicClient();
  const [ok, reason] = (await publicClient.readContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "canTransfer",
    args: [toAddr, amountAtomic],
  })) as [boolean, string];

  if (!ok) {
    return JSON.stringify({
      success: false,
      reason,
      to,
      amount_usdc,
      vault: vaultAddr,
    });
  }

  // Execute transfer
  const { client, account } = getAgentWalletClient();

  const txHash = await client.writeContract({
    address: vaultAddr,
    abi: VAULT_ABI,
    functionName: "transfer",
    args: [toAddr, amountAtomic],
    account,
  });

  // Wait for receipt
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 30_000,
  });

  return JSON.stringify(
    {
      success: receipt.status === "success",
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      to,
      amount_usdc,
      vault: vaultAddr,
      explorerUrl: `https://explorer.testnet.arc.network/tx/${txHash}`,
    },
    null,
    2
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export interface VaultCanTransferParams {
  to: string;
  amount_usdc: number;
  vault_address?: string;
}

/**
 * Preview whether a vault transfer would succeed without sending a transaction.
 */
export async function handleVaultCanTransfer(
  params: VaultCanTransferParams
): Promise<string> {
  const { to, amount_usdc } = params;
  const vaultAddr = (params.vault_address ?? getVaultAddress()) as Address;

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));

  const client = getPublicClient();
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
    vault: vaultAddr,
  });
}
