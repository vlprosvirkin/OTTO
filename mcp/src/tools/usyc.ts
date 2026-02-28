/**
 * USYC Yield MCP Tools
 *
 * Interact with Hashnote USYC (tokenized US T-bills) on Arc Testnet.
 * Allows the agent to invest idle USDC into USYC for yield and redeem back.
 *
 * Contracts (Arc Testnet):
 *   USYC token:        0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C
 *   USDC:              0x3600000000000000000000000000000000000000
 *
 * Environment variables:
 *   X402_PAYER_PRIVATE_KEY — Agent private key (same wallet used for vault operations)
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
import { arcTestnet, USDC_ADDRESSES } from "../lib/circle/gateway-sdk.js";

// ─── Chain registry ───────────────────────────────────────────────────────────

type SupportedChain = "arcTestnet" | "baseSepolia" | "avalancheFuji";

const CHAINS: Record<SupportedChain, Chain> = {
  arcTestnet,
  baseSepolia,
  avalancheFuji,
};

const EXPLORER_TX: Record<SupportedChain, string> = {
  arcTestnet:    "https://explorer.testnet.arc.network/tx",
  baseSepolia:   "https://sepolia.basescan.org/tx",
  avalancheFuji: "https://testnet.snowtrace.io/tx",
};

// ─── Contract addresses ──────────────────────────────────────────────────────

const USYC_TOKEN: Record<SupportedChain, Address> = {
  arcTestnet:    "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C",
  baseSepolia:   "0x0000000000000000000000000000000000000000", // not deployed
  avalancheFuji: "0x0000000000000000000000000000000000000000", // not deployed
};

const USYC_RATE_API = "https://usyc.hashnote.com/api/price";

// ─── ABIs ────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

// USYC Teller ABI — buy(USDC → USYC) and sell(USYC → USDC)
const USYC_TELLER_ABI = [
  {
    name: "buy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "usdcAmount", type: "uint256" }],
    outputs: [{ name: "usycAmount", type: "uint256" }],
  },
  {
    name: "sell",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "usycAmount", type: "uint256" }],
    outputs: [{ name: "usdcAmount", type: "uint256" }],
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveChain(chain?: string): SupportedChain {
  if (!chain) return "arcTestnet";
  if (chain in CHAINS) return chain as SupportedChain;
  throw new Error(`Unsupported chain: ${chain}. Use: arcTestnet | baseSepolia | avalancheFuji`);
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

function formatUsyc(atomic: bigint, decimals = 6): string {
  return (Number(atomic) / Math.pow(10, decimals)).toFixed(6);
}

function getUsycToken(chain: SupportedChain): Address {
  const addr = USYC_TOKEN[chain];
  if (addr === "0x0000000000000000000000000000000000000000") {
    throw new Error(`USYC is not deployed on ${chain}. Use arcTestnet.`);
  }
  return addr;
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

/**
 * Fetch current USYC rate from Hashnote price API.
 */
export async function handleUsycRate(): Promise<string> {
  try {
    const response = await fetch(USYC_RATE_API);
    if (!response.ok) {
      return JSON.stringify({
        error: `Hashnote API returned ${response.status}`,
        hint: "The USYC price API may be temporarily unavailable.",
      });
    }

    const data = await response.json() as Record<string, unknown>;

    return JSON.stringify({
      rate: data.price ?? data.rate ?? data,
      source: "Hashnote",
      api: USYC_RATE_API,
      timestamp: new Date().toISOString(),
      raw: data,
    });
  } catch (err) {
    return JSON.stringify({
      error: `Failed to fetch USYC rate: ${(err as Error).message}`,
      hint: "Check network connectivity to usyc.hashnote.com",
    });
  }
}

export interface UsycBalanceParams {
  address?: string;
  chain?: string;
}

/**
 * Read USYC token balance for an address. Also fetches current rate to show USD value.
 */
export async function handleUsycBalance(params: UsycBalanceParams): Promise<string> {
  const chain = resolveChain(params.chain);
  const usycToken = getUsycToken(chain);
  const client = getPublicClient(chain);

  // If no address provided, use agent wallet
  let address: Address;
  if (params.address) {
    address = params.address as Address;
  } else {
    const pk = process.env.X402_PAYER_PRIVATE_KEY;
    if (!pk) throw new Error("No address provided and X402_PAYER_PRIVATE_KEY not set.");
    address = privateKeyToAccount(pk as `0x${string}`).address;
  }

  try {
    const [usycBalance, usycDecimals] = await Promise.all([
      client.readContract({
        address: usycToken,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      }) as Promise<bigint>,
      client.readContract({
        address: usycToken,
        abi: ERC20_ABI,
        functionName: "decimals",
      }).catch(() => 6n) as Promise<bigint>,
    ]);

    const decimals = Number(usycDecimals);
    const balance = Number(usycBalance) / Math.pow(10, decimals);

    // Try to fetch rate for USD value estimate
    let usdValue: string | null = null;
    let rate: unknown = null;
    try {
      const rateResp = await fetch(USYC_RATE_API);
      if (rateResp.ok) {
        const rateData = await rateResp.json() as Record<string, unknown>;
        const priceNum = parseFloat(String(rateData.price ?? rateData.rate ?? "1"));
        rate = priceNum;
        usdValue = (balance * priceNum).toFixed(2);
      }
    } catch { /* rate is optional */ }

    return JSON.stringify({
      address,
      chain,
      usyc_token: usycToken,
      usyc_balance: formatUsyc(usycBalance, decimals),
      usyc_decimals: decimals,
      usdc_value: usdValue,
      rate,
      source: "on-chain + Hashnote",
    });
  } catch (err) {
    return JSON.stringify({
      error: `Failed to read USYC balance: ${(err as Error).message}`,
      address,
      chain,
      usyc_token: usycToken,
    });
  }
}

export interface UsycDepositParams {
  amount_usdc: number;
  chain?: string;
}

/**
 * Deposit USDC into USYC (buy tokenized T-bills).
 * Flow: approve USDC spend → call buy() on USYC token contract.
 */
export async function handleUsycDeposit(params: UsycDepositParams): Promise<string> {
  const { amount_usdc } = params;
  if (!amount_usdc || amount_usdc <= 0) throw new Error("Amount must be positive");

  const chain = resolveChain(params.chain);
  const usycToken = getUsycToken(chain);
  const usdcAddr = USDC_ADDRESSES[chain] as Address;
  const publicClient = getPublicClient(chain);
  const { client: walletClient, account } = getAgentWalletClient(chain);

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));

  // Check USDC balance first
  const usdcBalance = (await publicClient.readContract({
    address: usdcAddr,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  if (usdcBalance < amountAtomic) {
    return JSON.stringify({
      error: "Insufficient USDC balance",
      required: formatUsdc(amountAtomic),
      available: formatUsdc(usdcBalance),
      chain,
    });
  }

  try {
    // Step 1: Approve USDC spend to USYC token contract
    const approveTxHash = await walletClient.writeContract({
      address: usdcAddr,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [usycToken, amountAtomic],
    });

    // Wait for approve confirmation
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

    // Step 2: Buy USYC
    const buyTxHash = await walletClient.writeContract({
      address: usycToken,
      abi: USYC_TELLER_ABI,
      functionName: "buy",
      args: [amountAtomic],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: buyTxHash });

    return JSON.stringify({
      success: receipt.status === "success",
      tx_hash: buyTxHash,
      approve_tx: approveTxHash,
      amount_usdc: amount_usdc,
      chain,
      explorer: `${EXPLORER_TX[chain]}/${buyTxHash}`,
      note: "USDC deposited into USYC. Check usyc_balance to see updated holdings.",
    });
  } catch (err) {
    return JSON.stringify({
      error: `USYC deposit failed: ${(err as Error).message}`,
      amount_usdc,
      chain,
    });
  }
}

export interface UsycRedeemParams {
  amount_usyc: number;
  chain?: string;
}

/**
 * Redeem USYC back to USDC (sell tokenized T-bills).
 */
export async function handleUsycRedeem(params: UsycRedeemParams): Promise<string> {
  const { amount_usyc } = params;
  if (!amount_usyc || amount_usyc <= 0) throw new Error("Amount must be positive");

  const chain = resolveChain(params.chain);
  const usycToken = getUsycToken(chain);
  const publicClient = getPublicClient(chain);
  const { client: walletClient, account } = getAgentWalletClient(chain);

  // USYC has 6 decimals (like USDC)
  const amountAtomic = BigInt(Math.round(amount_usyc * 1_000_000));

  // Check USYC balance
  const usycBalance = (await publicClient.readContract({
    address: usycToken,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  if (usycBalance < amountAtomic) {
    return JSON.stringify({
      error: "Insufficient USYC balance",
      required: formatUsyc(amountAtomic),
      available: formatUsyc(usycBalance),
      chain,
    });
  }

  try {
    const sellTxHash = await walletClient.writeContract({
      address: usycToken,
      abi: USYC_TELLER_ABI,
      functionName: "sell",
      args: [amountAtomic],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: sellTxHash });

    return JSON.stringify({
      success: receipt.status === "success",
      tx_hash: sellTxHash,
      amount_usyc: amount_usyc,
      chain,
      explorer: `${EXPLORER_TX[chain]}/${sellTxHash}`,
      note: "USYC redeemed to USDC. Check get_usdc_balance to see updated USDC holdings.",
    });
  } catch (err) {
    return JSON.stringify({
      error: `USYC redeem failed: ${(err as Error).message}`,
      amount_usyc,
      chain,
    });
  }
}
