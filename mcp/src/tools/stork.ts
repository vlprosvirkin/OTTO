/**
 * Stork Oracle MCP Tools
 *
 * Fetch real-time price feeds from Stork Oracle — both via REST API and on-chain
 * aggregator on Arc Testnet. Falls back to mock data if API key is not configured.
 *
 * Environment variables:
 *   STORK_API_KEY  — Stork REST API basic auth token (optional, falls back to mock)
 */

import { createPublicClient, http, keccak256, toHex, type Chain } from "viem";
import { baseSepolia, avalancheFuji } from "viem/chains";
import { arcTestnet } from "../lib/circle/gateway-sdk.js";

// ─── Chain registry ───────────────────────────────────────────────────────────

type SupportedChain = "arcTestnet" | "baseSepolia" | "avalancheFuji";

const CHAINS: Record<SupportedChain, Chain> = {
  arcTestnet,
  baseSepolia,
  avalancheFuji,
};

// Stork on-chain aggregator (Arc Testnet)
const STORK_CONTRACT = "0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62" as const;

const STORK_ABI = [
  {
    name: "getTemporalNumericValueV1",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "timestampNs", type: "uint64" },
      { name: "quantizedValue", type: "int192" },
    ],
  },
] as const;

const STORK_REST_URL = "https://rest.jp.stork-oracle.network/v1/prices/latest";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPublicClient(chain: SupportedChain) {
  return createPublicClient({
    chain: CHAINS[chain],
    transport: http(),
  });
}

function resolveChain(chain?: string): SupportedChain {
  if (!chain) return "arcTestnet";
  if (chain in CHAINS) return chain as SupportedChain;
  throw new Error(`Unsupported chain: ${chain}. Use: arcTestnet | baseSepolia | avalancheFuji`);
}

/** Encode asset name as bytes32 for Stork on-chain lookup. */
function assetToId(asset: string): `0x${string}` {
  // Stork uses keccak256 of the encoded asset string
  return keccak256(toHex(asset, { size: 32 }));
}

// ─── Mock fallback (same shape as Stork response) ────────────────────────────

function mockPrice(asset: string) {
  const base = asset === "ETHUSD" ? 2847.42 : 1.0;
  const price = parseFloat((base + (Math.random() - 0.5) * 20).toFixed(2));
  return {
    asset,
    price,
    change24h: parseFloat(((Math.random() - 0.5) * 4).toFixed(2)),
    source: "mock (Stork unavailable)",
    timestamp: new Date().toISOString(),
  };
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export interface StorkPriceParams {
  assets?: string;
}

/**
 * Fetch latest price from Stork REST API.
 * Requires STORK_API_KEY env var. Falls back to mock if unavailable.
 */
export async function handleStorkPrice(params: StorkPriceParams): Promise<string> {
  const assets = params.assets ?? "ETHUSD";
  const apiKey = process.env.STORK_API_KEY;

  if (!apiKey) {
    return JSON.stringify({
      ...mockPrice(assets),
      note: "STORK_API_KEY not set — returning mock data. Set it in .env for real Stork feeds.",
    });
  }

  try {
    const url = `${STORK_REST_URL}?assets=${encodeURIComponent(assets)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${apiKey}` },
    });

    if (!response.ok) {
      const text = await response.text();
      return JSON.stringify({
        ...mockPrice(assets),
        note: `Stork API returned ${response.status}: ${text}. Falling back to mock.`,
      });
    }

    const data = await response.json();

    // Stork REST response shape: { data: { ETHUSD: { timestamp_ns, price, ... } } }
    const assetKey = assets.split(",")[0]; // primary asset
    const feed = (data as Record<string, Record<string, unknown>>)?.data?.[assetKey];

    if (!feed) {
      return JSON.stringify({
        ...mockPrice(assets),
        note: `Asset ${assetKey} not found in Stork response. Falling back to mock.`,
        raw: data,
      });
    }

    const priceStr = (feed as Record<string, unknown>).price as string;
    const timestampNs = (feed as Record<string, unknown>).timestamp_ns as number;

    return JSON.stringify({
      asset: assetKey,
      price: parseFloat(priceStr),
      timestamp: new Date(timestampNs / 1_000_000).toISOString(),
      source: "Stork Oracle",
      raw: feed,
    });
  } catch (err) {
    return JSON.stringify({
      ...mockPrice(assets),
      note: `Stork API error: ${(err as Error).message}. Falling back to mock.`,
    });
  }
}

export interface StorkOnChainParams {
  asset?: string;
  chain?: string;
}

/**
 * Read price from Stork on-chain aggregator contract.
 * Only available on Arc Testnet (where Stork is deployed).
 */
export async function handleStorkOnChainPrice(params: StorkOnChainParams): Promise<string> {
  const asset = params.asset ?? "ETHUSD";
  const chain = resolveChain(params.chain);
  const client = getPublicClient(chain);

  const id = assetToId(asset);

  try {
    const result = await client.readContract({
      address: STORK_CONTRACT,
      abi: STORK_ABI,
      functionName: "getTemporalNumericValueV1",
      args: [id],
    });

    const [timestampNs, quantizedValue] = result as [bigint, bigint];

    // Stork quantized values have 18 decimals
    const price = Number(quantizedValue) / 1e18;
    const timestamp = new Date(Number(timestampNs) / 1_000_000).toISOString();

    return JSON.stringify({
      asset,
      price,
      timestamp,
      source: `Stork On-Chain (${chain})`,
      contract: STORK_CONTRACT,
      assetId: id,
    });
  } catch (err) {
    return JSON.stringify({
      error: `Failed to read Stork on-chain price for ${asset} on ${chain}: ${(err as Error).message}`,
      contract: STORK_CONTRACT,
      assetId: id,
      hint: "Stork aggregator may only be deployed on Arc Testnet. Try chain=arcTestnet.",
    });
  }
}
