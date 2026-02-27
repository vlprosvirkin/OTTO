/**
 * MCP Tools: Gateway info and status
 */

import { z } from "zod";
import { fetchGatewayInfo, DOMAIN_IDS, CHAIN_BY_DOMAIN } from "../lib/circle/gateway-sdk.js";

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const gatewayTools = [
  {
    name: "get_gateway_info",
    description:
      "Fetch Circle Gateway configuration and status. Returns version, supported domains/chains, contract addresses, and token support.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_supported_chains",
    description:
      "Get a list of all supported chains with their domain IDs, USDC contract addresses, and Circle blockchain names.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_transfer_status",
    description:
      "Check the status of a cross-chain transfer by its transfer ID from the Circle Gateway API.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transfer_id: {
          type: "string",
          description: "The transfer ID returned from a previous transfer operation",
        },
      },
      required: ["transfer_id"],
    },
  },
] as const;

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

export async function handleGetGatewayInfo(): Promise<string> {
  const info = await fetchGatewayInfo();

  const lines = [
    `## Circle Gateway Info`,
    `**Version**: ${info.version}`,
    `**Domains**: ${info.domains.length}`,
    ``,
  ];

  for (const domain of info.domains) {
    lines.push(`### ${domain.chain} (${domain.network})`);
    lines.push(`**Domain ID**: ${domain.domain}`);
    lines.push(
      `**Gateway Wallet**: \`${domain.walletContract.address}\``
    );
    lines.push(
      `**Gateway Minter**: \`${domain.minterContract.address}\``
    );
    lines.push(
      `**Supported Tokens**: ${domain.walletContract.supportedTokens.join(", ")}`
    );
    lines.push(
      `**Processed Height**: ${domain.processedHeight}`
    );
    lines.push(
      `**Burn Intent Expiration**: block +${domain.burnIntentExpirationHeight}`
    );
    lines.push("");
  }

  return lines.join("\n");
}

export async function handleGetSupportedChains(): Promise<string> {
  const { USDC_ADDRESSES, CIRCLE_CHAIN_NAMES } = await import(
    "../lib/circle/gateway-sdk.js"
  );

  const lines = [
    `## Supported Chains`,
    ``,
    `| Chain | Domain ID | USDC Address | Circle Name |`,
    `|-------|-----------|--------------|-------------|`,
  ];

  const chains: Array<{
    key: string;
    domainId: number;
    usdcAddress: string;
    circleName: string;
  }> = [
    {
      key: "arcTestnet",
      domainId: DOMAIN_IDS.arcTestnet,
      usdcAddress: USDC_ADDRESSES.arcTestnet,
      circleName: CIRCLE_CHAIN_NAMES.arcTestnet,
    },
    {
      key: "avalancheFuji",
      domainId: DOMAIN_IDS.avalancheFuji,
      usdcAddress: USDC_ADDRESSES.avalancheFuji,
      circleName: CIRCLE_CHAIN_NAMES.avalancheFuji,
    },
    {
      key: "baseSepolia",
      domainId: DOMAIN_IDS.baseSepolia,
      usdcAddress: USDC_ADDRESSES.baseSepolia,
      circleName: CIRCLE_CHAIN_NAMES.baseSepolia,
    },
  ];

  for (const c of chains) {
    lines.push(
      `| ${c.key} | ${c.domainId} | \`${c.usdcAddress}\` | ${c.circleName} |`
    );
  }

  lines.push("");
  lines.push(
    `**Gateway Wallet Address**: \`0x0077777d7EBA4688BDeF3E311b846F25870A19B9\` (same on all chains)`
  );
  lines.push(
    `**Gateway Minter Address**: \`0x0022222ABE238Cc2C7Bb1f21003F0a260052475B\``
  );

  return lines.join("\n");
}

export async function handleGetTransferStatus(params: {
  transfer_id: string;
}): Promise<string> {
  const { transfer_id } = z
    .object({ transfer_id: z.string().min(1) })
    .parse(params);

  const response = await fetch(
    `https://gateway-api-testnet.circle.com/v1/transfers/${transfer_id}`
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gateway API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const status = data["status"] || data["state"] || "unknown";

  const lines = [
    `## Transfer Status`,
    `**Transfer ID**: ${transfer_id}`,
    `**Status**: ${status}`,
  ];

  if (data["sourceDomain"] !== undefined) {
    const sourceChain =
      CHAIN_BY_DOMAIN[data["sourceDomain"] as number] ?? `domain ${data["sourceDomain"]}`;
    const destChain =
      CHAIN_BY_DOMAIN[data["destinationDomain"] as number] ??
      `domain ${data["destinationDomain"]}`;
    lines.push(`**Source**: ${sourceChain} (domain ${data["sourceDomain"]})`);
    lines.push(
      `**Destination**: ${destChain} (domain ${data["destinationDomain"]})`
    );
  }

  if (data["amount"]) {
    const humanAmount = (Number(data["amount"]) / 1_000_000).toFixed(6);
    lines.push(`**Amount**: ${humanAmount} USDC`);
  }

  if (data["attestation"]) {
    lines.push(`**Attestation**: ${(data["attestation"] as string).slice(0, 30)}...`);
    lines.push(`**Signature**: ${(data["signature"] as string).slice(0, 30)}...`);
  }

  return lines.join("\n");
}
