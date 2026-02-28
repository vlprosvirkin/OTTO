#!/usr/bin/env tsx
/**
 * OTTO Demo Oracle Server — entry point.
 * Logic lives in app.ts (exported for tests).
 *
 * Agent usage:
 *   bash skills/arc-x402/scripts/x402_fetch.sh http://localhost:4402/eth-price
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import { createApp } from "./app.js";

// ─── Load .env ───────────────────────────────────────────────────────────────

const _ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k && v && !process.env[k]) process.env[k] = v;
  }
}

loadEnvFile(resolve(_ROOT, ".env"));
loadEnvFile(resolve(_ROOT, "agent", ".env"));

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4402);

// Public address — receives USDC when agent pays for x402 data. Not a secret.
const PAYTO_ADDRESS = (process.env.PAYTO_ADDRESS ?? "0xA9A48d73f67b0c820fDE57c8B0639c6f850Ae96e") as `0x${string}`;
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://www.x402.org/facilitator";
const app = createApp(PAYTO_ADDRESS, FACILITATOR_URL);

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           OTTO Demo Oracle  —  x402 Paid Data             ║
╠═══════════════════════════════════════════════════════════╣
║  http://localhost:${PORT}                                     ║
║  Network:     Base Sepolia (eip155:84532)                 ║
║  Price:       $0.001 USDC per request                     ║
║  Pay To:      ${PAYTO_ADDRESS.slice(0, 22)}...            ║
╠═══════════════════════════════════════════════════════════╣
║  FREE   GET /health                                       ║
║  PAID   GET /eth-price    →  ETH/USD price                ║
║  PAID   GET /arc-stats    →  Arc Testnet stats            ║
╠═══════════════════════════════════════════════════════════╣
║  Agent call:                                              ║
║  bash skills/arc-x402/scripts/x402_fetch.sh \\            ║
║    http://localhost:${PORT}/eth-price                         ║
╚═══════════════════════════════════════════════════════════╝
`);
});
