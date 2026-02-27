/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapted from arc-multichain-wallet for standalone MCP server usage.
 */

import { supabase } from "../supabase/client.js";
import { circleDeveloperSdk } from "./sdk.js";

export interface GatewayEOAWallet {
  chain: string;
  address: string;
  walletId: string;
  name: string;
}

/**
 * Create a single multichain EOA wallet using Circle Wallets SDK.
 * Circle derives the same address across all EVM chains.
 */
export async function generateGatewayEOAWallet(
  walletSetId: string
): Promise<GatewayEOAWallet> {
  const response = await circleDeveloperSdk.createWallets({
    walletSetId,
    accountType: "EOA",
    blockchains: ["ARC-TESTNET"],
    count: 1,
  });

  if (!response.data?.wallets || response.data.wallets.length === 0) {
    throw new Error("Failed to create Gateway EOA wallet via Circle SDK");
  }

  const wallet = response.data.wallets[0];
  return {
    chain: wallet.blockchain,
    address: wallet.address,
    walletId: wallet.id,
    name: wallet.name || "Gateway Signer (Multichain)",
  };
}

/**
 * Create and store a Gateway EOA wallet for a user in Supabase.
 */
export async function storeGatewayEOAWalletForUser(
  userId: string,
  walletSetId: string
) {
  const wallet = await generateGatewayEOAWallet(walletSetId);

  const { data, error } = await supabase
    .from("wallets")
    .insert([
      {
        user_id: userId,
        name: wallet.name,
        address: wallet.address,
        wallet_address: wallet.address,
        blockchain: "MULTICHAIN",
        type: "gateway_signer",
        circle_wallet_id: wallet.walletId,
        wallet_set_id: walletSetId,
      },
    ])
    .select();

  if (error) {
    throw new Error(`Error storing Gateway EOA wallet: ${error.message}`);
  }

  return data;
}

/**
 * Get the Gateway EOA wallet ID for a user (works across all blockchains).
 */
export async function getGatewayEOAWalletId(
  userId: string,
  _blockchain: string
): Promise<{ walletId: string; address: string }> {
  const { data, error } = await supabase
    .from("wallets")
    .select("circle_wallet_id, address")
    .eq("user_id", userId)
    .eq("type", "gateway_signer")
    .single();

  if (error || !data) {
    throw new Error(`Gateway EOA wallet not found for user ${userId}`);
  }

  return {
    walletId: data.circle_wallet_id,
    address: data.address,
  };
}

/**
 * Get or create a Gateway EOA wallet for a user.
 * If not found, creates using the user's existing SCA wallet set.
 */
export async function getOrCreateGatewayEOAWallet(
  userId: string,
  blockchain: string
): Promise<{ walletId: string; address: string }> {
  try {
    return await getGatewayEOAWalletId(userId, blockchain);
  } catch {
    const { data: scaWallet, error: scaError } = await supabase
      .from("wallets")
      .select("wallet_set_id")
      .eq("user_id", userId)
      .eq("type", "sca")
      .limit(1)
      .single();

    if (scaError || !scaWallet) {
      throw new Error(
        `No SCA wallet found for user ${userId}. Cannot create EOA wallet.`
      );
    }

    await storeGatewayEOAWalletForUser(userId, scaWallet.wallet_set_id);
    return await getGatewayEOAWalletId(userId, blockchain);
  }
}

/**
 * List all EOA wallets for a user from Supabase.
 */
export async function listGatewayEOAWallets(userId: string) {
  const { data, error } = await supabase
    .from("wallets")
    .select("circle_wallet_id, address, blockchain, name")
    .eq("user_id", userId)
    .eq("type", "gateway_signer");

  if (error) {
    throw new Error(`Error listing EOA wallets: ${error.message}`);
  }

  return data ?? [];
}
