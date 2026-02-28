/**
 * OTTO Demo Oracle — Express app factory.
 * Separated from server.ts so the app can be imported in tests without starting a listener.
 */

import express, { type RequestHandler } from "express";
import { createHmac, createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

// ─── User registry (shared with MCP tools — ~/.otto/users.json) ─────────────

const OTTO_DIR = join(process.env.HOME ?? "/tmp", ".otto");
const USERS_PATH = join(OTTO_DIR, "users.json");

type UserRecord = { eth_address?: string; tg_id?: number; tg_username?: string; tg_first_name?: string };
type UserRegistry = Record<string, UserRecord>;

function loadUsers(): UserRegistry {
  if (!existsSync(USERS_PATH)) return {};
  try { return JSON.parse(readFileSync(USERS_PATH, "utf8")); } catch { return {}; }
}

function saveUsers(registry: UserRegistry): void {
  mkdirSync(OTTO_DIR, { recursive: true });
  writeFileSync(USERS_PATH, JSON.stringify(registry, null, 2));
}

// ─── Telegram auth verification ──────────────────────────────────────────────

interface TelegramAuth {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

function verifyTelegramAuth(auth: TelegramAuth, botToken: string): boolean {
  const secretKey = createHash("sha256").update(botToken).digest();
  const checkPairs = Object.entries(auth)
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const hmac = createHmac("sha256", secretKey).update(checkPairs).digest("hex");
  return hmac === auth.hash;
}

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

  // CORS for frontend
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  app.use(express.json());

  // ─── Telegram bind API ────────────────────────────────────────────────────

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

  // POST /api/bind  — bind wallet ↔ Telegram account
  app.post("/api/bind", (req, res) => {
    const { address, tg } = req.body as { address?: string; tg?: TelegramAuth };
    if (!address || !tg) {
      res.status(400).json({ error: "address and tg required" });
      return;
    }
    if (!BOT_TOKEN) {
      res.status(500).json({ error: "bot token not configured" });
      return;
    }
    if (!verifyTelegramAuth(tg, BOT_TOKEN)) {
      res.status(403).json({ error: "invalid telegram auth" });
      return;
    }
    // Check auth_date not older than 1 day
    if (Date.now() / 1000 - tg.auth_date > 86400) {
      res.status(403).json({ error: "telegram auth expired" });
      return;
    }

    const registry = loadUsers();
    const key = String(tg.id);
    registry[key] = {
      ...registry[key],
      eth_address: address.toLowerCase(),
      tg_id: tg.id,
      tg_username: tg.username,
      tg_first_name: tg.first_name,
    };
    saveUsers(registry);

    res.json({ ok: true, tg_id: tg.id, address: address.toLowerCase() });
  });

  // GET /api/user/:address  — look up binding by wallet address
  app.get("/api/user/:address", (req, res) => {
    const addr = req.params.address.toLowerCase();
    const registry = loadUsers();
    const entry = Object.values(registry).find((u) => u.eth_address === addr);
    if (!entry) {
      res.json({ bound: false });
      return;
    }
    res.json({
      bound: true,
      tg_id: entry.tg_id,
      tg_username: entry.tg_username,
      tg_first_name: entry.tg_first_name,
    });
  });

  // ─── Free health check ────────────────────────────────────────────────────

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
