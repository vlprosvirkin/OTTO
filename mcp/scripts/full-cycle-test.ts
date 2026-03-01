/**
 * Full Cycle Test: Deploy V2 Vault + Satellite Vault, move liquidity
 *
 * 1. Fund GAS_WALLET with USDC from X402_AGENT
 * 2. Deploy V2 vault on Arc Testnet via factory
 * 3. Deploy satellite vault on Base Sepolia via deployer
 * 4. Deposit, transfer, CEO ops on both
 *
 * Env: X402_PAYER_PRIVATE_KEY, GAS_WALLET_PRIVATE_KEY
 */

import {
  createPublicClient, createWalletClient, http, erc20Abi,
  keccak256, toHex, type Address, type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// ─── Keys ────────────────────────────────────────────────────────────────────

const X402_KEY = process.env.X402_PAYER_PRIVATE_KEY as `0x${string}`;
const GAS_KEY = process.env.GAS_WALLET_PRIVATE_KEY as `0x${string}`;
if (!X402_KEY || !GAS_KEY) {
  console.error("Set X402_PAYER_PRIVATE_KEY and GAS_WALLET_PRIVATE_KEY");
  process.exit(1);
}

const x402Account = privateKeyToAccount(X402_KEY);
const gasAccount = privateKeyToAccount(GAS_KEY);

console.log(`X402 Agent: ${x402Account.address}`);
console.log(`GAS Wallet: ${gasAccount.address}`);

// ─── Chain configs ──────────────────────────────────────────────────────────

const arcTestnet: Chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network/c0ca2582063a5bbd5db2f98c139775e982b16919"] } },
  blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
  testnet: true,
};

const USDC_ARC: Address = "0x3600000000000000000000000000000000000000";
const USDC_BASE: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const FACTORY: Address = "0x9edebee1DfEd0E2727A1Ec64cbB4814A3AEaceCe";
const SAT_DEPLOYER: Address = "0xfF6359409df7B9325179B7624d0e47b59E9261a5";

// ─── Clients ────────────────────────────────────────────────────────────────

const arcPublic = createPublicClient({ chain: arcTestnet, transport: http() });
const basePublic = createPublicClient({ chain: baseSepolia, transport: http() });

const x402ArcWallet = createWalletClient({ account: x402Account, chain: arcTestnet, transport: http() });
const x402BaseWallet = createWalletClient({ account: x402Account, chain: baseSepolia, transport: http() });
const gasArcWallet = createWalletClient({ account: gasAccount, chain: arcTestnet, transport: http() });
const gasBaseWallet = createWalletClient({ account: gasAccount, chain: baseSepolia, transport: http() });

// ─── ABIs ───────────────────────────────────────────────────────────────────

const FACTORY_ABI = [
  {
    name: "deploy", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "salt", type: "bytes32" }, { name: "usdc", type: "address" },
      { name: "agent", type: "address" }, { name: "maxPerTx", type: "uint256" },
      { name: "dailyLimit", type: "uint256" }, { name: "whitelistEnabled", type: "bool" },
      { name: "shareholders", type: "address[]" }, { name: "sharesBps", type: "uint256[]" },
    ],
    outputs: [
      { name: "vault", type: "address" }, { name: "token", type: "address" },
      { name: "gov", type: "address" },
    ],
  },
  {
    name: "computeAddress", type: "function", stateMutability: "view",
    inputs: [
      { name: "salt", type: "bytes32" }, { name: "agent", type: "address" },
      { name: "maxPerTx", type: "uint256" }, { name: "dailyLimit", type: "uint256" },
      { name: "whitelistEnabled", type: "bool" },
      { name: "shareholders", type: "address[]" }, { name: "sharesBps", type: "uint256[]" },
    ],
    outputs: [
      { name: "vault", type: "address" }, { name: "token", type: "address" },
      { name: "gov", type: "address" },
    ],
  },
] as const;

const SAT_DEPLOYER_ABI = [
  {
    name: "deploy", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "salt", type: "bytes32" }, { name: "usdc", type: "address" },
      { name: "agent", type: "address" }, { name: "maxPerTx", type: "uint256" },
      { name: "dailyLimit", type: "uint256" }, { name: "whitelistEnabled", type: "bool" },
    ],
    outputs: [{ name: "vault", type: "address" }],
  },
  {
    name: "computeAddress", type: "function", stateMutability: "view",
    inputs: [
      { name: "salt", type: "bytes32" }, { name: "usdc", type: "address" },
      { name: "agent", type: "address" }, { name: "maxPerTx", type: "uint256" },
      { name: "dailyLimit", type: "uint256" }, { name: "whitelistEnabled", type: "bool" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const VAULT_STATUS_ABI = [
  {
    name: "status", type: "function", stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "balance_", type: "uint256" }, { name: "maxPerTx_", type: "uint256" },
      { name: "dailyLimit_", type: "uint256" }, { name: "dailySpent_", type: "uint256" },
      { name: "remainingToday_", type: "uint256" }, { name: "whitelistEnabled_", type: "bool" },
      { name: "paused_", type: "bool" }, { name: "agent_", type: "address" },
      { name: "ceo_", type: "address" },
    ],
  },
] as const;

const VAULT_OPS_ABI = [
  {
    name: "deposit", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [],
  },
  {
    name: "transfer", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [],
  },
  {
    name: "ceoTransfer", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [],
  },
  {
    name: "withdraw", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [],
  },
  {
    name: "setLimits", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "_maxPerTx", type: "uint256" }, { name: "_dailyLimit", type: "uint256" }], outputs: [],
  },
  {
    name: "setPaused", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "_paused", type: "bool" }], outputs: [],
  },
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(atomic: bigint): string { return (Number(atomic) / 1e6).toFixed(6); }

async function waitTx(client: typeof arcPublic, hash: `0x${string}`, label: string) {
  console.log(`  tx: ${hash}`);
  const r = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== "success") throw new Error(`${label} REVERTED`);
  console.log(`  OK ${label} (block ${r.blockNumber})`);
  return r;
}

// ─── Params ─────────────────────────────────────────────────────────────────

const AGENT = x402Account.address; // OTTO agent = X402 payer
const MAX_PER_TX = BigInt(10_000_000);   // 10 USDC
const DAILY_LIMIT = BigInt(100_000_000); // 100 USDC
const WHITELIST = false;
const salt = keccak256(toHex(gasAccount.address.toLowerCase()));

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  OTTO Full Cycle Test: V2 Vault + Satellite Vault");
  console.log("════════════════════════════════════════════════════════════\n");

  // ── Step 1: Check & fund GAS wallet ─────────────────────────────────────

  console.log("[1] Checking balances...");
  const gasArcUsdc = await arcPublic.readContract({
    address: USDC_ARC, abi: erc20Abi, functionName: "balanceOf", args: [gasAccount.address],
  });
  const gasBaseUsdc = await basePublic.readContract({
    address: USDC_BASE, abi: erc20Abi, functionName: "balanceOf", args: [gasAccount.address],
  });
  console.log(`  GAS wallet Arc USDC: ${fmt(gasArcUsdc)}`);
  console.log(`  GAS wallet Base USDC: ${fmt(gasBaseUsdc)}`);

  const FUND_AMOUNT = BigInt(2_000_000); // 2 USDC

  if (gasArcUsdc < FUND_AMOUNT) {
    console.log("\n[1a] Funding GAS wallet on Arc Testnet (2 USDC from X402)...");
    const h = await x402ArcWallet.writeContract({
      address: USDC_ARC, abi: erc20Abi, functionName: "transfer",
      args: [gasAccount.address, FUND_AMOUNT], account: x402Account,
    });
    await waitTx(arcPublic, h, "Fund Arc");
  }

  if (gasBaseUsdc < FUND_AMOUNT) {
    console.log("\n[1b] Funding GAS wallet on Base Sepolia (2 USDC from X402)...");
    const h = await x402BaseWallet.writeContract({
      address: USDC_BASE, abi: erc20Abi, functionName: "transfer",
      args: [gasAccount.address, FUND_AMOUNT], account: x402Account,
    });
    await waitTx(basePublic, h, "Fund Base");
  }

  // ── Step 2: Deploy V2 vault on Arc ────────────────────────────────────────

  console.log("\n[2] V2 Vault on Arc Testnet...");

  // Compute predicted address
  const [predictedVault, predictedToken, predictedGov] = await arcPublic.readContract({
    address: FACTORY, abi: FACTORY_ABI, functionName: "computeAddress",
    args: [salt, AGENT, MAX_PER_TX, DAILY_LIMIT, WHITELIST,
      [gasAccount.address], [BigInt(10000)]],
  }) as [Address, Address, Address];
  console.log(`  Predicted vault: ${predictedVault}`);

  const existingCode = await arcPublic.getCode({ address: predictedVault });
  let v2Vault = predictedVault;
  let v2Token = predictedToken;
  let v2Gov = predictedGov;

  if (existingCode && existingCode !== "0x" && existingCode.length > 2) {
    console.log("  Already deployed, skipping");
  } else {
    console.log("  Deploying via factory...");
    const h = await gasArcWallet.writeContract({
      address: FACTORY, abi: FACTORY_ABI, functionName: "deploy",
      args: [salt, USDC_ARC, AGENT, MAX_PER_TX, DAILY_LIMIT, WHITELIST,
        [gasAccount.address], [BigInt(10000)]],
      account: gasAccount, gas: BigInt(8_000_000),
    });
    await waitTx(arcPublic, h, "Factory Deploy");
    console.log(`  V2 Vault: ${v2Vault}`);
    console.log(`  ShareToken: ${v2Token}`);
    console.log(`  Governor: ${v2Gov}`);
  }

  // ── Step 3: Deploy satellite vault on Base Sepolia ────────────────────────

  console.log("\n[3] Satellite Vault on Base Sepolia...");

  const predictedSat = await basePublic.readContract({
    address: SAT_DEPLOYER, abi: SAT_DEPLOYER_ABI, functionName: "computeAddress",
    args: [salt, USDC_BASE, AGENT, MAX_PER_TX, DAILY_LIMIT, WHITELIST],
  }) as Address;
  console.log(`  Predicted satellite: ${predictedSat}`);

  const satCode = await basePublic.getCode({ address: predictedSat });
  let satVault = predictedSat;

  if (satCode && satCode !== "0x" && satCode.length > 2) {
    console.log("  Already deployed, skipping");
  } else {
    console.log("  Deploying via satellite deployer...");
    const h = await gasBaseWallet.writeContract({
      address: SAT_DEPLOYER, abi: SAT_DEPLOYER_ABI, functionName: "deploy",
      args: [salt, USDC_BASE, AGENT, MAX_PER_TX, DAILY_LIMIT, WHITELIST],
      account: gasAccount, gas: BigInt(3_000_000),
    });
    await waitTx(basePublic, h, "Satellite Deploy");
    console.log(`  Satellite Vault: ${satVault}`);
  }

  // ── Step 4: Deposit into V2 vault on Arc ──────────────────────────────────

  const DEPOSIT = BigInt(1_000_000); // 1 USDC

  console.log("\n[4] Deposit 1 USDC into V2 vault on Arc...");
  const approveArc = await gasArcWallet.writeContract({
    address: USDC_ARC, abi: erc20Abi, functionName: "approve",
    args: [v2Vault, DEPOSIT], account: gasAccount,
  });
  await waitTx(arcPublic, approveArc, "Approve Arc");
  const depArc = await gasArcWallet.writeContract({
    address: v2Vault, abi: VAULT_OPS_ABI, functionName: "deposit",
    args: [DEPOSIT], account: gasAccount,
  });
  await waitTx(arcPublic, depArc, "Deposit Arc");

  // ── Step 5: Deposit into satellite vault on Base ──────────────────────────

  console.log("\n[5] Deposit 1 USDC into satellite vault on Base...");
  const approveBase = await gasBaseWallet.writeContract({
    address: USDC_BASE, abi: erc20Abi, functionName: "approve",
    args: [satVault, DEPOSIT], account: gasAccount,
  });
  await waitTx(basePublic, approveBase, "Approve Base");
  const depBase = await gasBaseWallet.writeContract({
    address: satVault, abi: VAULT_OPS_ABI, functionName: "deposit",
    args: [DEPOSIT], account: gasAccount,
  });
  await waitTx(basePublic, depBase, "Deposit Base");

  // ── Step 6: Status check both vaults ──────────────────────────────────────

  console.log("\n[6] Status check...");

  // V2 vault has 12-field status, but we only defined 9-field ABI here
  // Just read the satellite-style 9 fields (V2 also starts with the same 9)
  const arcStatus = await arcPublic.readContract({
    address: v2Vault, abi: VAULT_STATUS_ABI, functionName: "status",
  }) as unknown[];
  console.log(`  V2 Vault (Arc):  Balance=${fmt(arcStatus[0] as bigint)} USDC, CEO=${arcStatus[8]}`);

  const baseStatus = await basePublic.readContract({
    address: satVault, abi: VAULT_STATUS_ABI, functionName: "status",
  }) as unknown[];
  console.log(`  Satellite (Base): Balance=${fmt(baseStatus[0] as bigint)} USDC, CEO=${baseStatus[8]}`);

  // ── Step 7: CEO transfer from V2 vault ────────────────────────────────────

  const XFER = BigInt(200_000); // 0.2 USDC
  console.log("\n[7] CEO Transfer 0.2 USDC from V2 vault to GAS wallet...");
  const ceoTx = await gasArcWallet.writeContract({
    address: v2Vault, abi: VAULT_OPS_ABI, functionName: "ceoTransfer",
    args: [gasAccount.address, XFER], account: gasAccount,
  });
  await waitTx(arcPublic, ceoTx, "CEO Transfer Arc");

  // ── Step 8: CEO transfer from satellite vault ─────────────────────────────

  console.log("\n[8] CEO Transfer 0.2 USDC from satellite vault to GAS wallet...");
  const satCeoTx = await gasBaseWallet.writeContract({
    address: satVault, abi: VAULT_OPS_ABI, functionName: "ceoTransfer",
    args: [gasAccount.address, XFER], account: gasAccount,
  });
  await waitTx(basePublic, satCeoTx, "CEO Transfer Base");

  // ── Step 9: Set limits on satellite ───────────────────────────────────────

  console.log("\n[9] SetLimits on satellite (20/200 USDC)...");
  const limTx = await gasBaseWallet.writeContract({
    address: satVault, abi: VAULT_OPS_ABI, functionName: "setLimits",
    args: [BigInt(20_000_000), BigInt(200_000_000)], account: gasAccount,
  });
  await waitTx(basePublic, limTx, "SetLimits Base");

  // ── Step 10: Pause + unpause satellite ────────────────────────────────────

  console.log("\n[10] Pause/unpause satellite vault...");
  const pauseTx = await gasBaseWallet.writeContract({
    address: satVault, abi: VAULT_OPS_ABI, functionName: "setPaused",
    args: [true], account: gasAccount,
  });
  await waitTx(basePublic, pauseTx, "Pause");
  const unpauseTx = await gasBaseWallet.writeContract({
    address: satVault, abi: VAULT_OPS_ABI, functionName: "setPaused",
    args: [false], account: gasAccount,
  });
  await waitTx(basePublic, unpauseTx, "Unpause");

  // ── Step 11: Withdraw remaining from both vaults ──────────────────────────

  console.log("\n[11] Withdraw remaining from both vaults...");

  const arcStatus2 = await arcPublic.readContract({
    address: v2Vault, abi: VAULT_STATUS_ABI, functionName: "status",
  }) as unknown[];
  const arcBal = arcStatus2[0] as bigint;
  if (arcBal > 0n) {
    const wTx = await gasArcWallet.writeContract({
      address: v2Vault, abi: VAULT_OPS_ABI, functionName: "withdraw",
      args: [arcBal], account: gasAccount,
    });
    await waitTx(arcPublic, wTx, `Withdraw ${fmt(arcBal)} from Arc`);
  }

  const baseStatus2 = await basePublic.readContract({
    address: satVault, abi: VAULT_STATUS_ABI, functionName: "status",
  }) as unknown[];
  const baseBal = baseStatus2[0] as bigint;
  if (baseBal > 0n) {
    const wTx = await gasBaseWallet.writeContract({
      address: satVault, abi: VAULT_OPS_ABI, functionName: "withdraw",
      args: [baseBal], account: gasAccount,
    });
    await waitTx(basePublic, wTx, `Withdraw ${fmt(baseBal)} from Base`);
  }

  // ── Step 12: Final status ─────────────────────────────────────────────────

  console.log("\n[12] Final status...");
  const arcFinal = await arcPublic.readContract({
    address: v2Vault, abi: VAULT_STATUS_ABI, functionName: "status",
  }) as unknown[];
  const baseFinal = await basePublic.readContract({
    address: satVault, abi: VAULT_STATUS_ABI, functionName: "status",
  }) as unknown[];
  console.log(`  V2 Vault (Arc):   ${fmt(arcFinal[0] as bigint)} USDC`);
  console.log(`  Satellite (Base): ${fmt(baseFinal[0] as bigint)} USDC`);

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  FULL CYCLE COMPLETE");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  V2 Vault (Arc):      ${v2Vault}`);
  console.log(`  ShareToken:          ${v2Token}`);
  console.log(`  Governor:            ${v2Gov}`);
  console.log(`  Satellite (Base):    ${satVault}`);
  console.log(`  Agent:               ${AGENT}`);
  console.log(`  CEO (deployer):      ${gasAccount.address}`);
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message || err);
  process.exit(1);
});
