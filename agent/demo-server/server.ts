#!/usr/bin/env tsx
/**
 * OTTO Demo Oracle Server
 *
 * A minimal x402-enabled data server for the OTTO hackathon demo.
 * Demonstrates: AI agent autonomously paying for HTTP data feeds in USDC.
 *
 * Paid endpoints (0.001 USDC each, Base Sepolia):
 *   GET /eth-price   — current ETH/USD price
 *   GET /arc-stats   — Arc Testnet live stats
 *
 * Free endpoints:
 *   GET /health      — health check
 *
 * Setup:
 *   1. Add PAYTO_ADDRESS to .env (the address that receives USDC from the agent)
 *   2. npm run demo-server
 *
 * Agent usage (after server is running):
 *   bash skills/arc-x402/scripts/x402_fetch.sh http://localhost:4402/eth-price
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

// ─── Load .env ───────────────────────────────────────────────────────────────

const _ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(_ROOT, ".env"))) {
  for (const line of readFileSync(resolve(_ROOT, ".env"), "utf-8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k && v && !process.env[k]) process.env[k] = v;
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4402);

const PAYTO_ADDRESS = process.env.PAYTO_ADDRESS as `0x${string}` | undefined;
if (!PAYTO_ADDRESS) {
  console.error(
    "\n❌  PAYTO_ADDRESS not set in .env\n" +
      "   This is the address that receives USDC when the agent pays.\n" +
      "   For demo: use your x402 payer wallet address.\n" +
      "   Add to .env:  PAYTO_ADDRESS=0xA9A48d73f67b0c820fDE57c8B0639c6f850Ae96e\n"
  );
  process.exit(1);
}

// Public facilitator from Coinbase — supports Base Sepolia (eip155:84532)
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://www.x402.org/facilitator";
const NETWORK = "eip155:84532"; // Base Sepolia
const PRICE = "$0.001";

// ─── x402 Setup ──────────────────────────────────────────────────────────────

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator).register(
  NETWORK,
  new ExactEvmScheme()
);

// ─── Mock Data ───────────────────────────────────────────────────────────────

function mockEthPrice() {
  const price = parseFloat((2847.42 + (Math.random() - 0.5) * 20).toFixed(2));
  return {
    symbol: "ETH/USD",
    price,
    change24h: parseFloat(((Math.random() - 0.5) * 4).toFixed(2)),
    volume24h: 12_480_000_000,
    source: "OTTO Demo Oracle",
    timestamp: new Date().toISOString(),
  };
}

function mockArcStats() {
  return {
    chain: "Arc Testnet",
    chainId: 5042002,
    blockHeight: 1_250_000 + Math.floor(Math.random() * 1000),
    tps: parseFloat((Math.random() * 50 + 10).toFixed(1)),
    activeWallets: 3_847,
    usdcTvl: parseFloat((Math.random() * 500_000 + 1_200_000).toFixed(2)),
    gatewayDeposits24h: Math.floor(Math.random() * 200 + 50),
    source: "OTTO Demo Oracle",
    timestamp: new Date().toISOString(),
  };
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express();

// Free health check — shows server config without payment
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    server: "OTTO Demo Oracle",
    network: NETWORK,
    price: PRICE,
    payTo: PAYTO_ADDRESS,
    facilitator: FACILITATOR_URL,
    paidEndpoints: {
      "GET /eth-price": `${PRICE} USDC — ETH/USD price feed`,
      "GET /arc-stats": `${PRICE} USDC — Arc Testnet live stats`,
    },
  });
});

// x402 middleware — returns 402 on missing/invalid payment, lets through on valid
app.use(
  paymentMiddleware(
    {
      "GET /eth-price": {
        accepts: {
          scheme: "exact",
          price: PRICE,
          network: NETWORK,
          payTo: PAYTO_ADDRESS,
          maxTimeoutSeconds: 60,
        },
        description: "ETH/USD price feed — OTTO Demo Oracle",
      },
      "GET /arc-stats": {
        accepts: {
          scheme: "exact",
          price: PRICE,
          network: NETWORK,
          payTo: PAYTO_ADDRESS,
          maxTimeoutSeconds: 60,
        },
        description: "Arc Testnet live statistics — OTTO Demo Oracle",
      },
    },
    resourceServer
  )
);

// Paid routes — only reached after valid x402 payment
app.get("/eth-price", (_req, res) => {
  res.json(mockEthPrice());
});

app.get("/arc-stats", (_req, res) => {
  res.json(mockArcStats());
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           OTTO Demo Oracle  —  x402 Paid Data             ║
╠═══════════════════════════════════════════════════════════╣
║  http://localhost:${PORT}                                     ║
║  Network:     Base Sepolia (eip155:84532)                 ║
║  Price:       ${PRICE} USDC per request                    ║
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
