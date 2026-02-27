/**
 * x402 Nanopayment Tools
 *
 * Enables the AI agent to autonomously pay for HTTP resources using the x402 protocol.
 * When a server responds with 402 Payment Required, the agent automatically pays in USDC
 * and retries the request. No gas needed — Circle Gateway handles offchain settlement.
 *
 * Requires environment variable:
 *   X402_PAYER_PRIVATE_KEY  — EVM private key (0x-prefixed) for the agent's payment wallet
 *
 * Fund the payer wallet with USDC on Arc Testnet or Base Sepolia before using x402_fetch.
 */

import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import type { ClientEvmSigner } from "@x402/evm";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, avalancheFuji } from "viem/chains";
import { arcTestnet } from "../lib/circle/gateway-sdk.js";

// ─── Chain registry ────────────────────────────────────────────────────────────

const CHAINS = { arcTestnet, baseSepolia, avalancheFuji } as const;

const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  arcTestnet: "0x3600000000000000000000000000000000000000",
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  avalancheFuji: "0x5425890298aed601595a70ab815c96711a31bc65",
};

// ─── Build the x402 fetch client (lazy, cached) ───────────────────────────────

let _fetchWithPayment: typeof fetch | null = null;

function getPaymentFetch(): typeof fetch {
  if (_fetchWithPayment) return _fetchWithPayment;

  const privateKey = process.env.X402_PAYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      "X402_PAYER_PRIVATE_KEY is not set. " +
        "Please set it to an EVM private key (0x-prefixed) with USDC on the target chain."
    );
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  // Use Arc Testnet as default public client for readContract (USDC allowance checks).
  // x402 will auto-detect the correct payment chain from the server's 402 response.
  const defaultPublicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
  });

  // Build a ClientEvmSigner manually to satisfy the x402 type requirement.
  // The signer signs EIP-3009 / Permit2 authorizations; readContract checks allowances.
  const signer: ClientEvmSigner = {
    address: account.address,
    signTypedData: (message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) =>
      account.signTypedData({
        domain: message.domain as Parameters<typeof account.signTypedData>[0]["domain"],
        types: message.types as Parameters<typeof account.signTypedData>[0]["types"],
        primaryType: message.primaryType,
        message: message.message,
      }),
    readContract: (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    }) =>
      defaultPublicClient.readContract({
        address: args.address,
        abi: args.abi as Parameters<typeof defaultPublicClient.readContract>[0]["abi"],
        functionName: args.functionName,
        args: args.args as Parameters<typeof defaultPublicClient.readContract>[0]["args"],
      }),
  };

  _fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      // Wildcard handles Arc Testnet, Base Sepolia, Avalanche Fuji, and any other EVM chain
      { network: "eip155:*", client: new ExactEvmScheme(signer) },
    ],
  }) as unknown as typeof fetch;

  return _fetchWithPayment;
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export interface X402FetchParams {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: string;
  headers?: Record<string, string>;
}

/**
 * Makes an HTTP request to an x402-enabled endpoint.
 * If the server responds with 402 Payment Required, automatically pays in USDC
 * and retries the request. Returns response body + payment receipt.
 */
export async function handleX402Fetch(params: X402FetchParams): Promise<string> {
  const { url, method = "GET", body, headers = {} } = params;

  const paymentFetch = getPaymentFetch();

  const requestInit: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };

  if (body && method !== "GET" && method !== "DELETE") {
    requestInit.body = body;
  }

  const response = (await paymentFetch(url, requestInit)) as Response;

  // Decode payment receipt if x402 payment was made
  let paymentMade = false;
  let paymentDetails: Record<string, unknown> | null = null;

  const paymentResponseHeader =
    response.headers.get("PAYMENT-RESPONSE") ??
    response.headers.get("X-PAYMENT-RESPONSE");

  if (paymentResponseHeader) {
    paymentMade = true;
    try {
      paymentDetails = decodePaymentResponseHeader(paymentResponseHeader) as Record<
        string,
        unknown
      >;
    } catch {
      paymentDetails = { raw: paymentResponseHeader };
    }
  }

  // Parse response body
  let responseBody: unknown;
  const contentType = response.headers.get("content-type") ?? "";
  try {
    responseBody = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
  } catch {
    responseBody = "(failed to parse response body)";
  }

  return JSON.stringify(
    {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      paymentMade,
      paymentDetails,
      url,
      data: responseBody,
    },
    null,
    2
  );
}

/**
 * Returns information about the configured x402 payer wallet:
 * address, USDC balances per chain. Does NOT reveal the private key.
 */
export async function handleX402PayerInfo(
  _params: Record<string, never>
): Promise<string> {
  const privateKey = process.env.X402_PAYER_PRIVATE_KEY;

  if (!privateKey) {
    return JSON.stringify({
      configured: false,
      message:
        "X402_PAYER_PRIVATE_KEY is not set. The agent cannot make x402 payments.",
      hint: "Set X402_PAYER_PRIVATE_KEY to an EVM private key with USDC on Arc/Base.",
    });
  }

  try {
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    const balances: Record<string, string> = {};

    await Promise.allSettled(
      Object.entries(CHAINS).map(async ([name, chain]) => {
        try {
          const client = createPublicClient({ chain, transport: http() });
          const raw = (await client.readContract({
            address: USDC_ADDRESSES[name],
            abi: [
              {
                name: "balanceOf",
                type: "function",
                inputs: [{ name: "account", type: "address" }],
                outputs: [{ name: "", type: "uint256" }],
                stateMutability: "view",
              },
            ],
            functionName: "balanceOf",
            args: [account.address],
          })) as bigint;
          balances[name] = `${(Number(raw) / 1e6).toFixed(6)} USDC`;
        } catch {
          balances[name] = "unavailable";
        }
      })
    );

    return JSON.stringify({
      configured: true,
      payerAddress: account.address,
      usdcBalances: balances,
      supportedNetworks: [
        { name: "arcTestnet", eip155: "eip155:5042002" },
        { name: "baseSepolia", eip155: "eip155:84532" },
        { name: "avalancheFuji", eip155: "eip155:43113" },
      ],
      note: "Fund payerAddress with USDC on Arc Testnet or Base Sepolia to enable x402 payments.",
    });
  } catch {
    return JSON.stringify({
      configured: false,
      message:
        "X402_PAYER_PRIVATE_KEY is invalid. Provide a valid 0x-prefixed EVM private key.",
    });
  }
}
