/**
 * OTTOVault Cross-Chain Bridge — Agent-signed Gateway transfer
 *
 * Flow:
 *   1. vault.transfer(agentAddr, amount) on source chain → USDC to agent
 *   2. usdc.approve(gatewayWallet, amount) on source chain
 *   3. gatewayWallet.deposit(usdc, amount) on source chain
 *   4. Agent signs EIP-712 burn intent (viem, not Circle SDK)
 *   5. Submit to Gateway API → attestation
 *   6. gatewayMinter.gatewayMint(attestation, sig) on destination chain
 *   7. usdc.approve(destVault, netAmount) on destination chain
 *   8. destVault.deposit(netAmount) on destination chain
 *
 * Environment: X402_PAYER_PRIVATE_KEY — Agent's EOA private key
 */

import { randomBytes } from "crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  zeroAddress,
  pad,
  erc20Abi,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arcTestnet,
  getChainConfig,
  USDC_ADDRESSES,
  DOMAIN_IDS,
  GATEWAY_WALLET_ADDRESS,
  GATEWAY_MINTER_ADDRESS,
  type SupportedChain,
} from "../lib/circle/gateway-sdk.js";

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const VAULT_TRANSFER_ABI = [
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
] as const;

const VAULT_DEPOSIT_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

const GATEWAY_WALLET_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const GATEWAY_MINTER_ABI = [
  {
    name: "gatewayMint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "attestation", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

// ─── EIP-712 Types for burn intent ──────────────────────────────────────────

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

function addressToBytes32(address: Address): `0x${string}` {
  return pad(address.toLowerCase() as Address, { size: 32 });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAgent() {
  const pk = process.env.X402_PAYER_PRIVATE_KEY;
  if (!pk) throw new Error("X402_PAYER_PRIVATE_KEY is not set.");
  const account = privateKeyToAccount(pk as `0x${string}`);
  return account;
}

function getClients(chain: SupportedChain) {
  const chainConfig = getChainConfig(chain);
  const account = getAgent();
  return {
    account,
    publicClient: createPublicClient({ chain: chainConfig, transport: http() }),
    walletClient: createWalletClient({ account, chain: chainConfig, transport: http() }),
  };
}

function formatUsdc(atomic: bigint): string {
  return (Number(atomic) / 1_000_000).toFixed(2);
}

// ─── Gateway API ──────────────────────────────────────────────────────────────

async function submitBurnIntent(
  burnIntent: Record<string, unknown>,
  signature: `0x${string}`,
): Promise<{ attestation: string; attestationSignature: string; transferId: string }> {
  const payload = [{ burnIntent, signature }];
  const res = await fetch("https://gateway-api-testnet.circle.com/v1/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  if (!res.ok) throw new Error(`Gateway API: ${res.status} — ${await res.text()}`);
  const data = await res.json();
  const r = Array.isArray(data) ? data[0] : data;
  return { attestation: r.attestation, attestationSignature: r.signature, transferId: r.transferId };
}

async function pollAttestation(transferId: string, maxWaitMs = 180_000): Promise<{ attestation: string; signature: string }> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`https://gateway-api-testnet.circle.com/v1/transfers/${transferId}`);
    const json = await res.json() as Record<string, unknown>;
    if (json.attestation && json.signature) {
      return { attestation: json.attestation as string, signature: json.signature as string };
    }
    if (json.status === "FAILED" || json.state === "FAILED") {
      throw new Error(`Transfer failed: ${JSON.stringify(json)}`);
    }
  }
  throw new Error(`Attestation timeout after ${maxWaitMs / 1000}s. Transfer: ${transferId}`);
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export interface VaultBridgeParams {
  source_vault: string;
  source_chain: SupportedChain;
  dest_vault: string;
  dest_chain: SupportedChain;
  amount_usdc: number;
}

export async function handleVaultBridge(params: VaultBridgeParams): Promise<string> {
  const { source_vault, source_chain, dest_vault, dest_chain, amount_usdc } = params;

  if (!source_vault?.startsWith("0x")) throw new Error("source_vault is required");
  if (!dest_vault?.startsWith("0x")) throw new Error("dest_vault is required");
  if (source_chain === dest_chain) throw new Error("Source and destination chains must differ");
  if (!amount_usdc || amount_usdc <= 0) throw new Error("amount_usdc must be positive");
  if (amount_usdc <= 2.01) throw new Error("amount_usdc must be > 2.01 to cover Gateway fees (~1-2 USDC)");

  const amountAtomic = BigInt(Math.round(amount_usdc * 1_000_000));
  const account = getAgent();
  const agentAddr = account.address;
  const log: string[] = [`## Cross-Chain Vault Rebalance`, `**Amount**: ${amount_usdc} USDC`, ``];

  // ── Step 1: Withdraw from source vault ──────────────────────────────────
  log.push(`### Step 1: Withdraw from source vault`);
  const src = getClients(source_chain);
  const withdrawTx = await src.walletClient.writeContract({
    address: source_vault as Address,
    abi: VAULT_TRANSFER_ABI,
    functionName: "transfer",
    args: [agentAddr, amountAtomic],
    account: src.account,
  });
  await src.publicClient.waitForTransactionReceipt({ hash: withdrawTx, timeout: 30_000 });
  log.push(`Vault → Agent: ${formatUsdc(amountAtomic)} USDC (${withdrawTx.slice(0, 10)}...)`);

  // ── Step 2: Approve USDC to Gateway Wallet ──────────────────────────────
  log.push(`### Step 2: Approve USDC to Gateway`);
  const approveSrcTx = await src.walletClient.writeContract({
    address: USDC_ADDRESSES[source_chain] as Address,
    abi: erc20Abi,
    functionName: "approve",
    args: [GATEWAY_WALLET_ADDRESS as Address, amountAtomic],
    account: src.account,
  });
  await src.publicClient.waitForTransactionReceipt({ hash: approveSrcTx, timeout: 30_000 });
  log.push(`Approved (${approveSrcTx.slice(0, 10)}...)`);

  // ── Step 3: Deposit into Gateway Wallet ─────────────────────────────────
  log.push(`### Step 3: Deposit into Gateway`);
  const depositGwTx = await src.walletClient.writeContract({
    address: GATEWAY_WALLET_ADDRESS as Address,
    abi: GATEWAY_WALLET_ABI,
    functionName: "deposit",
    args: [USDC_ADDRESSES[source_chain] as Address, amountAtomic],
    account: src.account,
  });
  await src.publicClient.waitForTransactionReceipt({ hash: depositGwTx, timeout: 30_000 });
  log.push(`Deposited to Gateway (${depositGwTx.slice(0, 10)}...)`);

  // ── Step 4: Sign burn intent ────────────────────────────────────────────
  log.push(`### Step 4: Sign burn intent`);
  const salt = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;

  // Get current block for maxBlockHeight
  const srcBlock = await src.publicClient.getBlockNumber();

  const spec = {
    version: 1,
    sourceDomain: DOMAIN_IDS[source_chain],
    destinationDomain: DOMAIN_IDS[dest_chain],
    sourceContract: addressToBytes32(GATEWAY_WALLET_ADDRESS as Address),
    destinationContract: addressToBytes32(GATEWAY_MINTER_ADDRESS as Address),
    sourceToken: addressToBytes32(USDC_ADDRESSES[source_chain] as Address),
    destinationToken: addressToBytes32(USDC_ADDRESSES[dest_chain] as Address),
    sourceDepositor: addressToBytes32(agentAddr),
    destinationRecipient: addressToBytes32(agentAddr),
    sourceSigner: addressToBytes32(agentAddr),
    destinationCaller: addressToBytes32(zeroAddress),
    value: amountAtomic,
    salt,
    hookData: "0x" as `0x${string}`,
  };

  const burnIntent = {
    maxBlockHeight: maxUint256,
    maxFee: BigInt(2_010_000), // ~2.01 USDC fee cap
    spec,
  };

  const signature = await src.walletClient.signTypedData({
    account: src.account,
    domain: { name: "GatewayWallet", version: "1" },
    types: { TransferSpec, BurnIntent: [
      { name: "maxBlockHeight", type: "uint256" },
      { name: "maxFee", type: "uint256" },
      { name: "spec", type: "TransferSpec" },
    ] },
    primaryType: "BurnIntent",
    message: burnIntent,
  });
  log.push(`Signed burn intent`);

  // ── Step 5: Submit to Gateway API ───────────────────────────────────────
  log.push(`### Step 5: Submit burn intent`);
  const serializedBurnIntent = {
    maxBlockHeight: burnIntent.maxBlockHeight.toString(),
    maxFee: burnIntent.maxFee.toString(),
    spec: {
      ...spec,
      value: spec.value.toString(),
    },
  };

  let attestation: string;
  let attestationSig: string;

  try {
    const result = await submitBurnIntent(serializedBurnIntent, signature);
    if (result.attestation && result.attestationSignature) {
      attestation = result.attestation;
      attestationSig = result.attestationSignature;
    } else {
      log.push(`Waiting for attestation (transfer: ${result.transferId})...`);
      const poll = await pollAttestation(result.transferId);
      attestation = poll.attestation;
      attestationSig = poll.signature;
    }
  } catch (e) {
    throw new Error(`Gateway submit failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  log.push(`Attestation received`);

  // ── Step 6: Mint on destination chain ───────────────────────────────────
  log.push(`### Step 6: Mint on destination chain`);
  const dst = getClients(dest_chain);
  const mintTx = await dst.walletClient.writeContract({
    address: GATEWAY_MINTER_ADDRESS as Address,
    abi: GATEWAY_MINTER_ABI,
    functionName: "gatewayMint",
    args: [attestation as `0x${string}`, attestationSig as `0x${string}`],
    account: dst.account,
  });
  await dst.publicClient.waitForTransactionReceipt({ hash: mintTx, timeout: 60_000 });
  log.push(`Minted on ${dest_chain} (${mintTx.slice(0, 10)}...)`);

  // ── Step 7: Check net amount after fees, deposit into dest vault ────────
  log.push(`### Step 7: Deposit into destination vault`);
  const agentBalanceDst = await dst.publicClient.readContract({
    address: USDC_ADDRESSES[dest_chain] as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [agentAddr],
  }) as bigint;

  // Deposit whatever the agent has on destination (might be less due to fees)
  const depositAmount = agentBalanceDst > amountAtomic ? amountAtomic : agentBalanceDst;

  if (depositAmount > 0n) {
    const approveDestTx = await dst.walletClient.writeContract({
      address: USDC_ADDRESSES[dest_chain] as Address,
      abi: erc20Abi,
      functionName: "approve",
      args: [dest_vault as Address, depositAmount],
      account: dst.account,
    });
    await dst.publicClient.waitForTransactionReceipt({ hash: approveDestTx, timeout: 30_000 });

    const depositVaultTx = await dst.walletClient.writeContract({
      address: dest_vault as Address,
      abi: VAULT_DEPOSIT_ABI,
      functionName: "deposit",
      args: [depositAmount],
      account: dst.account,
    });
    await dst.publicClient.waitForTransactionReceipt({ hash: depositVaultTx, timeout: 30_000 });
    log.push(`Deposited ${formatUsdc(depositAmount)} USDC into vault (${depositVaultTx.slice(0, 10)}...)`);
  } else {
    log.push(`No USDC to deposit (fees consumed entire amount)`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  log.push(``);
  log.push(`### Summary`);
  log.push(`**Source**: ${source_vault} (${source_chain})`);
  log.push(`**Destination**: ${dest_vault} (${dest_chain})`);
  log.push(`**Sent**: ${formatUsdc(amountAtomic)} USDC`);
  log.push(`**Received**: ${formatUsdc(depositAmount)} USDC (after Gateway fees)`);

  return log.join("\n");
}
