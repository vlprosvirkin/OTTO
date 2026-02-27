/**
 * MCP Tools: Deposit USDC to Gateway
 */

import { z } from "zod";
import type { Address } from "viem";
import {
  initiateDepositFromCustodialWallet,
  withdrawFromCustodialWallet,
  type SupportedChain,
} from "../lib/circle/gateway-sdk.js";
import { supabase } from "../lib/supabase/client.js";
import { getOrCreateGatewayEOAWallet } from "../lib/circle/create-gateway-eoa-wallets.js";

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const depositTools = [
  {
    name: "deposit_usdc",
    description:
      "Deposit USDC from a Circle custodial wallet into the Gateway contract. The deposited amount becomes available as unified balance across all chains. Optionally sets up an EOA delegate for cross-chain signing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        wallet_id: {
          type: "string",
          description:
            "The Circle SCA (custodial) wallet ID that holds USDC to deposit",
        },
        chain: {
          type: "string",
          enum: ["arcTestnet", "baseSepolia", "avalancheFuji"],
          description: "The chain on which to deposit USDC",
        },
        amount_usdc: {
          type: "number",
          description:
            "Amount of USDC to deposit (human-readable, e.g. 10.5 for 10.5 USDC). Must be between 0.000001 and 1000000000.",
        },
        user_id: {
          type: "string",
          description:
            "(Optional) User ID to auto-setup EOA delegate for cross-chain transfers",
        },
      },
      required: ["wallet_id", "chain", "amount_usdc"],
    },
  },
  {
    name: "withdraw_usdc",
    description:
      "Withdraw USDC from the Gateway contract back to the user's custodial wallet on a specific chain. Note: withdrawals have a delay period before funds are claimable.",
    inputSchema: {
      type: "object" as const,
      properties: {
        wallet_id: {
          type: "string",
          description: "The Circle SCA (custodial) wallet ID",
        },
        chain: {
          type: "string",
          enum: ["arcTestnet", "baseSepolia", "avalancheFuji"],
          description: "The chain to withdraw USDC on",
        },
        amount_usdc: {
          type: "number",
          description:
            "Amount of USDC to withdraw (human-readable, e.g. 5.0 for 5 USDC)",
        },
      },
      required: ["wallet_id", "chain", "amount_usdc"],
    },
  },
] as const;

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

export async function handleDepositUsdc(params: {
  wallet_id: string;
  chain: string;
  amount_usdc: number;
  user_id?: string;
}): Promise<string> {
  const { wallet_id, chain, amount_usdc, user_id } = z
    .object({
      wallet_id: z.string().min(1),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]),
      amount_usdc: z.number().positive().max(1_000_000_000),
      user_id: z.string().optional(),
    })
    .parse(params);

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));

  // If userId provided, get/create EOA wallet to set as delegate
  let delegateAddress: Address | undefined;
  if (user_id) {
    try {
      const eoaWallet = await getOrCreateGatewayEOAWallet(
        user_id,
        "ARC-TESTNET"
      );
      delegateAddress = eoaWallet.address as Address;
    } catch (err) {
      // Non-fatal — continue without delegate
      console.error("Could not setup EOA delegate:", err);
    }
  }

  const txHash = await initiateDepositFromCustodialWallet(
    wallet_id,
    chain as SupportedChain,
    amountAtomic,
    delegateAddress
  );

  // Record in database if userId available
  if (user_id) {
    await supabase.from("transaction_history").insert({
      user_id,
      chain,
      tx_type: "deposit",
      amount: amount_usdc,
      tx_hash: txHash,
      gateway_wallet_address:
        "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
      status: "success",
    });
  }

  return [
    `## USDC Deposit Successful`,
    `**Chain**: ${chain}`,
    `**Amount**: ${amount_usdc} USDC`,
    `**Transaction Hash**: ${txHash}`,
    delegateAddress ? `**EOA Delegate Set**: ${delegateAddress}` : "",
    ``,
    `Your USDC is now available as unified Gateway balance across all chains.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function handleWithdrawUsdc(params: {
  wallet_id: string;
  chain: string;
  amount_usdc: number;
}): Promise<string> {
  const { wallet_id, chain, amount_usdc } = z
    .object({
      wallet_id: z.string().min(1),
      chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]),
      amount_usdc: z.number().positive().max(1_000_000_000),
    })
    .parse(params);

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));

  const txHash = await withdrawFromCustodialWallet(
    wallet_id,
    chain as SupportedChain,
    amountAtomic
  );

  return [
    `## USDC Withdrawal Initiated`,
    `**Chain**: ${chain}`,
    `**Amount**: ${amount_usdc} USDC`,
    `**Transaction Hash**: ${txHash}`,
    ``,
    `Withdrawal has been initiated. There is a delay period before funds become claimable.`,
  ].join("\n");
}
