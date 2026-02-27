/**
 * MCP Tools: Wallet management
 */

import { z } from "zod";
import { circleDeveloperSdk } from "../lib/circle/sdk.js";
import { supabase } from "../lib/supabase/client.js";
import {
  getOrCreateGatewayEOAWallet,
  listGatewayEOAWallets,
  storeGatewayEOAWalletForUser,
} from "../lib/circle/create-gateway-eoa-wallets.js";

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const walletTools = [
  {
    name: "create_wallet_set",
    description:
      "Create a Circle wallet set for a user. A wallet set is a container for multiple wallets across different chains. Returns the wallet set ID needed for creating wallets.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Human-readable name for the wallet set",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_multichain_wallet",
    description:
      "Create a multichain SCA (Smart Contract Account) wallet for a user. The wallet is accessible on all supported chains (Arc Testnet, Base Sepolia, Avalanche Fuji) with the same address.",
    inputSchema: {
      type: "object" as const,
      properties: {
        wallet_set_id: {
          type: "string",
          description:
            "The Circle wallet set ID to create the wallet in. Use create_wallet_set first.",
        },
        user_id: {
          type: "string",
          description:
            "(Optional) User ID to store wallet in database for future reference",
        },
      },
      required: ["wallet_set_id"],
    },
  },
  {
    name: "get_wallet_info",
    description:
      "Get information about a Circle wallet by its ID (address, blockchain, type, state).",
    inputSchema: {
      type: "object" as const,
      properties: {
        wallet_id: {
          type: "string",
          description: "The Circle wallet ID",
        },
      },
      required: ["wallet_id"],
    },
  },
  {
    name: "get_eoa_wallets",
    description:
      "List all Gateway EOA signer wallets for a user. These wallets are used to sign burn intents for cross-chain transfers.",
    inputSchema: {
      type: "object" as const,
      properties: {
        user_id: {
          type: "string",
          description: "User ID to list EOA wallets for",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "init_eoa_wallet",
    description:
      "Initialize (get or create) a Gateway EOA signer wallet for a user. Returns existing wallet if one exists, or creates a new one. Requires the user to already have an SCA wallet set.",
    inputSchema: {
      type: "object" as const,
      properties: {
        user_id: {
          type: "string",
          description: "User ID to initialize EOA wallet for",
        },
        blockchain: {
          type: "string",
          description:
            'Blockchain hint (e.g. "ARC-TESTNET"). The EOA works on all chains.',
          default: "ARC-TESTNET",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "get_transaction_history",
    description:
      "Get the transaction history for a user (deposits, transfers). Returns sorted by most recent first.",
    inputSchema: {
      type: "object" as const,
      properties: {
        user_id: {
          type: "string",
          description: "User ID to fetch transaction history for",
        },
        limit: {
          type: "number",
          description: "Maximum number of transactions to return (default: 20)",
          default: 20,
        },
        tx_type: {
          type: "string",
          enum: ["deposit", "transfer", "unify"],
          description: "(Optional) Filter by transaction type",
        },
      },
      required: ["user_id"],
    },
  },
  {
    name: "get_user_wallets",
    description:
      "Get all wallets stored in database for a user (both SCA and EOA wallets).",
    inputSchema: {
      type: "object" as const,
      properties: {
        user_id: {
          type: "string",
          description: "User ID to fetch wallets for",
        },
      },
      required: ["user_id"],
    },
  },
] as const;

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

export async function handleCreateWalletSet(params: {
  name: string;
}): Promise<string> {
  const { name } = z.object({ name: z.string().min(1) }).parse(params);

  const response = await circleDeveloperSdk.createWalletSet({ name });

  const walletSet = response.data?.walletSet;
  if (!walletSet) {
    throw new Error("Failed to create wallet set — no data returned");
  }

  return [
    `## Wallet Set Created`,
    `**ID**: ${walletSet.id}`,
    `**Name**: ${(walletSet as { name?: string }).name ?? name}`,
    `**Custody Type**: ${(walletSet as { custodyType?: string }).custodyType ?? "DEVELOPER"}`,
    ``,
    `Use this wallet_set_id to create wallets with \`create_multichain_wallet\`.`,
  ].join("\n");
}

export async function handleCreateMultichainWallet(params: {
  wallet_set_id: string;
  user_id?: string;
}): Promise<string> {
  const { wallet_set_id, user_id } = z
    .object({
      wallet_set_id: z.string().min(1),
      user_id: z.string().optional(),
    })
    .parse(params);

  const response = await circleDeveloperSdk.createWallets({
    walletSetId: wallet_set_id,
    accountType: "SCA",
    blockchains: ["ARC-TESTNET", "BASE-SEPOLIA", "AVAX-FUJI"],
    count: 1,
  });

  const wallets = response.data?.wallets ?? [];
  if (wallets.length === 0) {
    throw new Error("Failed to create wallets — no wallets returned");
  }

  // Store in database if userId provided
  if (user_id) {
    for (const wallet of wallets) {
      await supabase.from("wallets").upsert(
        {
          user_id,
          name: wallet.name ?? "Multichain SCA",
          address: wallet.address,
          wallet_address: wallet.address,
          blockchain: wallet.blockchain,
          type: "sca",
          circle_wallet_id: wallet.id,
          wallet_set_id,
        },
        { onConflict: "circle_wallet_id" }
      );
    }
  }

  const lines = [
    `## Multichain SCA Wallets Created`,
    `**Wallet Set ID**: ${wallet_set_id}`,
    ``,
    ...wallets.map(
      (w) =>
        `**${w.blockchain}**: \`${w.address}\` (ID: ${w.id})`
    ),
  ];

  return lines.join("\n");
}

export async function handleGetWalletInfo(params: {
  wallet_id: string;
}): Promise<string> {
  const { wallet_id } = z
    .object({ wallet_id: z.string().min(1) })
    .parse(params);

  const response = await circleDeveloperSdk.getWallet({ id: wallet_id });
  const wallet = response.data?.wallet;

  if (!wallet) {
    throw new Error(`Wallet ${wallet_id} not found`);
  }

  return [
    `## Wallet Information`,
    `**ID**: ${wallet.id}`,
    `**Address**: ${wallet.address}`,
    `**Blockchain**: ${wallet.blockchain}`,
    `**Account Type**: ${(wallet as { accountType?: string }).accountType ?? "SCA"}`,
    `**State**: ${wallet.state}`,
    `**Custody Type**: ${(wallet as { custodyType?: string }).custodyType ?? "DEVELOPER"}`,
    wallet.name ? `**Name**: ${wallet.name}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function handleGetEoaWallets(params: {
  user_id: string;
}): Promise<string> {
  const { user_id } = z
    .object({ user_id: z.string().min(1) })
    .parse(params);

  const wallets = await listGatewayEOAWallets(user_id);

  if (wallets.length === 0) {
    return [
      `## EOA Wallets`,
      `No EOA signer wallets found for user ${user_id}.`,
      `Use \`init_eoa_wallet\` to create one.`,
    ].join("\n");
  }

  const lines = [`## EOA Signer Wallets`, `**User**: ${user_id}`, ``];
  for (const w of wallets) {
    lines.push(
      `- **${w.blockchain}**: \`${w.address}\` (Circle ID: ${w.circle_wallet_id})`
    );
  }

  return lines.join("\n");
}

export async function handleInitEoaWallet(params: {
  user_id: string;
  blockchain?: string;
}): Promise<string> {
  const { user_id, blockchain } = z
    .object({
      user_id: z.string().min(1),
      blockchain: z.string().default("ARC-TESTNET"),
    })
    .parse(params);

  const wallet = await getOrCreateGatewayEOAWallet(user_id, blockchain);

  return [
    `## EOA Wallet Ready`,
    `**User**: ${user_id}`,
    `**Wallet ID**: ${wallet.walletId}`,
    `**Address**: ${wallet.address}`,
    `**Works on**: All supported chains (Arc Testnet, Base Sepolia, Avalanche Fuji)`,
    ``,
    `This wallet will be used to sign burn intents for cross-chain transfers.`,
  ].join("\n");
}

export async function handleGetTransactionHistory(params: {
  user_id: string;
  limit?: number;
  tx_type?: string;
}): Promise<string> {
  const { user_id, limit, tx_type } = z
    .object({
      user_id: z.string().min(1),
      limit: z.number().int().positive().max(100).default(20),
      tx_type: z.enum(["deposit", "transfer", "unify"]).optional(),
    })
    .parse(params);

  let query = supabase
    .from("transaction_history")
    .select("*")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (tx_type) {
    query = query.eq("tx_type", tx_type);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Error fetching transactions: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return `No transactions found for user ${user_id}.`;
  }

  const lines = [
    `## Transaction History`,
    `**User**: ${user_id}`,
    `**Showing**: ${data.length} transactions`,
    ``,
  ];

  for (const tx of data) {
    const date = new Date(tx.created_at).toISOString().split("T")[0];
    const statusEmoji =
      tx.status === "success" ? "✓" : tx.status === "pending" ? "⏳" : "✗";
    const typeLabel = tx.tx_type.toUpperCase();

    let description = `${statusEmoji} **${typeLabel}** — ${tx.amount} USDC on ${tx.chain}`;
    if (tx.destination_chain) {
      description += ` → ${tx.destination_chain}`;
    }
    if (tx.tx_hash) {
      description += `\n   TX: \`${tx.tx_hash}\``;
    }
    if (tx.reason) {
      description += `\n   Reason: ${tx.reason}`;
    }
    description += `\n   Date: ${date}`;

    lines.push(description);
    lines.push("");
  }

  return lines.join("\n");
}

export async function handleGetUserWallets(params: {
  user_id: string;
}): Promise<string> {
  const { user_id } = z
    .object({ user_id: z.string().min(1) })
    .parse(params);

  const { data, error } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Error fetching wallets: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return `No wallets found for user ${user_id}.`;
  }

  const lines = [
    `## User Wallets`,
    `**User ID**: ${user_id}`,
    `**Count**: ${data.length} wallets`,
    ``,
  ];

  for (const w of data) {
    lines.push(
      `- **${w.blockchain ?? "MULTICHAIN"}** [${w.type}]: \`${w.address ?? w.wallet_address}\``
    );
    lines.push(`  Circle ID: ${w.circle_wallet_id}`);
    lines.push(`  Name: ${w.name ?? "—"}`);
    lines.push("");
  }

  return lines.join("\n");
}
