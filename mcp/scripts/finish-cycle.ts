/**
 * Finish remaining steps: pause/unpause + withdraw from both vaults
 */
import { createPublicClient, createWalletClient, http, erc20Abi, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const GAS_KEY = process.env.GAS_WALLET_PRIVATE_KEY as `0x${string}`;
const gasAccount = privateKeyToAccount(GAS_KEY);

const arcTestnet: Chain = {
  id: 5042002, name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network/c0ca2582063a5bbd5db2f98c139775e982b16919"] } },
  testnet: true,
};

const arcPublic = createPublicClient({ chain: arcTestnet, transport: http() });
const basePublic = createPublicClient({ chain: baseSepolia, transport: http() });
const gasArcWallet = createWalletClient({ account: gasAccount, chain: arcTestnet, transport: http() });
const gasBaseWallet = createWalletClient({ account: gasAccount, chain: baseSepolia, transport: http() });

const V2_VAULT: Address = "0xF7126387a40F5d5644CcE3BAE38f48141E447b6D";
const SAT_VAULT: Address = "0x962AF729Ca2daDA2CB6e83b74a0F4b7E729EC264";

const VAULT_ABI = [
  { name: "status", type: "function", stateMutability: "view", inputs: [],
    outputs: [
      { name: "balance_", type: "uint256" }, { name: "maxPerTx_", type: "uint256" },
      { name: "dailyLimit_", type: "uint256" }, { name: "dailySpent_", type: "uint256" },
      { name: "remainingToday_", type: "uint256" }, { name: "whitelistEnabled_", type: "bool" },
      { name: "paused_", type: "bool" }, { name: "agent_", type: "address" },
      { name: "ceo_", type: "address" },
    ],
  },
  { name: "setPaused", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "_paused", type: "bool" }], outputs: [] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

function fmt(a: bigint): string { return (Number(a) / 1e6).toFixed(6); }

async function waitTx(client: typeof arcPublic, hash: `0x${string}`, label: string) {
  console.log(`  tx: ${hash}`);
  const r = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== "success") throw new Error(`${label} REVERTED`);
  console.log(`  OK ${label}`);
}

async function main() {
  console.log("Finishing cycle...\n");

  // Pause satellite
  console.log("[10] Pause satellite vault...");
  const p = await gasBaseWallet.writeContract({
    address: SAT_VAULT, abi: VAULT_ABI, functionName: "setPaused",
    args: [true], account: gasAccount,
  });
  await waitTx(basePublic, p, "Pause");

  // Unpause satellite
  console.log("  Unpause...");
  const u = await gasBaseWallet.writeContract({
    address: SAT_VAULT, abi: VAULT_ABI, functionName: "setPaused",
    args: [false], account: gasAccount,
  });
  await waitTx(basePublic, u, "Unpause");

  // Withdraw from V2 vault
  console.log("\n[11] Withdraw from V2 vault...");
  const arcSt = await arcPublic.readContract({ address: V2_VAULT, abi: VAULT_ABI, functionName: "status" }) as unknown[];
  const arcBal = arcSt[0] as bigint;
  console.log(`  V2 balance: ${fmt(arcBal)} USDC`);
  if (arcBal > 0n) {
    const w = await gasArcWallet.writeContract({
      address: V2_VAULT, abi: VAULT_ABI, functionName: "withdraw",
      args: [arcBal], account: gasAccount,
    });
    await waitTx(arcPublic, w, `Withdraw ${fmt(arcBal)}`);
  }

  // Withdraw from satellite vault
  console.log("\n  Withdraw from satellite vault...");
  const baseSt = await basePublic.readContract({ address: SAT_VAULT, abi: VAULT_ABI, functionName: "status" }) as unknown[];
  const baseBal = baseSt[0] as bigint;
  console.log(`  Satellite balance: ${fmt(baseBal)} USDC`);
  if (baseBal > 0n) {
    const w = await gasBaseWallet.writeContract({
      address: SAT_VAULT, abi: VAULT_ABI, functionName: "withdraw",
      args: [baseBal], account: gasAccount,
    });
    await waitTx(basePublic, w, `Withdraw ${fmt(baseBal)}`);
  }

  // Final
  console.log("\n[12] Final status...");
  const af = await arcPublic.readContract({ address: V2_VAULT, abi: VAULT_ABI, functionName: "status" }) as unknown[];
  const bf = await basePublic.readContract({ address: SAT_VAULT, abi: VAULT_ABI, functionName: "status" }) as unknown[];
  console.log(`  V2 (Arc):      ${fmt(af[0] as bigint)} USDC, paused=${af[6]}`);
  console.log(`  Satellite (Base): ${fmt(bf[0] as bigint)} USDC, paused=${bf[6]}`);

  console.log("\n=== FULL CYCLE COMPLETE ===");
  console.log(`V2 Vault:      ${V2_VAULT}`);
  console.log(`ShareToken:    0x0e352b501506C03b33601d0dB07024A1Fd9dc967`);
  console.log(`Governor:      0x635d4eAf55b858Cf9b0438fA5B475fC6558Ca2b3`);
  console.log(`Satellite:     ${SAT_VAULT}`);
}

main().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
