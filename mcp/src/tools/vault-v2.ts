/**
 * OTTOVault V2 — Governance Treasury MCP Tools
 *
 * Interact with OTTOVaultV2, OTTOShareToken, and OTTOGovernor contracts.
 * Provides: deploy, status, shareholders, revenue distribution, governance voting,
 * yield management, and dissolution tracking.
 *
 * V2 operates on Arc Testnet only (governance chain). Satellite V1 vaults
 * on Base Sepolia / Avalanche Fuji are managed via the existing vault.ts tools.
 *
 * Environment variables:
 *   X402_PAYER_PRIVATE_KEY — Agent private key (same wallet used for V1 + x402)
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "../lib/circle/gateway-sdk.js";

// ─── Chain (V2 is Arc Testnet only) ───────────────────────────────────────────

const CHAIN: Chain = arcTestnet;
const CHAIN_NAME = "Arc Testnet (5042002)";
const EXPLORER_TX = "https://testnet.arcscan.app/tx";
const EXPLORER_ADDR = "https://testnet.arcscan.app/address";

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const VAULT_V2_ABI = [
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
      { name: "ceo_", type: "address" },
      { name: "governor_", type: "address" },
      { name: "state_", type: "uint8" },
      { name: "totalInvestedInYield_", type: "uint256" },
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
  {
    name: "rewardPerTokenStored",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "pendingRevenue",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "vaultState",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "dissolutionPool",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "yieldBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalInvestedInYield",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "distributeRevenue",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "claimRevenue",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "investYield",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "usdcAmount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "redeemYield",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "usycAmount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "shareToken",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "governor",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "ceo",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  // ── Operational functions ──
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
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "ceoTransfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "setLimits",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_maxPerTx", type: "uint256" },
      { name: "_dailyLimit", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "setWhitelist",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "addr", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "setWhitelistEnabled",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "enabled", type: "bool" }],
    outputs: [],
  },
  {
    name: "setPaused",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_paused", type: "bool" }],
    outputs: [],
  },
  {
    name: "setAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newAgent", type: "address" }],
    outputs: [],
  },
  {
    name: "finalize",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "whitelist",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const ERC20_ABI = [
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
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const SHARE_TOKEN_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getVotes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "frozen",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const GOVERNOR_ABI = [
  {
    name: "propose",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "targets", type: "address[]" },
      { name: "values", type: "uint256[]" },
      { name: "calldatas", type: "bytes[]" },
      { name: "description", type: "string" },
    ],
    outputs: [{ name: "proposalId", type: "uint256" }],
  },
  {
    name: "castVote",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "support", type: "uint8" },
    ],
    outputs: [{ name: "weight", type: "uint256" }],
  },
  {
    name: "execute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "targets", type: "address[]" },
      { name: "values", type: "uint256[]" },
      { name: "calldatas", type: "bytes[]" },
      { name: "descriptionHash", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "state",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "votingDelay",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "votingPeriod",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "quorum",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "timepoint", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const FACTORY_V2_ABI = [
  {
    name: "deploy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "salt", type: "bytes32" },
      { name: "usdc", type: "address" },
      { name: "agent", type: "address" },
      { name: "maxPerTx", type: "uint256" },
      { name: "dailyLimit", type: "uint256" },
      { name: "whitelistEnabled", type: "bool" },
      { name: "shareholders", type: "address[]" },
      { name: "sharesBps", type: "uint256[]" },
    ],
    outputs: [
      { name: "vault", type: "address" },
      { name: "token", type: "address" },
      { name: "gov", type: "address" },
    ],
  },
  {
    name: "computeAddress",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "salt", type: "bytes32" },
      { name: "agent", type: "address" },
      { name: "maxPerTx", type: "uint256" },
      { name: "dailyLimit", type: "uint256" },
      { name: "whitelistEnabled", type: "bool" },
      { name: "shareholders", type: "address[]" },
      { name: "sharesBps", type: "uint256[]" },
    ],
    outputs: [
      { name: "vault", type: "address" },
      { name: "token", type: "address" },
      { name: "gov", type: "address" },
    ],
  },
] as const;

// setCeo / dissolve selectors for governor proposals
const VAULT_V2_PROPOSAL_ABI = [
  {
    name: "setCeo",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newCeo", type: "address" }],
    outputs: [],
  },
  {
    name: "dissolve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPublicClient() {
  return createPublicClient({ chain: CHAIN, transport: http() });
}

function getAgentWalletClient() {
  const pk = process.env.X402_PAYER_PRIVATE_KEY;
  if (!pk) {
    throw new Error("X402_PAYER_PRIVATE_KEY is not set.");
  }
  const account = privateKeyToAccount(pk as `0x${string}`);
  return {
    client: createWalletClient({ account, chain: CHAIN, transport: http() }),
    account,
  };
}

function formatUsdc(atomic: bigint): string {
  return (Number(atomic) / 1_000_000).toFixed(6);
}

function formatTokens(atomic: bigint): string {
  return (Number(atomic) / 1e18).toFixed(2);
}

const STATE_NAMES = ["Active", "Dissolving", "Dissolved"];
const PROPOSAL_STATES = [
  "Pending", "Active", "Canceled", "Defeated",
  "Succeeded", "Queued", "Expired", "Executed",
];

const USDC_ARC: Address = "0x3600000000000000000000000000000000000000";

// ─── 1. Deploy ────────────────────────────────────────────────────────────────

export interface VaultV2DeployParams {
  factory_address: string;
  salt: string;
  shareholders: string[];
  shares_bps: number[];
  max_per_tx_usdc?: number;
  daily_limit_usdc?: number;
  whitelist_enabled?: boolean;
}

export async function handleVaultV2Deploy(params: VaultV2DeployParams): Promise<string> {
  const {
    factory_address,
    salt,
    shareholders,
    shares_bps,
  } = params;

  const maxPerTx = BigInt(Math.round((params.max_per_tx_usdc ?? 10) * 1_000_000));
  const dailyLimit = BigInt(Math.round((params.daily_limit_usdc ?? 100) * 1_000_000));
  const whitelistEnabled = params.whitelist_enabled ?? false;

  if (!factory_address?.startsWith("0x")) throw new Error("Invalid factory_address");
  if (!salt) throw new Error("salt is required");
  if (!shareholders?.length) throw new Error("shareholders array is required");
  if (shareholders.length !== shares_bps.length) throw new Error("shareholders and shares_bps must have same length");

  const bpsSum = shares_bps.reduce((a, b) => a + b, 0);
  if (bpsSum !== 10000) throw new Error(`shares_bps must sum to 10000, got ${bpsSum}`);

  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const saltBytes = (`0x${Buffer.from(salt).toString("hex").padEnd(64, "0")}`) as `0x${string}`;

  const txHash = await client.writeContract({
    address: factory_address as Address,
    abi: FACTORY_V2_ABI,
    functionName: "deploy",
    args: [
      saltBytes,
      USDC_ARC,
      account.address,
      maxPerTx,
      dailyLimit,
      whitelistEnabled,
      shareholders as Address[],
      shares_bps.map(BigInt),
    ],
    account,
    gas: 10_000_000n,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });

  if (receipt.status !== "success") {
    return JSON.stringify({ success: false, txHash, reason: "Factory deployment failed" });
  }

  // Read back addresses via computeAddress
  const [vault, token, gov] = (await publicClient.readContract({
    address: factory_address as Address,
    abi: FACTORY_V2_ABI,
    functionName: "computeAddress",
    args: [
      saltBytes,
      account.address,
      maxPerTx,
      dailyLimit,
      whitelistEnabled,
      shareholders as Address[],
      shares_bps.map(BigInt),
    ],
  })) as [Address, Address, Address];

  return JSON.stringify({
    success: true,
    vault,
    share_token: token,
    governor: gov,
    ceo: account.address,
    agent: account.address,
    shareholders,
    shares_bps,
    txHash,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 2. Status ────────────────────────────────────────────────────────────────

export interface VaultV2StatusParams {
  vault_address: string;
}

export async function handleVaultV2Status(params: VaultV2StatusParams): Promise<string> {
  const { vault_address } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");

  const client = getPublicClient();

  const result = (await client.readContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "status",
  })) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address, Address, number, bigint];

  const [balance, maxPerTx, dailyLimit, dailySpent, remainingToday,
    whitelistEnabled, paused, agentAddr, ceoAddr, govAddr, state, yieldInvested] = result;

  const tokenAddr = (await client.readContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "shareToken",
  })) as Address;

  let yieldBal = 0n;
  try {
    yieldBal = (await client.readContract({
      address: vault_address as Address,
      abi: VAULT_V2_ABI,
      functionName: "yieldBalance",
    })) as bigint;
  } catch { /* no yield strategy set */ }

  return [
    `## OTTOVault V2 Status`,
    `**Contract**: ${vault_address}`,
    `**Chain**: ${CHAIN_NAME}`,
    `**State**: ${STATE_NAMES[state] ?? "Unknown"}`,
    ``,
    `### Balance`,
    `**USDC Balance**: ${formatUsdc(balance)} USDC`,
    `**Yield Invested**: ${formatUsdc(yieldInvested)} USDC`,
    `**Yield Token Balance**: ${formatTokens(yieldBal)} USYC`,
    ``,
    `### Spending Limits`,
    `**Per-tx cap**: ${formatUsdc(maxPerTx)} USDC`,
    `**Daily limit**: ${formatUsdc(dailyLimit)} USDC`,
    `**Spent today**: ${formatUsdc(dailySpent)} USDC`,
    `**Remaining today**: ${formatUsdc(remainingToday)} USDC`,
    ``,
    `### Roles`,
    `**CEO**: ${ceoAddr}`,
    `**Agent**: ${agentAddr}`,
    `**Governor**: ${govAddr}`,
    `**Share Token**: ${tokenAddr}`,
    `**Whitelist**: ${whitelistEnabled ? "Enabled" : "Disabled"}`,
    `**Paused**: ${paused ? "YES" : "No"}`,
  ].join("\n");
}

// ─── 3. Shareholders ──────────────────────────────────────────────────────────

export interface VaultV2ShareholdersParams {
  vault_address: string;
  shareholders: string[];
}

export async function handleVaultV2Shareholders(params: VaultV2ShareholdersParams): Promise<string> {
  const { vault_address, shareholders } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!shareholders?.length) throw new Error("shareholders array is required");

  const client = getPublicClient();

  const tokenAddr = (await client.readContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "shareToken",
  })) as Address;

  const totalSupply = (await client.readContract({
    address: tokenAddr,
    abi: SHARE_TOKEN_ABI,
    functionName: "totalSupply",
  })) as bigint;

  const results = await Promise.all(
    shareholders.map(async (addr) => {
      const balance = (await client.readContract({
        address: tokenAddr,
        abi: SHARE_TOKEN_ABI,
        functionName: "balanceOf",
        args: [addr as Address],
      })) as bigint;

      const votes = (await client.readContract({
        address: tokenAddr,
        abi: SHARE_TOKEN_ABI,
        functionName: "getVotes",
        args: [addr as Address],
      })) as bigint;

      const pending = (await client.readContract({
        address: vault_address as Address,
        abi: VAULT_V2_ABI,
        functionName: "pendingRevenue",
        args: [addr as Address],
      })) as bigint;

      const pct = totalSupply > 0n ? (Number(balance) / Number(totalSupply) * 100).toFixed(2) : "0.00";

      return {
        address: addr,
        shares: formatTokens(balance),
        percentage: pct,
        votes: formatTokens(votes),
        pending_revenue_usdc: formatUsdc(pending),
      };
    })
  );

  return JSON.stringify({
    vault: vault_address,
    share_token: tokenAddr,
    total_supply: formatTokens(totalSupply),
    shareholders: results,
  }, null, 2);
}

// ─── 4. Distribute Revenue ────────────────────────────────────────────────────

export interface VaultV2DistributeRevenueParams {
  vault_address: string;
  amount_usdc: number;
}

export async function handleVaultV2DistributeRevenue(params: VaultV2DistributeRevenueParams): Promise<string> {
  const { vault_address, amount_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("amount_usdc must be positive");

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "distributeRevenue",
    args: [amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    amount_usdc,
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 5. Claim Revenue ─────────────────────────────────────────────────────────

export interface VaultV2ClaimRevenueParams {
  vault_address: string;
}

export async function handleVaultV2ClaimRevenue(params: VaultV2ClaimRevenueParams): Promise<string> {
  const { vault_address } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");

  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  // Check pending first
  const pending = (await publicClient.readContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "pendingRevenue",
    args: [account.address],
  })) as bigint;

  if (pending === 0n) {
    return JSON.stringify({ success: false, reason: "No pending revenue to claim", vault: vault_address });
  }

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "claimRevenue",
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    claimed_usdc: formatUsdc(pending),
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 6. Propose ───────────────────────────────────────────────────────────────

export interface VaultV2ProposeParams {
  vault_address: string;
  governor_address: string;
  action: "setCeo" | "dissolve";
  new_ceo?: string;
  description: string;
}

export async function handleVaultV2Propose(params: VaultV2ProposeParams): Promise<string> {
  const { vault_address, governor_address, action, description } = params;

  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!governor_address?.startsWith("0x")) throw new Error("governor_address is required");
  if (!description) throw new Error("description is required");

  let calldata: `0x${string}`;
  if (action === "setCeo") {
    if (!params.new_ceo?.startsWith("0x")) throw new Error("new_ceo is required for setCeo");
    calldata = encodeFunctionData({
      abi: VAULT_V2_PROPOSAL_ABI,
      functionName: "setCeo",
      args: [params.new_ceo as Address],
    });
  } else if (action === "dissolve") {
    calldata = encodeFunctionData({
      abi: VAULT_V2_PROPOSAL_ABI,
      functionName: "dissolve",
    });
  } else {
    throw new Error(`Unknown action: ${action}. Use: setCeo | dissolve`);
  }

  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: governor_address as Address,
    abi: GOVERNOR_ABI,
    functionName: "propose",
    args: [
      [vault_address as Address],
      [0n],
      [calldata],
      description,
    ],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action,
    description,
    txHash,
    vault: vault_address,
    governor: governor_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
    note: "Voting starts after votingDelay (1 block). Use v2_vote to cast votes.",
  }, null, 2);
}

// ─── 7. Vote ──────────────────────────────────────────────────────────────────

export interface VaultV2VoteParams {
  governor_address: string;
  proposal_id: string;
  support: number; // 0=Against, 1=For, 2=Abstain
}

export async function handleVaultV2Vote(params: VaultV2VoteParams): Promise<string> {
  const { governor_address, proposal_id, support } = params;

  if (!governor_address?.startsWith("0x")) throw new Error("governor_address is required");
  if (!proposal_id) throw new Error("proposal_id is required");
  if (support !== 0 && support !== 1 && support !== 2) {
    throw new Error("support must be 0 (Against), 1 (For), or 2 (Abstain)");
  }

  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: governor_address as Address,
    abi: GOVERNOR_ABI,
    functionName: "castVote",
    args: [BigInt(proposal_id), support],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  const supportLabels = ["Against", "For", "Abstain"];

  return JSON.stringify({
    success: receipt.status === "success",
    proposal_id,
    vote: supportLabels[support],
    voter: account.address,
    txHash,
    governor: governor_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 8. Execute ───────────────────────────────────────────────────────────────

export interface VaultV2ExecuteParams {
  vault_address: string;
  governor_address: string;
  action: "setCeo" | "dissolve";
  new_ceo?: string;
  description: string;
}

export async function handleVaultV2Execute(params: VaultV2ExecuteParams): Promise<string> {
  const { vault_address, governor_address, action, description } = params;

  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!governor_address?.startsWith("0x")) throw new Error("governor_address is required");

  let calldata: `0x${string}`;
  if (action === "setCeo") {
    if (!params.new_ceo?.startsWith("0x")) throw new Error("new_ceo is required for setCeo");
    calldata = encodeFunctionData({
      abi: VAULT_V2_PROPOSAL_ABI,
      functionName: "setCeo",
      args: [params.new_ceo as Address],
    });
  } else if (action === "dissolve") {
    calldata = encodeFunctionData({
      abi: VAULT_V2_PROPOSAL_ABI,
      functionName: "dissolve",
    });
  } else {
    throw new Error(`Unknown action: ${action}`);
  }

  const { keccak256: viemKeccak, toBytes } = await import("viem");
  const descriptionHash = viemKeccak(toBytes(description));

  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: governor_address as Address,
    abi: GOVERNOR_ABI,
    functionName: "execute",
    args: [
      [vault_address as Address],
      [0n],
      [calldata],
      descriptionHash,
    ],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action,
    txHash,
    vault: vault_address,
    governor: governor_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 9. Invest Yield ──────────────────────────────────────────────────────────

export interface VaultV2InvestYieldParams {
  vault_address: string;
  amount_usdc: number;
}

export async function handleVaultV2InvestYield(params: VaultV2InvestYieldParams): Promise<string> {
  const { vault_address, amount_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("amount_usdc must be positive");

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "investYield",
    args: [amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "investYield",
    amount_usdc,
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 10. Redeem Yield ─────────────────────────────────────────────────────────

export interface VaultV2RedeemYieldParams {
  vault_address: string;
  amount_usyc: number;
}

export async function handleVaultV2RedeemYield(params: VaultV2RedeemYieldParams): Promise<string> {
  const { vault_address, amount_usyc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!amount_usyc || amount_usyc <= 0) throw new Error("amount_usyc must be positive");

  const amountAtomic = BigInt(Math.round(amount_usyc * 1e18));
  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "redeemYield",
    args: [amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "redeemYield",
    amount_usyc,
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 11. Dissolve Status ──────────────────────────────────────────────────────

export interface VaultV2DissolveStatusParams {
  vault_address: string;
  shareholders: string[];
}

export async function handleVaultV2DissolveStatus(params: VaultV2DissolveStatusParams): Promise<string> {
  const { vault_address, shareholders } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!shareholders?.length) throw new Error("shareholders array is required");

  const client = getPublicClient();

  const stateNum = (await client.readContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "vaultState",
  })) as number;

  const pool = (await client.readContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "dissolutionPool",
  })) as bigint;

  const tokenAddr = (await client.readContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "shareToken",
  })) as Address;

  const totalSupply = (await client.readContract({
    address: tokenAddr,
    abi: SHARE_TOKEN_ABI,
    functionName: "totalSupply",
  })) as bigint;

  const frozen = (await client.readContract({
    address: tokenAddr,
    abi: SHARE_TOKEN_ABI,
    functionName: "frozen",
  })) as boolean;

  const holders = await Promise.all(
    shareholders.map(async (addr) => {
      const balance = (await client.readContract({
        address: tokenAddr,
        abi: SHARE_TOKEN_ABI,
        functionName: "balanceOf",
        args: [addr as Address],
      })) as bigint;

      const payout = totalSupply > 0n ? (pool * balance) / totalSupply : 0n;

      return {
        address: addr,
        shares: formatTokens(balance),
        payout_usdc: formatUsdc(payout),
      };
    })
  );

  return JSON.stringify({
    vault: vault_address,
    state: STATE_NAMES[stateNum] ?? "Unknown",
    dissolution_pool_usdc: formatUsdc(pool),
    token_frozen: frozen,
    shareholders: holders,
  }, null, 2);
}

// ─── 12. Agent Transfer ──────────────────────────────────────────────────────

export interface VaultV2TransferParams {
  vault_address: string;
  to: string;
  amount_usdc: number;
}

export async function handleVaultV2Transfer(params: VaultV2TransferParams): Promise<string> {
  const { vault_address, to, amount_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!to?.startsWith("0x")) throw new Error("to address is required");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("amount_usdc must be positive");

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  // Pre-check
  const [ok, reason] = (await publicClient.readContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "canTransfer",
    args: [to as Address, amountAtomic],
  })) as [boolean, string];

  if (!ok) {
    return JSON.stringify({ success: false, reason, vault: vault_address });
  }

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "transfer",
    args: [to as Address, amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "agentTransfer",
    to,
    amount_usdc,
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 13. Deposit ─────────────────────────────────────────────────────────────

export interface VaultV2DepositParams {
  vault_address: string;
  amount_usdc: number;
}

export async function handleVaultV2Deposit(params: VaultV2DepositParams): Promise<string> {
  const { vault_address, amount_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("amount_usdc must be positive");

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  // Approve USDC spend
  const approveTx = await client.writeContract({
    address: USDC_ARC,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [vault_address as Address, amountAtomic],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 30_000 });

  // Deposit
  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "deposit",
    args: [amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "deposit",
    amount_usdc,
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 14. Whitelist Management ────────────────────────────────────────────────

export interface VaultV2WhitelistParams {
  vault_address: string;
  address: string;
  allowed: boolean;
}

export async function handleVaultV2Whitelist(params: VaultV2WhitelistParams): Promise<string> {
  const { vault_address, address: addr, allowed } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!addr?.startsWith("0x")) throw new Error("address is required");

  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "setWhitelist",
    args: [addr as Address, allowed],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: allowed ? "whitelistAdd" : "whitelistRemove",
    address: addr,
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 15. Whitelist Toggle ────────────────────────────────────────────────────

export interface VaultV2WhitelistToggleParams {
  vault_address: string;
  enabled: boolean;
}

export async function handleVaultV2WhitelistToggle(params: VaultV2WhitelistToggleParams): Promise<string> {
  const { vault_address, enabled } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");

  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "setWhitelistEnabled",
    args: [enabled],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "whitelistToggle",
    enabled,
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 16. CEO Transfer ────────────────────────────────────────────────────────

export interface VaultV2CeoTransferParams {
  vault_address: string;
  to: string;
  amount_usdc: number;
}

export async function handleVaultV2CeoTransfer(params: VaultV2CeoTransferParams): Promise<string> {
  const { vault_address, to, amount_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!to?.startsWith("0x")) throw new Error("to address is required");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("amount_usdc must be positive");

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "ceoTransfer",
    args: [to as Address, amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "ceoTransfer",
    to,
    amount_usdc,
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 17. CEO Withdraw ────────────────────────────────────────────────────────

export interface VaultV2WithdrawParams {
  vault_address: string;
  amount_usdc: number;
}

export async function handleVaultV2Withdraw(params: VaultV2WithdrawParams): Promise<string> {
  const { vault_address, amount_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("amount_usdc must be positive");

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "withdraw",
    args: [amountAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "ceoWithdraw",
    amount_usdc,
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 18. Set Limits ──────────────────────────────────────────────────────────

export interface VaultV2SetLimitsParams {
  vault_address: string;
  max_per_tx_usdc: number;
  daily_limit_usdc: number;
}

export async function handleVaultV2SetLimits(params: VaultV2SetLimitsParams): Promise<string> {
  const { vault_address, max_per_tx_usdc, daily_limit_usdc } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");
  if (!max_per_tx_usdc || max_per_tx_usdc <= 0) throw new Error("max_per_tx_usdc must be positive");
  if (!daily_limit_usdc || daily_limit_usdc <= 0) throw new Error("daily_limit_usdc must be positive");

  const maxAtomic = BigInt(Math.round(max_per_tx_usdc * 1_000_000));
  const dailyAtomic = BigInt(Math.round(daily_limit_usdc * 1_000_000));
  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "setLimits",
    args: [maxAtomic, dailyAtomic],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "setLimits",
    max_per_tx_usdc,
    daily_limit_usdc,
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 19. Pause / Unpause ─────────────────────────────────────────────────────

export interface VaultV2PauseParams {
  vault_address: string;
  paused: boolean;
}

export async function handleVaultV2Pause(params: VaultV2PauseParams): Promise<string> {
  const { vault_address, paused: pauseVal } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");

  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "setPaused",
    args: [pauseVal],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: pauseVal ? "pause" : "unpause",
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

// ─── 20. Finalize Dissolution ────────────────────────────────────────────────

export interface VaultV2FinalizeParams {
  vault_address: string;
}

export async function handleVaultV2Finalize(params: VaultV2FinalizeParams): Promise<string> {
  const { vault_address } = params;
  if (!vault_address?.startsWith("0x")) throw new Error("vault_address is required");

  const { client, account } = getAgentWalletClient();
  const publicClient = getPublicClient();

  const txHash = await client.writeContract({
    address: vault_address as Address,
    abi: VAULT_V2_ABI,
    functionName: "finalize",
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  return JSON.stringify({
    success: receipt.status === "success",
    action: "finalize",
    txHash,
    vault: vault_address,
    explorerUrl: `${EXPLORER_TX}/${txHash}`,
  }, null, 2);
}

