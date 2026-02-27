/**
 * MCP Tools: Balance queries
 */

import { z } from "zod";
import type { Address } from "viem";
import {
  fetchGatewayBalance,
  getUsdcBalance,
  checkWalletGasBalance,
  CHAIN_BY_DOMAIN,
  type SupportedChain,
} from "../lib/circle/gateway-sdk.js";

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const balanceTools = [
  {
    name: "get_gateway_balance",
    description:
      "Get the unified USDC balance for an address across all Gateway domains (Arc Testnet, Base Sepolia, Avalanche Fuji). Returns per-domain breakdown and total unified balance in USDC (human-readable).",
    inputSchema: {
      type: "object" as const,
      properties: {
        address: {
          type: "string",
          description:
            "The EVM wallet address to check balance for (0x-prefixed)",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "get_usdc_balance",
    description:
      "Get the on-chain USDC token balance for an address on a specific chain.",
    inputSchema: {
      type: "object" as const,
      properties: {
        address: {
          type: "string",
          description: "The EVM wallet address (0x-prefixed)",
        },
        chain: {
          type: "string",
          enum: ["arcTestnet", "baseSepolia", "avalancheFuji"],
          description: "The chain to check balance on",
        },
      },
      required: ["address", "chain"],
    },
  },
  {
    name: "check_wallet_gas",
    description:
      "Check if a Circle wallet has sufficient native token balance (gas) on a specific chain. Returns balance and whether it's sufficient for transactions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        wallet_id: {
          type: "string",
          description: "The Circle wallet ID to check",
        },
        chain: {
          type: "string",
          enum: ["arcTestnet", "baseSepolia", "avalancheFuji"],
          description: "The chain to check gas balance on",
        },
      },
      required: ["wallet_id", "chain"],
    },
  },
] as const;

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

const CHAIN_NAMES: Record<string, string> = {
  "26": "Arc Testnet",
  "1": "Avalanche Fuji",
  "6": "Base Sepolia",
};

const NATIVE_TOKENS: Record<SupportedChain, string> = {
  arcTestnet: "USDC (native)",
  avalancheFuji: "AVAX",
  baseSepolia: "ETH",
};

export async function handleGetGatewayBalance(params: {
  address: string;
}): Promise<string> {
  const { address } = z
    .object({ address: z.string().startsWith("0x") })
    .parse(params);

  const result = await fetchGatewayBalance(address as Address);

  const balances = result.balances ?? [];
  let total = BigInt(0);

  const lines: string[] = ["## Gateway Unified USDC Balance", ""];

  for (const b of balances) {
    const balanceBigInt = BigInt(b.balance ?? "0");
    total += balanceBigInt;
    const chainName =
      CHAIN_NAMES[String(b.domain)] ?? `Domain ${b.domain}`;
    const humanBalance = (Number(balanceBigInt) / 1_000_000).toFixed(6);
    lines.push(`**${chainName}** (domain ${b.domain}): ${humanBalance} USDC`);
  }

  lines.push("");
  lines.push(`**Total Unified Balance**: ${(Number(total) / 1_000_000).toFixed(6)} USDC`);
  lines.push(`**Token**: ${result.token}`);

  return lines.join("\n");
}

export async function handleGetUsdcBalance(params: {
  address: string;
  chain: string;
}): Promise<string> {
  const { address, chain } = z
    .object({
      address: z.string().startsWith("0x"),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]),
    })
    .parse(params);

  const balance = await getUsdcBalance(
    address as Address,
    chain as SupportedChain
  );

  const humanBalance = (Number(balance) / 1_000_000).toFixed(6);

  return [
    `## On-Chain USDC Balance`,
    `**Address**: ${address}`,
    `**Chain**: ${chain}`,
    `**Balance**: ${humanBalance} USDC (${balance.toString()} atomic units)`,
  ].join("\n");
}

export async function handleCheckWalletGas(params: {
  wallet_id: string;
  chain: string;
}): Promise<string> {
  const { wallet_id, chain } = z
    .object({
      wallet_id: z.string().min(1),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]),
    })
    .parse(params);

  const result = await checkWalletGasBalance(
    wallet_id,
    chain as SupportedChain
  );

  const nativeToken = NATIVE_TOKENS[chain as SupportedChain];
  const humanBalance =
    chain === "arcTestnet"
      ? `${(Number(result.balance) / 1_000_000).toFixed(6)} ${nativeToken}`
      : `${(Number(result.balance) / 1e18).toFixed(8)} ${nativeToken}`;

  return [
    `## Wallet Gas Balance`,
    `**Wallet ID**: ${wallet_id}`,
    `**Address**: ${result.address}`,
    `**Chain**: ${chain}`,
    `**Balance**: ${humanBalance}`,
    `**Has Gas**: ${result.hasGas ? "Yes ✓" : "No — needs funding"}`,
  ].join("\n");
}
