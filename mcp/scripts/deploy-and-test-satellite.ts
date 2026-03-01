/**
 * Deploy OTTOSatelliteVault on Base Sepolia via the SatelliteDeployer,
 * then run a full cycle: status → deposit → transfer → ceoTransfer → withdraw → status
 *
 * Uses the same logic as the frontend + MCP tools.
 */

import {
  createPublicClient, createWalletClient, http, encodeFunctionData,
  keccak256, toHex, type Address
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// ─── Config ──────────────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.GAS_WALLET_PRIVATE_KEY as `0x${string}`;
const SATELLITE_DEPLOYER: Address = "0xfF6359409df7B9325179B7624d0e47b59E9261a5";
const USDC_BASE: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const OTTO_AGENT: Address = "0xA9A48d73f67b0c820fDE57c8B0639c6f850Ae96e";
const MAX_PER_TX = BigInt(10_000_000);   // 10 USDC
const DAILY_LIMIT = BigInt(100_000_000); // 100 USDC
const WHITELIST_ENABLED = false;

// ─── ABIs ────────────────────────────────────────────────────────────────────

const DEPLOYER_ABI = [
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

const VAULT_ABI = [
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
  {
    name: "canTransfer", type: "function", stateMutability: "view",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "ok", type: "bool" }, { name: "reason", type: "string" }],
  },
  {
    name: "transfer", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "deposit", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "ceoTransfer", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "withdraw", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "setLimits", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "_maxPerTx", type: "uint256" }, { name: "_dailyLimit", type: "uint256" }],
    outputs: [],
  },
  {
    name: "setPaused", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "_paused", type: "bool" }],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  {
    name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });

function formatUsdc(atomic: bigint): string {
  return (Number(atomic) / 1_000_000).toFixed(6);
}

async function waitTx(hash: `0x${string}`, label: string) {
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`${label} failed!`);
  console.log(`  ✓ ${label} confirmed (block ${receipt.blockNumber})`);
  return receipt;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== OTTOSatelliteVault Deploy + Full Cycle Test ===");
  console.log(`Wallet: ${account.address}`);
  console.log(`Chain: Base Sepolia (84532)`);
  console.log("");

  // 0. Check USDC balance
  const usdcBal = await publicClient.readContract({
    address: USDC_BASE, abi: ERC20_ABI, functionName: "balanceOf",
    args: [account.address],
  }) as bigint;
  console.log(`[0] Wallet USDC balance: ${formatUsdc(usdcBal)} USDC`);
  if (usdcBal < 1_000_000n) {
    console.log("  ✗ Need at least 1 USDC for testing. Aborting.");
    process.exit(1);
  }

  // 1. Compute predicted address
  const salt = keccak256(toHex(account.address.toLowerCase()));
  console.log(`\n[1] Computing predicted vault address (salt: ${salt.slice(0, 10)}...)`);

  const predictedAddr = await publicClient.readContract({
    address: SATELLITE_DEPLOYER, abi: DEPLOYER_ABI, functionName: "computeAddress",
    args: [salt, USDC_BASE, OTTO_AGENT, MAX_PER_TX, DAILY_LIMIT, WHITELIST_ENABLED],
  }) as Address;
  console.log(`  Predicted: ${predictedAddr}`);

  // Check if already deployed
  const existingCode = await publicClient.getCode({ address: predictedAddr });
  let vaultAddr = predictedAddr;

  if (existingCode && existingCode !== "0x" && existingCode.length > 2) {
    console.log("  ↳ Vault already deployed at this address, skipping deploy");
  } else {
    // 2. Deploy
    console.log(`\n[2] Deploying satellite vault...`);
    const deployHash = await walletClient.writeContract({
      address: SATELLITE_DEPLOYER, abi: DEPLOYER_ABI, functionName: "deploy",
      args: [salt, USDC_BASE, OTTO_AGENT, MAX_PER_TX, DAILY_LIMIT, WHITELIST_ENABLED],
      account,
    });
    await waitTx(deployHash, "Deploy");
    console.log(`  Vault deployed at: ${vaultAddr}`);
  }

  // 3. Status check (initial)
  console.log(`\n[3] Status check (initial)...`);
  const status1 = await publicClient.readContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: "status",
  }) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];
  console.log(`  Balance: ${formatUsdc(status1[0])} USDC`);
  console.log(`  MaxPerTx: ${formatUsdc(status1[1])} USDC`);
  console.log(`  DailyLimit: ${formatUsdc(status1[2])} USDC`);
  console.log(`  CEO: ${status1[8]}`);
  console.log(`  Agent: ${status1[7]}`);

  // 4. Deposit 0.5 USDC
  const depositAmount = 500_000n; // 0.5 USDC
  console.log(`\n[4] Depositing ${formatUsdc(depositAmount)} USDC...`);
  const approveHash = await walletClient.writeContract({
    address: USDC_BASE, abi: ERC20_ABI, functionName: "approve",
    args: [vaultAddr, depositAmount], account,
  });
  await waitTx(approveHash, "Approve");
  const depositHash = await walletClient.writeContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: "deposit",
    args: [depositAmount], account,
  });
  await waitTx(depositHash, "Deposit");

  // 5. Status check (after deposit)
  console.log(`\n[5] Status check (after deposit)...`);
  const status2 = await publicClient.readContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: "status",
  }) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];
  console.log(`  Balance: ${formatUsdc(status2[0])} USDC`);

  // 6. canTransfer check
  const transferAmt = 100_000n; // 0.1 USDC
  console.log(`\n[6] canTransfer(${account.address}, ${formatUsdc(transferAmt)})...`);
  const [canDo, reason] = await publicClient.readContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: "canTransfer",
    args: [account.address, transferAmt],
  }) as [boolean, string];
  console.log(`  ok: ${canDo}, reason: "${reason}"`);

  // 7. Agent transfer — only works if wallet IS the agent
  // Our GAS_WALLET is NOT the agent (OTTO_AGENT is). Skip agent transfer, do CEO transfer.
  console.log(`\n[7] CEO Transfer 0.1 USDC to self...`);
  const ceoTxHash = await walletClient.writeContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: "ceoTransfer",
    args: [account.address, transferAmt], account,
  });
  await waitTx(ceoTxHash, "CEO Transfer");

  // 8. Set limits
  console.log(`\n[8] SetLimits (maxPerTx=20 USDC, dailyLimit=200 USDC)...`);
  const limitsHash = await walletClient.writeContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: "setLimits",
    args: [20_000_000n, 200_000_000n], account,
  });
  await waitTx(limitsHash, "SetLimits");

  // 9. Pause + unpause
  console.log(`\n[9] Pause vault...`);
  const pauseHash = await walletClient.writeContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: "setPaused",
    args: [true], account,
  });
  await waitTx(pauseHash, "Pause");

  console.log(`  Unpause vault...`);
  const unpauseHash = await walletClient.writeContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: "setPaused",
    args: [false], account,
  });
  await waitTx(unpauseHash, "Unpause");

  // 10. Withdraw remaining
  console.log(`\n[10] Withdraw remaining USDC...`);
  const status3 = await publicClient.readContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: "status",
  }) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];
  const remaining = status3[0];
  console.log(`  Vault balance: ${formatUsdc(remaining)} USDC`);

  if (remaining > 0n) {
    const withdrawHash = await walletClient.writeContract({
      address: vaultAddr, abi: VAULT_ABI, functionName: "withdraw",
      args: [remaining], account,
    });
    await waitTx(withdrawHash, "Withdraw");
  }

  // 11. Final status
  console.log(`\n[11] Final status...`);
  const statusFinal = await publicClient.readContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: "status",
  }) as [bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];
  console.log(`  Balance: ${formatUsdc(statusFinal[0])} USDC`);
  console.log(`  MaxPerTx: ${formatUsdc(statusFinal[1])} USDC`);
  console.log(`  DailyLimit: ${formatUsdc(statusFinal[2])} USDC`);
  console.log(`  Paused: ${statusFinal[6]}`);

  console.log(`\n=== ✓ Full cycle complete! Vault: ${vaultAddr} ===`);
}

main().catch((err) => {
  console.error("\n✗ FAILED:", err.message || err);
  process.exit(1);
});
