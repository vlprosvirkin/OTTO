/**
 * MCP Tools: Cross-chain USDC transfers via Gateway
 */

import { z } from "zod";
import type { Address } from "viem";
import {
  transferGatewayBalanceWithEOA,
  transferUnifiedBalanceCircle,
  executeMintCircle,
  type SupportedChain,
} from "../lib/circle/gateway-sdk.js";
import { getCircleWalletAddress } from "../lib/circle/gateway-sdk.js";
import { supabase } from "../lib/supabase/client.js";

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const transferTools = [
  {
    name: "transfer_usdc_eoa",
    description:
      "Transfer USDC cross-chain via Circle Gateway using an EOA wallet for signing. The EOA signs the burn intent, and the USDC is minted on the destination chain. Requires the user to have deposited USDC into Gateway first.",
    inputSchema: {
      type: "object" as const,
      properties: {
        user_id: {
          type: "string",
          description:
            "User ID (used to look up EOA signer wallet from database)",
        },
        depositor_wallet_id: {
          type: "string",
          description:
            "The Circle wallet ID of the wallet that deposited USDC into Gateway (has the balance)",
        },
        source_chain: {
          type: "string",
          enum: ["arcTestnet", "baseSepolia", "avalancheFuji"],
          description: "Source chain where the Gateway balance is held",
        },
        destination_chain: {
          type: "string",
          enum: ["arcTestnet", "baseSepolia", "avalancheFuji"],
          description: "Destination chain to receive USDC",
        },
        amount_usdc: {
          type: "number",
          description:
            "Amount of USDC to transfer (human-readable). Must be > 2.01 USDC to cover Gateway fees.",
        },
        recipient_address: {
          type: "string",
          description:
            "(Optional) Recipient address on the destination chain. Defaults to the depositor wallet address.",
        },
      },
      required: [
        "user_id",
        "depositor_wallet_id",
        "source_chain",
        "destination_chain",
        "amount_usdc",
      ],
    },
  },
  {
    name: "transfer_usdc_custodial",
    description:
      "Transfer USDC cross-chain via Circle Gateway using a Circle custodial SCA wallet for signing. The SCA wallet signs the burn intent directly. Simpler than EOA but requires the SCA wallet to be the depositor.",
    inputSchema: {
      type: "object" as const,
      properties: {
        wallet_id: {
          type: "string",
          description:
            "The Circle SCA wallet ID that deposited USDC and will sign the transfer",
        },
        source_chain: {
          type: "string",
          enum: ["arcTestnet", "baseSepolia", "avalancheFuji"],
          description: "Source chain where the Gateway balance is held",
        },
        destination_chain: {
          type: "string",
          enum: ["arcTestnet", "baseSepolia", "avalancheFuji"],
          description: "Destination chain to receive USDC",
        },
        amount_usdc: {
          type: "number",
          description:
            "Amount of USDC to transfer (human-readable). Must be > 1.01 USDC to cover Gateway fees.",
        },
        recipient_address: {
          type: "string",
          description:
            "(Optional) Recipient address on the destination chain. Defaults to the same wallet address.",
        },
        user_id: {
          type: "string",
          description:
            "(Optional) User ID for recording transaction in database",
        },
      },
      required: ["wallet_id", "source_chain", "destination_chain", "amount_usdc"],
    },
  },
  {
    name: "execute_gateway_mint",
    description:
      "Execute a gatewayMint transaction on the destination chain using an existing attestation and signature. Use this to finalize a cross-chain transfer after you have the attestation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        wallet_id: {
          type: "string",
          description: "Circle wallet ID to execute the mint transaction",
        },
        destination_chain: {
          type: "string",
          enum: ["arcTestnet", "baseSepolia", "avalancheFuji"],
          description: "Destination chain where mint will be executed",
        },
        attestation: {
          type: "string",
          description: "The attestation payload (hex string from Gateway API)",
        },
        signature: {
          type: "string",
          description: "The attestation signature (hex string from Gateway API)",
        },
      },
      required: ["wallet_id", "destination_chain", "attestation", "signature"],
    },
  },
] as const;

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

export async function handleTransferUsdcEoa(params: {
  user_id: string;
  depositor_wallet_id: string;
  source_chain: string;
  destination_chain: string;
  amount_usdc: number;
  recipient_address?: string;
}): Promise<string> {
  const {
    user_id,
    depositor_wallet_id,
    source_chain,
    destination_chain,
    amount_usdc,
    recipient_address,
  } = z
    .object({
      user_id: z.string().min(1),
      depositor_wallet_id: z.string().min(1),
      source_chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]),
      destination_chain: z.enum([
        "arcTestnet",
        "baseSepolia",
        "avalancheFuji",
      ]),
      amount_usdc: z.number().positive(),
      recipient_address: z.string().optional(),
    })
    .parse(params);

  if (source_chain === destination_chain) {
    throw new Error("Source and destination chains must be different");
  }

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));

  // Get depositor wallet address
  const depositorAddress = await getCircleWalletAddress(depositor_wallet_id);
  const recipientAddr = (recipient_address ?? depositorAddress) as Address;

  const { transferId, attestation, attestationSignature } =
    await transferGatewayBalanceWithEOA(
      user_id,
      amountAtomic,
      source_chain as SupportedChain,
      destination_chain as SupportedChain,
      recipientAddr,
      depositorAddress
    );

  // Execute mint on destination
  const mintTx = await executeMintCircle(
    user_id,
    destination_chain as SupportedChain,
    attestation,
    attestationSignature,
    true // isUserId = true
  );

  // Record in database
  await supabase.from("transaction_history").insert({
    user_id,
    chain: source_chain,
    tx_type: "transfer",
    amount: amount_usdc,
    tx_hash: mintTx.txHash,
    gateway_wallet_address: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    destination_chain,
    status: "success",
  });

  return [
    `## Cross-Chain USDC Transfer Successful`,
    `**Source Chain**: ${source_chain}`,
    `**Destination Chain**: ${destination_chain}`,
    `**Amount**: ${amount_usdc} USDC`,
    `**Recipient**: ${recipientAddr}`,
    `**Transfer ID**: ${transferId}`,
    `**Mint TX Hash**: ${mintTx.txHash}`,
  ].join("\n");
}

export async function handleTransferUsdcCustodial(params: {
  wallet_id: string;
  source_chain: string;
  destination_chain: string;
  amount_usdc: number;
  recipient_address?: string;
  user_id?: string;
}): Promise<string> {
  const {
    wallet_id,
    source_chain,
    destination_chain,
    amount_usdc,
    recipient_address,
    user_id,
  } = z
    .object({
      wallet_id: z.string().min(1),
      source_chain: z.enum(["arcTestnet", "baseSepolia", "avalancheFuji"]),
      destination_chain: z.enum([
        "arcTestnet",
        "baseSepolia",
        "avalancheFuji",
      ]),
      amount_usdc: z.number().positive(),
      recipient_address: z.string().optional(),
      user_id: z.string().optional(),
    })
    .parse(params);

  if (source_chain === destination_chain) {
    throw new Error("Source and destination chains must be different");
  }

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const recipientAddr = recipient_address
    ? (recipient_address as Address)
    : undefined;

  const { attestation, mintTxHash } = await transferUnifiedBalanceCircle(
    wallet_id,
    amountAtomic,
    source_chain as SupportedChain,
    destination_chain as SupportedChain,
    recipientAddr
  );

  // Record in database if userId provided
  if (user_id) {
    await supabase.from("transaction_history").insert({
      user_id,
      chain: source_chain,
      tx_type: "transfer",
      amount: amount_usdc,
      tx_hash: mintTxHash,
      gateway_wallet_address: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
      destination_chain,
      status: "success",
    });
  }

  return [
    `## Cross-Chain USDC Transfer Successful`,
    `**Source Chain**: ${source_chain}`,
    `**Destination Chain**: ${destination_chain}`,
    `**Amount**: ${amount_usdc} USDC`,
    `**Mint TX Hash**: ${mintTxHash}`,
    `**Attestation**: ${attestation.slice(0, 20)}...`,
  ].join("\n");
}

export async function handleExecuteGatewayMint(params: {
  wallet_id: string;
  destination_chain: string;
  attestation: string;
  signature: string;
}): Promise<string> {
  const { wallet_id, destination_chain, attestation, signature } = z
    .object({
      wallet_id: z.string().min(1),
      destination_chain: z.enum([
        "arcTestnet",
        "baseSepolia",
        "avalancheFuji",
      ]),
      attestation: z.string().min(1),
      signature: z.string().min(1),
    })
    .parse(params);

  const mintTx = await executeMintCircle(
    wallet_id,
    destination_chain as SupportedChain,
    attestation,
    signature,
    false
  );

  return [
    `## Gateway Mint Executed`,
    `**Destination Chain**: ${destination_chain}`,
    `**TX Hash**: ${mintTx.txHash}`,
    `**State**: ${mintTx.state}`,
  ].join("\n");
}
