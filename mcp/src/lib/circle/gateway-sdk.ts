/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapted from arc-multichain-wallet for standalone MCP server usage.
 */

import { randomBytes } from "crypto";
import {
  http,
  maxUint256,
  zeroAddress,
  pad,
  createPublicClient,
  erc20Abi,
  type Address,
  type Hash,
  type Chain,
} from "viem";
import * as chains from "viem/chains";
import { circleDeveloperSdk } from "./sdk.js";
import type { Transaction } from "@circle-fin/developer-controlled-wallets";

export const GATEWAY_WALLET_ADDRESS =
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const GATEWAY_MINTER_ADDRESS =
  "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";

const arcRpcKey =
  process.env.ARC_TESTNET_RPC_KEY || "c0ca2582063a5bbd5db2f98c139775e982b16919";

export const arcTestnet: Chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: {
      http: [`https://rpc.testnet.arc.network/${arcRpcKey}`],
    },
  },
  blockExplorers: {
    default: {
      name: "Explorer",
      url: "https://explorer.arc.testnet.circle.com",
    },
  },
  testnet: true,
};

export const USDC_ADDRESSES = {
  arcTestnet: "0x3600000000000000000000000000000000000000",
  avalancheFuji: "0x5425890298aed601595a70ab815c96711a31bc65",
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

export const TOKEN_IDS = {
  arcTestnet: "15dc2b5d-0994-58b0-bf8c-3a0501148ee8",
  sepolia: "d2177333-b33a-5263-b699-2a6a52722214",
} as const;

export const DOMAIN_IDS = {
  avalancheFuji: 1,
  baseSepolia: 6,
  arcTestnet: 26,
} as const;

export type SupportedChain = keyof typeof USDC_ADDRESSES;

export const CIRCLE_CHAIN_NAMES: Record<SupportedChain, string> = {
  avalancheFuji: "AVAX-FUJI",
  baseSepolia: "BASE-SEPOLIA",
  arcTestnet: "ARC-TESTNET",
};

export const CHAIN_BY_DOMAIN: Record<number, SupportedChain> = {
  [DOMAIN_IDS.avalancheFuji]: "avalancheFuji",
  [DOMAIN_IDS.baseSepolia]: "baseSepolia",
  [DOMAIN_IDS.arcTestnet]: "arcTestnet",
};

export function getChainConfig(chain: SupportedChain): Chain {
  switch (chain) {
    case "arcTestnet":
      return arcTestnet;
    case "avalancheFuji":
      return chains.avalancheFuji;
    case "baseSepolia":
      return chains.baseSepolia;
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

// ─── ABIs ────────────────────────────────────────────────────────────────────

const gatewayWalletAbi = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "token", type: "address", internalType: "address" },
      { name: "value", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "initiateWithdrawal",
    inputs: [
      { name: "token", type: "address", internalType: "address" },
      { name: "value", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [{ name: "token", type: "address", internalType: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "addDelegate",
    inputs: [
      { name: "token", type: "address", internalType: "address" },
      { name: "delegate", type: "address", internalType: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// ─── EIP-712 Types ────────────────────────────────────────────────────────────

const EIP712Domain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
] as const;

const TransferSpec = [
  { name: "version", type: "uint32" },
  { name: "sourceDomain", type: "uint32" },
  { name: "destinationDomain", type: "uint32" },
  { name: "sourceContract", type: "bytes32" },
  { name: "destinationContract", type: "bytes32" },
  { name: "sourceToken", type: "bytes32" },
  { name: "destinationToken", type: "bytes32" },
  { name: "sourceDepositor", type: "bytes32" },
  { name: "destinationRecipient", type: "bytes32" },
  { name: "sourceSigner", type: "bytes32" },
  { name: "destinationCaller", type: "bytes32" },
  { name: "value", type: "uint256" },
  { name: "salt", type: "bytes32" },
  { name: "hookData", type: "bytes" },
] as const;

const BurnIntent = [
  { name: "maxBlockHeight", type: "uint256" },
  { name: "maxFee", type: "uint256" },
  { name: "spec", type: "TransferSpec" },
] as const;

function addressToBytes32(address: Address): `0x${string}` {
  return pad(address.toLowerCase() as Address, { size: 32 });
}

interface BurnIntentSpec {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  sourceContract: Address;
  destinationContract: Address;
  sourceToken: Address;
  destinationToken: Address;
  sourceDepositor: Address;
  destinationRecipient: Address;
  sourceSigner: Address;
  destinationCaller: Address;
  value: bigint;
  salt: `0x${string}`;
  hookData: `0x${string}`;
}

interface BurnIntentData {
  maxBlockHeight: bigint;
  maxFee: bigint;
  spec: BurnIntentSpec;
}

function burnIntentTypedData(burnIntent: BurnIntentData) {
  return {
    types: { EIP712Domain, TransferSpec, BurnIntent },
    domain: { name: "GatewayWallet", version: "1" },
    primaryType: "BurnIntent" as const,
    message: {
      ...burnIntent,
      spec: {
        ...burnIntent.spec,
        sourceContract: addressToBytes32(burnIntent.spec.sourceContract),
        destinationContract: addressToBytes32(
          burnIntent.spec.destinationContract
        ),
        sourceToken: addressToBytes32(burnIntent.spec.sourceToken),
        destinationToken: addressToBytes32(burnIntent.spec.destinationToken),
        sourceDepositor: addressToBytes32(burnIntent.spec.sourceDepositor),
        destinationRecipient: addressToBytes32(
          burnIntent.spec.destinationRecipient
        ),
        sourceSigner: addressToBytes32(burnIntent.spec.sourceSigner),
        destinationCaller: addressToBytes32(burnIntent.spec.destinationCaller),
      },
    },
  };
}

// ─── Core Helpers ─────────────────────────────────────────────────────────────

interface ChallengeResponse {
  id: string;
}

export async function waitForTransactionConfirmation(
  challengeId: string
): Promise<string> {
  while (true) {
    const response = await circleDeveloperSdk.getTransaction({
      id: challengeId,
    });
    const tx = response.data?.transaction;

    if (tx?.state === "CONFIRMED" || tx?.state === "COMPLETE") {
      if (!tx.txHash) {
        throw new Error(
          `Transaction ${challengeId} is ${tx.state} but txHash is missing.`
        );
      }
      return tx.txHash;
    } else if (tx?.state === "FAILED") {
      throw new Error(
        `Transaction ${challengeId} failed: ${tx.errorReason ?? "unknown reason"}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function initiateContractInteraction(
  walletId: string,
  contractAddress: Address,
  abiFunctionSignature: string,
  args: unknown[]
): Promise<string> {
  const response = await circleDeveloperSdk.createContractExecutionTransaction({
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters: args,
    fee: {
      type: "level",
      config: { feeLevel: "HIGH" },
    },
  });

  const responseData = response.data as unknown as ChallengeResponse;
  if (!responseData?.id) {
    throw new Error("Circle API did not return a Challenge ID.");
  }

  return responseData.id;
}

// ─── Wallet Address Helpers ───────────────────────────────────────────────────

export async function getCircleWalletAddress(walletId: string): Promise<Address> {
  const response = await circleDeveloperSdk.getWallet({ id: walletId });
  if (!response.data?.wallet?.address) {
    throw new Error(`Could not fetch address for wallet ID: ${walletId}`);
  }
  return response.data.wallet.address as Address;
}

export async function checkWalletGasBalance(
  walletId: string,
  chain: SupportedChain
): Promise<{ hasGas: boolean; address: string; balance: string }> {
  const chainConfig = getChainConfig(chain);
  const walletResponse = await circleDeveloperSdk.getWallet({ id: walletId });
  const walletAddress = walletResponse.data?.wallet?.address as Address;

  if (!walletAddress) {
    throw new Error(`Could not fetch address for wallet ID: ${walletId}`);
  }

  const publicClient = createPublicClient({
    chain: chainConfig,
    transport: http(),
  });

  const balance = await publicClient.getBalance({ address: walletAddress });

  return {
    hasGas: balance > BigInt(0),
    address: walletAddress,
    balance: balance.toString(),
  };
}

// ─── Deposit ─────────────────────────────────────────────────────────────────

export async function initiateDepositFromCustodialWallet(
  walletId: string,
  chain: SupportedChain,
  amountInAtomicUnits: bigint,
  delegateAddress?: Address
): Promise<string> {
  const usdcAddress = USDC_ADDRESSES[chain];
  let lastTxHash: string | undefined;

  if (delegateAddress) {
    const addDelegateChallengeId = await initiateContractInteraction(
      walletId,
      GATEWAY_WALLET_ADDRESS as Address,
      "addDelegate(address,address)",
      [usdcAddress, delegateAddress]
    );
    lastTxHash = await waitForTransactionConfirmation(addDelegateChallengeId);
  }

  if (amountInAtomicUnits > BigInt(0)) {
    const approvalChallengeId = await initiateContractInteraction(
      walletId,
      usdcAddress as Address,
      "approve(address,uint256)",
      [GATEWAY_WALLET_ADDRESS, amountInAtomicUnits.toString()]
    );
    await waitForTransactionConfirmation(approvalChallengeId);

    const depositChallengeId = await initiateContractInteraction(
      walletId,
      GATEWAY_WALLET_ADDRESS as Address,
      "deposit(address,uint256)",
      [usdcAddress, amountInAtomicUnits.toString()]
    );
    const depositTxHash = await waitForTransactionConfirmation(depositChallengeId);
    return depositTxHash;
  }

  if (lastTxHash) return lastTxHash;

  throw new Error("No deposit amount and no delegate provided");
}

export async function withdrawFromCustodialWallet(
  walletId: string,
  chain: SupportedChain,
  amountInAtomicUnits: bigint
): Promise<string> {
  const usdcAddress = USDC_ADDRESSES[chain];

  const initiateWithdrawalChallengeId = await initiateContractInteraction(
    walletId,
    GATEWAY_WALLET_ADDRESS as Address,
    "initiateWithdrawal(address,uint256)",
    [usdcAddress, amountInAtomicUnits.toString()]
  );
  await waitForTransactionConfirmation(initiateWithdrawalChallengeId);

  const withdrawChallengeId = await initiateContractInteraction(
    walletId,
    GATEWAY_WALLET_ADDRESS as Address,
    "withdraw(address)",
    [usdcAddress]
  );
  return await waitForTransactionConfirmation(withdrawChallengeId);
}

// ─── Gateway API ──────────────────────────────────────────────────────────────

export async function submitBurnIntent(
  burnIntent: unknown,
  signature: `0x${string}`
): Promise<{
  attestation: `0x${string}`;
  attestationSignature: `0x${string}`;
  transferId: string;
  fees: unknown;
}> {
  const intentData = burnIntent as BurnIntentData;
  const specRecord = intentData.spec as unknown as Record<string, unknown>;
  const payload = [
    {
      burnIntent: {
        maxBlockHeight: intentData.maxBlockHeight.toString(),
        maxFee: intentData.maxFee.toString(),
        spec: {
          ...specRecord,
          value: intentData.spec.value.toString(),
        },
      },
      signature,
    },
  ];

  const response = await fetch(
    "https://gateway-api-testnet.circle.com/v1/transfer",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gateway API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const result = Array.isArray(data) ? data[0] : data;
  return {
    attestation: result.attestation as `0x${string}`,
    attestationSignature: result.signature as `0x${string}`,
    transferId: result.transferId,
    fees: result.fees,
  };
}

export async function fetchGatewayBalance(address: Address): Promise<{
  token: string;
  balances: Array<{ domain: number; depositor: string; balance: string }>;
}> {
  const sources = [
    { domain: DOMAIN_IDS.arcTestnet, depositor: address },
    { domain: DOMAIN_IDS.avalancheFuji, depositor: address },
    { domain: DOMAIN_IDS.baseSepolia, depositor: address },
  ];

  const response = await fetch(
    "https://gateway-api-testnet.circle.com/v1/balances",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "USDC", sources }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gateway API error: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<{
    token: string;
    balances: Array<{ domain: number; depositor: string; balance: string }>;
  }>;
}

export async function getUsdcBalance(
  address: Address,
  chain: SupportedChain
): Promise<bigint> {
  const publicClient = createPublicClient({
    chain: getChainConfig(chain),
    transport: http(),
  });

  const balance = await publicClient.readContract({
    address: USDC_ADDRESSES[chain] as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });

  return balance as bigint;
}

export async function fetchGatewayInfo(): Promise<{
  version: number;
  domains: Array<{
    chain: string;
    network: string;
    domain: number;
    walletContract: { address: string; supportedTokens: string[] };
    minterContract: { address: string; supportedTokens: string[] };
    processedHeight: string;
    burnIntentExpirationHeight: string;
  }>;
}> {
  const response = await fetch(
    "https://gateway-api-testnet.circle.com/v1/info",
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gateway API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<{
    version: number;
    domains: Array<{
      chain: string;
      network: string;
      domain: number;
      walletContract: { address: string; supportedTokens: string[] };
      minterContract: { address: string; supportedTokens: string[] };
      processedHeight: string;
      burnIntentExpirationHeight: string;
    }>;
  }>;
}

// ─── Signing ──────────────────────────────────────────────────────────────────

async function signBurnIntentCircle(
  walletId: string,
  burnIntentData: BurnIntentData
): Promise<`0x${string}`> {
  const typedData = burnIntentTypedData(burnIntentData);
  const serializedData = JSON.stringify(typedData, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  );

  const response = await circleDeveloperSdk.signTypedData({
    walletId,
    data: serializedData,
  });

  if (!response.data?.signature) {
    throw new Error("Failed to retrieve signature from Circle API.");
  }

  return response.data.signature as `0x${string}`;
}

async function signBurnIntentWithEOA(
  burnIntentData: BurnIntentData,
  sourceChain: SupportedChain,
  userId: string
): Promise<`0x${string}`> {
  const { getGatewayEOAWalletId } = await import(
    "./create-gateway-eoa-wallets.js"
  );
  const chainMap: Record<SupportedChain, string> = {
    baseSepolia: "BASE-SEPOLIA",
    avalancheFuji: "AVAX-FUJI",
    arcTestnet: "ARC-TESTNET",
  };
  const { walletId } = await getGatewayEOAWalletId(
    userId,
    chainMap[sourceChain]
  );

  const typedData = burnIntentTypedData(burnIntentData);
  const serializeBigInt = (obj: unknown): unknown => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === "bigint") return obj.toString();
    if (Array.isArray(obj)) return obj.map(serializeBigInt);
    if (typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const key in obj as Record<string, unknown>) {
        result[key] = serializeBigInt((obj as Record<string, unknown>)[key]);
      }
      return result;
    }
    return obj;
  };

  const response = await circleDeveloperSdk.signTypedData({
    walletId,
    data: JSON.stringify(serializeBigInt(typedData)),
  });

  if (!response.data?.signature) {
    throw new Error("Failed to sign burn intent with Circle SDK");
  }

  return response.data.signature as `0x${string}`;
}

// ─── Mint ─────────────────────────────────────────────────────────────────────

async function getSignerWalletIdForUser(
  userId: string,
  chain: SupportedChain
): Promise<{ walletId: string; address: string }> {
  const { getGatewayEOAWalletId } = await import(
    "./create-gateway-eoa-wallets.js"
  );
  const chainMap: Record<SupportedChain, string> = {
    baseSepolia: "BASE-SEPOLIA",
    avalancheFuji: "AVAX-FUJI",
    arcTestnet: "ARC-TESTNET",
  };
  return await getGatewayEOAWalletId(userId, chainMap[chain]);
}

export async function executeMintCircle(
  walletIdOrUserId: string,
  destinationChain: SupportedChain,
  attestation: string,
  signature: string,
  isUserId: boolean = false
): Promise<Transaction> {
  const blockchain = CIRCLE_CHAIN_NAMES[destinationChain];
  if (!blockchain) {
    throw new Error(`No Circle blockchain mapping for ${destinationChain}`);
  }

  let walletId: string;
  if (isUserId) {
    const result = await getSignerWalletIdForUser(walletIdOrUserId, destinationChain);
    walletId = result.walletId;
  } else {
    walletId = walletIdOrUserId;
  }

  const response = await circleDeveloperSdk.createContractExecutionTransaction({
    walletId,
    contractAddress: GATEWAY_MINTER_ADDRESS,
    abiFunctionSignature: "gatewayMint(bytes,bytes)",
    abiParameters: [attestation, signature],
    fee: {
      type: "level",
      config: { feeLevel: "MEDIUM" },
    },
  });

  const challengeId = response.data?.id;
  if (!challengeId) throw new Error("Failed to initiate minting challenge");

  const txHash = await waitForTransactionConfirmation(challengeId);

  const tx = await circleDeveloperSdk.getTransaction({ id: challengeId });
  if (!tx?.data?.transaction) {
    throw new Error(`Failed to fetch transaction ${challengeId}`);
  }

  const transaction = tx.data.transaction;
  if (!transaction.txHash) {
    transaction.txHash = txHash;
  }

  return transaction;
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

export async function transferGatewayBalanceWithEOA(
  userId: string,
  amount: bigint,
  sourceChain: SupportedChain,
  destinationChain: SupportedChain,
  recipientAddress: Address,
  depositorAddress: Address
): Promise<{
  transferId: string;
  attestation: `0x${string}`;
  attestationSignature: `0x${string}`;
}> {
  const { address } = await getSignerWalletIdForUser(userId, sourceChain);
  const eoaSignerAddress = address as Address;

  const sourceDomain = DOMAIN_IDS[sourceChain];
  const destinationDomain = DOMAIN_IDS[destinationChain];

  if (sourceDomain === undefined || destinationDomain === undefined) {
    throw new Error(
      `Invalid chain configuration: source=${sourceChain}, destination=${destinationChain}`
    );
  }

  const burnIntentData: BurnIntentData = {
    maxBlockHeight: maxUint256,
    maxFee: BigInt(2_010_000),
    spec: {
      version: 1,
      sourceDomain,
      destinationDomain,
      sourceContract: GATEWAY_WALLET_ADDRESS as Address,
      destinationContract: GATEWAY_MINTER_ADDRESS as Address,
      sourceToken: USDC_ADDRESSES[sourceChain] as Address,
      destinationToken: USDC_ADDRESSES[destinationChain] as Address,
      sourceDepositor: depositorAddress,
      destinationRecipient: recipientAddress,
      sourceSigner: eoaSignerAddress,
      destinationCaller: zeroAddress,
      value: amount,
      salt: `0x${randomBytes(32).toString("hex")}` as `0x${string}`,
      hookData: "0x" as `0x${string}`,
    },
  };

  const signature = await signBurnIntentWithEOA(
    burnIntentData,
    sourceChain,
    userId
  );
  const typedData = burnIntentTypedData(burnIntentData);
  const { attestation, attestationSignature, transferId } =
    await submitBurnIntent(typedData.message, signature);

  let finalAttestation = attestation;
  let finalSignature = attestationSignature;

  if (!finalAttestation || !finalSignature) {
    let attempts = 0;
    const maxAttempts = 60;
    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollResponse = await fetch(
        `https://gateway-api-testnet.circle.com/v1/transfers/${transferId}`
      );
      const pollJson = await pollResponse.json() as Record<string, unknown>;
      const status = pollJson["status"] || pollJson["state"];

      if (pollJson["attestation"] && pollJson["signature"]) {
        finalAttestation = pollJson["attestation"] as `0x${string}`;
        finalSignature = pollJson["signature"] as `0x${string}`;
        break;
      } else if (status === "FAILED") {
        throw new Error(`Transfer failed: ${JSON.stringify(pollJson)}`);
      }
      attempts++;
    }

    if (!finalAttestation || !finalSignature) {
      throw new Error(
        `Attestation not received after ${maxAttempts} attempts. Transfer ID: ${transferId}`
      );
    }
  }

  return {
    transferId,
    attestation: finalAttestation as `0x${string}`,
    attestationSignature: finalSignature as `0x${string}`,
  };
}

export async function transferUnifiedBalanceCircle(
  walletId: string,
  amount: bigint,
  sourceChain: SupportedChain,
  destinationChain: SupportedChain,
  recipientAddress?: Address
): Promise<{
  burnTxHash: Hash;
  attestation: `0x${string}`;
  mintTxHash: Hash;
}> {
  const walletAddress = await getCircleWalletAddress(walletId);
  const recipient = recipientAddress || walletAddress;

  const burnIntentData: BurnIntentData = {
    maxBlockHeight: maxUint256,
    maxFee: BigInt(1_010_000),
    spec: {
      version: 1,
      sourceDomain: DOMAIN_IDS[sourceChain],
      destinationDomain: DOMAIN_IDS[destinationChain],
      sourceContract: GATEWAY_WALLET_ADDRESS as Address,
      destinationContract: GATEWAY_MINTER_ADDRESS as Address,
      sourceToken: USDC_ADDRESSES[sourceChain] as Address,
      destinationToken: USDC_ADDRESSES[destinationChain] as Address,
      sourceDepositor: walletAddress,
      destinationRecipient: recipient,
      sourceSigner: walletAddress,
      destinationCaller: zeroAddress,
      value: amount,
      salt: `0x${randomBytes(32).toString("hex")}` as `0x${string}`,
      hookData: "0x" as `0x${string}`,
    },
  };

  const signature = await signBurnIntentCircle(walletId, burnIntentData);
  const typedData = burnIntentTypedData(burnIntentData);
  const { attestation, attestationSignature, transferId } =
    await submitBurnIntent(typedData.message, signature);

  let finalAttestation = attestation;
  let finalSignature = attestationSignature;

  if (!finalAttestation || !finalSignature) {
    while (true) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollResponse = await fetch(
        `https://gateway-api-testnet.circle.com/v1/transfers/${transferId}`
      );
      const pollJson = await pollResponse.json() as Record<string, unknown>;
      const status = pollJson["status"] || pollJson["state"];

      if (pollJson["attestation"] && pollJson["signature"]) {
        finalAttestation = pollJson["attestation"] as `0x${string}`;
        finalSignature = pollJson["signature"] as `0x${string}`;
        break;
      } else if (status === "FAILED") {
        throw new Error(
          `Transfer failed on Gateway: ${JSON.stringify(pollJson)}`
        );
      }
    }
  }

  const mintTx = await executeMintCircle(
    walletId,
    destinationChain,
    finalAttestation,
    finalSignature
  );

  return {
    burnTxHash: "0x" as Hash,
    attestation: finalAttestation,
    mintTxHash: mintTx.txHash as Hash,
  };
}
