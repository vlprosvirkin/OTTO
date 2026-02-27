#!/usr/bin/env tsx
/**
 * Setup script: Generate or display the x402 payer wallet for the AI agent.
 *
 * The x402 payer wallet is a standard EVM wallet that the agent uses to
 * autonomously pay for x402-enabled HTTP services (oracle feeds, AI APIs, etc.)
 * using USDC — without gas, via Circle Gateway offchain settlement.
 *
 * Usage:
 *   tsx scripts/setup_x402_payer.ts            # Generate a new wallet
 *   tsx scripts/setup_x402_payer.ts --show     # Show current wallet address
 *   tsx scripts/setup_x402_payer.ts --balance  # Show USDC balances
 *
 * After running, add X402_PAYER_PRIVATE_KEY to your .env file,
 * then fund the wallet with testnet USDC from the Circle faucet.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../.env");
const ENV_EXAMPLE_PATH = resolve(__dirname, "../.env.example");

// ─── Chain config (matches gateway-sdk.ts) ───────────────────────────────────

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: {
      http: [`https://rpc.testnet.arc.network/${process.env.ARC_TESTNET_RPC_KEY || "c0ca2582063a5bbd5db2f98c139775e982b16919"}`],
    },
  },
  testnet: true,
} as const;

const avalancheFuji = {
  id: 43113,
  name: "Avalanche Fuji",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.avax-test.network/ext/bc/C/rpc"] } },
  testnet: true,
} as const;

const CHAINS = { arcTestnet, baseSepolia, avalancheFuji } as const;

const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  arcTestnet: "0x3600000000000000000000000000000000000000",
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  avalancheFuji: "0x5425890298aed601595a70ab815c96711a31bc65",
};

const BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
  const result: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function writeEnvKey(key: string, value: string) {
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8") : "";

  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n\n# x402 Agent Payer Wallet\n${key}=${value}\n`;
  }

  writeFileSync(ENV_PATH, content);
  console.log(`✓ Written to ${ENV_PATH}`);
}

async function getBalances(address: `0x${string}`) {
  const results: Record<string, string> = {};
  await Promise.allSettled(
    Object.entries(CHAINS).map(async ([name, chain]) => {
      try {
        const client = createPublicClient({ chain: chain as typeof baseSepolia, transport: http() });
        const raw = await client.readContract({
          address: USDC_ADDRESSES[name],
          abi: BALANCE_ABI,
          functionName: "balanceOf",
          args: [address],
        });
        results[name] = `${(Number(raw) / 1e6).toFixed(6)} USDC`;
      } catch {
        results[name] = "unavailable";
      }
    })
  );
  return results;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function generateWallet() {
  const env = readEnv();

  if (env.X402_PAYER_PRIVATE_KEY) {
    const account = privateKeyToAccount(env.X402_PAYER_PRIVATE_KEY as `0x${string}`);
    console.log("\n⚠️  X402_PAYER_PRIVATE_KEY already set in .env");
    console.log(`   Address: ${account.address}`);
    console.log("\nRun with --show to display details, or --balance for USDC balances.");
    console.log("To regenerate, remove X402_PAYER_PRIVATE_KEY from .env first.\n");
    return;
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  console.log("\n🔑  New x402 payer wallet generated");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`   Address:     ${account.address}`);
  console.log(`   Private Key: ${privateKey}`);
  console.log("═══════════════════════════════════════════════════════════");

  writeEnvKey("X402_PAYER_PRIVATE_KEY", privateKey);

  console.log(`
📋  Next steps:

  1. Fund the wallet with testnet USDC:
     - Arc Testnet faucet:    https://faucet.circle.com (select Arc Testnet)
     - Base Sepolia faucet:   https://faucet.circle.com (select Base Sepolia)

  2. The agent wallet address to fund:
     ${account.address}

  3. Verify the setup:
     tsx scripts/setup_x402_payer.ts --balance

  4. Ready to use x402_fetch in OpenClaw to autonomously pay for services!
`);
}

async function showWallet() {
  const env = readEnv();
  const privateKey = env.X402_PAYER_PRIVATE_KEY;

  if (!privateKey) {
    console.error("\n❌  X402_PAYER_PRIVATE_KEY not found in .env");
    console.error("   Run: tsx scripts/setup_x402_payer.ts\n");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  console.log("\n🤖  x402 Agent Payer Wallet");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`   Address: ${account.address}`);
  console.log("   Networks: Arc Testnet · Base Sepolia · Avalanche Fuji");
  console.log("═══════════════════════════════════════════════════════════\n");
}

async function showBalances() {
  const env = readEnv();
  const privateKey = env.X402_PAYER_PRIVATE_KEY;

  if (!privateKey) {
    console.error("\n❌  X402_PAYER_PRIVATE_KEY not found in .env");
    console.error("   Run: tsx scripts/setup_x402_payer.ts\n");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  console.log(`\n🔍  Fetching USDC balances for ${account.address}...\n`);

  const balances = await getBalances(account.address);

  console.log("   Chain              USDC Balance");
  console.log("   ─────────────────────────────────────");
  for (const [chain, balance] of Object.entries(balances)) {
    const label = chain.padEnd(18);
    const funded = balance !== "0.000000 USDC" && balance !== "unavailable";
    const icon = balance === "unavailable" ? "⚠️ " : funded ? "✅" : "⭕";
    console.log(`   ${icon} ${label} ${balance}`);
  }

  console.log("\n   Fund at: https://faucet.circle.com");
  console.log(`   Address: ${account.address}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];

  if (arg === "--show") {
    await showWallet();
  } else if (arg === "--balance") {
    await showBalances();
  } else {
    await generateWallet();
  }
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
