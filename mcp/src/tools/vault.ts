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

// Same contract address on all three chains — deterministic CREATE (same deployer + nonce)
const DEPLOYED_VAULT = "0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA";

const DEFAULT_VAULT_ADDRESSES: Record<SupportedChain, string> = {
  arcTestnet:    process.env.VAULT_ADDRESS_ARC  ?? DEPLOYED_VAULT,
  baseSepolia:   process.env.VAULT_ADDRESS_BASE ?? DEPLOYED_VAULT,
  avalancheFuji: process.env.VAULT_ADDRESS_FUJI ?? DEPLOYED_VAULT,
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
