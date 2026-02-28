/**
 * Tests for the OTTO Demo Oracle server (demo-server/app.ts).
 *
 * Strategy:
 * - mockEthPrice / mockArcStats — pure functions, test shape & value ranges
 * - /health    — no middleware, always accessible, test JSON shape
 * - /eth-price, /arc-stats — use a no-op middleware override to bypass x402
 *   payment checks and test the actual route handlers
 * - x402 gate — verify the real middleware returns 402 when no payment header
 *   is present (requires mocking @x402/express)
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";

// ── Mock x402 dependencies so they don't hit the network ─────────────────────

vi.mock("@x402/express", () => ({
  paymentMiddleware: vi.fn(
    () =>
      // Default mock: deny all requests with 402 (simulates real behaviour)
      (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
        res.status(402).json({ error: "X-PAYMENT required" })
  ),
  x402ResourceServer: vi.fn(() => ({
    register: vi.fn().mockReturnThis(),
  })),
}));

vi.mock("@x402/evm/exact/server", () => ({
  ExactEvmScheme: vi.fn(),
}));

vi.mock("@x402/core/server", () => ({
  HTTPFacilitatorClient: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { mockEthPrice, mockArcStats, createApp } from "../../../demo-server/app.js";
import { type RequestHandler } from "express";
import { paymentMiddleware } from "@x402/express";

const PAYTO = "0xA9A48d73F67B0c820fDE57c8b0639C6F850AE96e" as `0x${string}`;

// ─────────────────────────────────────────────────────────────────────────────
// mockEthPrice
// ─────────────────────────────────────────────────────────────────────────────

describe("mockEthPrice", () => {
  it("returns required fields", () => {
    const data = mockEthPrice();
    expect(data).toHaveProperty("symbol",    "ETH/USD");
    expect(data).toHaveProperty("price");
    expect(data).toHaveProperty("change24h");
    expect(data).toHaveProperty("volume24h", 12_480_000_000);
    expect(data).toHaveProperty("source",    "OTTO Demo Oracle");
    expect(data).toHaveProperty("timestamp");
  });

  it("price is within expected range (2837–2858)", () => {
    // Base price is 2847.42 ± 10
    for (let i = 0; i < 20; i++) {
      const { price } = mockEthPrice();
      expect(price).toBeGreaterThanOrEqual(2837);
      expect(price).toBeLessThanOrEqual(2858);
    }
  });

  it("timestamp is a valid ISO string", () => {
    const { timestamp } = mockEthPrice();
    expect(() => new Date(timestamp).toISOString()).not.toThrow();
  });

  it("price has at most 2 decimal places", () => {
    const { price } = mockEthPrice();
    const decimals = (price.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mockArcStats
// ─────────────────────────────────────────────────────────────────────────────

describe("mockArcStats", () => {
  it("returns required fields", () => {
    const data = mockArcStats();
    expect(data).toHaveProperty("chain",              "Arc Testnet");
    expect(data).toHaveProperty("chainId",            5042002);
    expect(data).toHaveProperty("blockHeight");
    expect(data).toHaveProperty("tps");
    expect(data).toHaveProperty("activeWallets",      3_847);
    expect(data).toHaveProperty("usdcTvl");
    expect(data).toHaveProperty("gatewayDeposits24h");
    expect(data).toHaveProperty("source",             "OTTO Demo Oracle");
    expect(data).toHaveProperty("timestamp");
  });

  it("blockHeight is above 1_250_000", () => {
    for (let i = 0; i < 10; i++) {
      expect(mockArcStats().blockHeight).toBeGreaterThanOrEqual(1_250_000);
    }
  });

  it("tps is between 10 and 60", () => {
    for (let i = 0; i < 20; i++) {
      const { tps } = mockArcStats();
      expect(tps).toBeGreaterThanOrEqual(10);
      expect(tps).toBeLessThan(60);
    }
  });

  it("usdcTvl is above 1_200_000", () => {
    expect(mockArcStats().usdcTvl).toBeGreaterThanOrEqual(1_200_000);
  });

  it("gatewayDeposits24h is between 50 and 250", () => {
    for (let i = 0; i < 20; i++) {
      const d = mockArcStats().gatewayDeposits24h;
      expect(d).toBeGreaterThanOrEqual(50);
      expect(d).toBeLessThan(250);
    }
  });

  it("timestamp is a valid ISO string", () => {
    expect(() => new Date(mockArcStats().timestamp).toISOString()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  const app = createApp(PAYTO);

  it("returns 200 with correct shape", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.server).toBe("OTTO Demo Oracle");
    expect(res.body.network).toBe("eip155:84532");
    expect(res.body.price).toBe("$0.001");
    expect(res.body.payTo).toBe(PAYTO);
  });

  it("lists both paid endpoints", async () => {
    const res = await request(app).get("/health");
    expect(res.body.paidEndpoints).toHaveProperty("GET /eth-price");
    expect(res.body.paidEndpoints).toHaveProperty("GET /arc-stats");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Paid routes — bypassing x402 with a no-op middleware
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /eth-price (x402 bypassed)", () => {
  const noopMiddleware: RequestHandler = (_req, _res, next) => next();
  const app = createApp(PAYTO, undefined, noopMiddleware);

  it("returns 200 with correct ETH price shape", async () => {
    const res = await request(app).get("/eth-price");
    expect(res.status).toBe(200);
    expect(res.body.symbol).toBe("ETH/USD");
    expect(typeof res.body.price).toBe("number");
    expect(typeof res.body.change24h).toBe("number");
    expect(res.body.volume24h).toBe(12_480_000_000);
    expect(res.body.source).toBe("OTTO Demo Oracle");
    expect(res.body.timestamp).toBeTruthy();
  });
});

describe("GET /arc-stats (x402 bypassed)", () => {
  const noopMiddleware: RequestHandler = (_req, _res, next) => next();
  const app = createApp(PAYTO, undefined, noopMiddleware);

  it("returns 200 with correct Arc stats shape", async () => {
    const res = await request(app).get("/arc-stats");
    expect(res.status).toBe(200);
    expect(res.body.chain).toBe("Arc Testnet");
    expect(res.body.chainId).toBe(5042002);
    expect(typeof res.body.blockHeight).toBe("number");
    expect(typeof res.body.tps).toBe("number");
    expect(res.body.activeWallets).toBe(3_847);
    expect(res.body.source).toBe("OTTO Demo Oracle");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// x402 gate — verify 402 is returned without payment
// ─────────────────────────────────────────────────────────────────────────────

describe("x402 payment gate", () => {
  // Use the real (mocked) paymentMiddleware that returns 402
  const app = createApp(PAYTO);

  it("GET /eth-price returns 402 without payment header", async () => {
    const res = await request(app).get("/eth-price");
    expect(res.status).toBe(402);
  });

  it("GET /arc-stats returns 402 without payment header", async () => {
    const res = await request(app).get("/arc-stats");
    expect(res.status).toBe(402);
  });

  it("paymentMiddleware was called with both route configs", () => {
    const mockFn = vi.mocked(paymentMiddleware);
    expect(mockFn).toHaveBeenCalled();
    const [routeConfig] = mockFn.mock.calls[0];
    expect(routeConfig).toHaveProperty("GET /eth-price");
    expect(routeConfig).toHaveProperty("GET /arc-stats");
    expect((routeConfig as Record<string, { accepts: { price: string } }>)["GET /eth-price"].accepts.price).toBe("$0.001");
  });
});
