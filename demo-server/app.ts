/**
 * OTTO Demo Oracle — Express app factory.
 * Separated from server.ts so the app can be imported in tests without starting a listener.
 */

import express, { type RequestHandler } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

// ─── Mock Data ───────────────────────────────────────────────────────────────

export function mockEthPrice() {
  const price = parseFloat((2847.42 + (Math.random() - 0.5) * 20).toFixed(2));
  return {
    symbol:    "ETH/USD",
    price,
    change24h: parseFloat(((Math.random() - 0.5) * 4).toFixed(2)),
    volume24h: 12_480_000_000,
    source:    "OTTO Demo Oracle",
    timestamp: new Date().toISOString(),
  };
}

export function mockArcStats() {
  return {
    chain:               "Arc Testnet",
    chainId:             5042002,
    blockHeight:         1_250_000 + Math.floor(Math.random() * 1000),
    tps:                 parseFloat((Math.random() * 50 + 10).toFixed(1)),
    activeWallets:       3_847,
    usdcTvl:             parseFloat((Math.random() * 500_000 + 1_200_000).toFixed(2)),
    gatewayDeposits24h:  Math.floor(Math.random() * 200 + 50),
    source:              "OTTO Demo Oracle",
    timestamp:           new Date().toISOString(),
  };
}

// ─── App Factory ─────────────────────────────────────────────────────────────

const NETWORK = "eip155:84532"; // Base Sepolia
const PRICE   = "$0.001";

/**
 * Create and return the configured Express app.
 * Accepts an optional middleware override so tests can bypass x402 payment checks.
 */
export function createApp(
  payToAddress: `0x${string}`,
  facilitatorUrl = "https://www.x402.org/facilitator",
  _paymentMiddlewareOverride?: RequestHandler
): express.Express {
  const app = express();

  // Free health check
  app.get("/health", (_req, res) => {
    res.json({
      status:      "ok",
      server:      "OTTO Demo Oracle",
      network:     NETWORK,
      price:       PRICE,
      payTo:       payToAddress,
      facilitator: facilitatorUrl,
      paidEndpoints: {
        "GET /eth-price": `${PRICE} USDC — ETH/USD price feed`,
        "GET /arc-stats":  `${PRICE} USDC — Arc Testnet live stats`,
      },
    });
  });

  // x402 payment middleware (or test override)
  if (_paymentMiddlewareOverride) {
    app.use(_paymentMiddlewareOverride);
  } else {
    const facilitator  = new HTTPFacilitatorClient({ url: facilitatorUrl });
    const resourceServer = new x402ResourceServer(facilitator).register(
      NETWORK,
      new ExactEvmScheme()
    );
    app.use(
      paymentMiddleware(
        {
          "GET /eth-price": {
            accepts: { scheme: "exact", price: PRICE, network: NETWORK, payTo: payToAddress, maxTimeoutSeconds: 60 },
            description: "ETH/USD price feed — OTTO Demo Oracle",
          },
          "GET /arc-stats": {
            accepts: { scheme: "exact", price: PRICE, network: NETWORK, payTo: payToAddress, maxTimeoutSeconds: 60 },
            description: "Arc Testnet live statistics — OTTO Demo Oracle",
          },
        },
        resourceServer
      )
    );
  }

  // Paid routes — only reached after valid payment
  app.get("/eth-price", (_req, res) => { res.json(mockEthPrice()); });
  app.get("/arc-stats",  (_req, res) => { res.json(mockArcStats()); });

  return app;
}
