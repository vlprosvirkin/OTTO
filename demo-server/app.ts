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
const USER_VAULTS_PATH = join(OTTO_DIR, "user-vaults.json");

type UserRecord = { eth_address?: string; tg_id?: number; tg_username?: string; tg_first_name?: string };
type UserRegistry = Record<string, UserRecord>;
type VaultRegistry = Record<string, Partial<Record<string, string>>>;

function loadUsers(): UserRegistry {
  if (!existsSync(USERS_PATH)) return {};
  try { return JSON.parse(readFileSync(USERS_PATH, "utf8")); } catch { return {}; }
}

function saveUsers(registry: UserRegistry): void {
  mkdirSync(OTTO_DIR, { recursive: true });
  writeFileSync(USERS_PATH, JSON.stringify(registry, null, 2));
}

function loadVaults(): VaultRegistry {
  if (!existsSync(USER_VAULTS_PATH)) return {};
  try { return JSON.parse(readFileSync(USER_VAULTS_PATH, "utf8")); } catch { return {}; }
}

function saveVaults(registry: VaultRegistry): void {
  mkdirSync(OTTO_DIR, { recursive: true });
  writeFileSync(USER_VAULTS_PATH, JSON.stringify(registry, null, 2));
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

// ─── Stork Oracle + Mock Fallback ────────────────────────────────────────────

const STORK_REST_URL = "https://rest.jp.stork-oracle.network/v1/prices/latest";

export function mockEthPrice() {
  const price = parseFloat((2847.42 + (Math.random() - 0.5) * 20).toFixed(2));
  return {
    symbol:    "ETH/USD",
    price,
    change24h: parseFloat(((Math.random() - 0.5) * 4).toFixed(2)),
    volume24h: 12_480_000_000,
    source:    "OTTO Demo Oracle (mock)",
    timestamp: new Date().toISOString(),
  };
}

/** Try Stork REST API first, fall back to mock on failure or missing key. */
export async function fetchEthPrice(): Promise<ReturnType<typeof mockEthPrice>> {
  const apiKey = process.env.STORK_API_KEY;
  if (!apiKey) return mockEthPrice();

  try {
    const resp = await fetch(`${STORK_REST_URL}?assets=ETHUSD`, {
      headers: { Authorization: `Basic ${apiKey}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return mockEthPrice();

    const json = await resp.json() as { data?: { ETHUSD?: { price?: string; timestamp_ns?: number } } };
    const feed = json?.data?.ETHUSD;
    if (!feed?.price) return mockEthPrice();

    return {
      symbol:    "ETH/USD",
      price:     parseFloat(parseFloat(feed.price).toFixed(2)),
      change24h: parseFloat(((Math.random() - 0.5) * 4).toFixed(2)),
      volume24h: 12_480_000_000,
      source:    "Stork Oracle",
      timestamp: feed.timestamp_ns
        ? new Date(feed.timestamp_ns / 1_000_000).toISOString()
        : new Date().toISOString(),
    };
  } catch {
    return mockEthPrice();
  }
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

// ─── Telegram notification ───────────────────────────────────────────────────

const CHAIN_NAMES: Record<string, string> = {
  arcTestnet: "Arc Testnet",
  baseSepolia: "Base Sepolia",
  avalancheFuji: "Avalanche Fuji",
};

async function sendBindNotification(
  chatId: number,
  address: string,
  firstName: string | undefined,
  vaults: Partial<Record<string, string>> | undefined,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const name = firstName || "there";
  const addr = `${address.slice(0, 6)}...${address.slice(-4)}`;

  let vaultLines = "";
  if (vaults && Object.keys(vaults).length > 0) {
    const lines = Object.entries(vaults)
      .filter(([, v]) => v)
      .map(([chain, v]) => `  ${CHAIN_NAMES[chain] || chain}: <code>${v!.slice(0, 6)}...${v!.slice(-4)}</code>`);
    vaultLines = lines.length
      ? `\n\n<b>Your vaults:</b>\n${lines.join("\n")}`
      : "";
  }

  const text = [
    `Hey ${name}, your wallet <code>${addr}</code> is now linked to this Telegram account.`,
    vaultLines,
    `\n<b>What I can do for you:</b>`,
    `• Check vault balances and status`,
    `• Transfer USDC within on-chain limits`,
    `• Run payroll to multiple recipients`,
    `• Monitor and rebalance across chains`,
    `• Fetch paid oracle data via x402`,
    `\nJust message me here — I'm OTTO, your treasury agent.`,
  ].join("\n");

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
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
  app.post("/api/bind", async (req, res) => {
    const { address, tg, vaults } = req.body as {
      address?: string;
      tg?: TelegramAuth;
      vaults?: Partial<Record<string, string>>;
    };
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

    // Send welcome message via Telegram with vault info
    sendBindNotification(tg.id, address, tg.first_name, vaults).catch(() => {});

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

  // POST /api/vaults  — save deployed vault addresses for a wallet
  app.post("/api/vaults", (req, res) => {
    const { address, vaults } = req.body as {
      address?: string;
      vaults?: Partial<Record<string, string>>;
    };
    if (!address || !vaults || Object.keys(vaults).length === 0) {
      res.status(400).json({ error: "address and vaults required" });
      return;
    }

    const users = loadUsers();
    const userId = Object.keys(users).find((id) => users[id].eth_address === address.toLowerCase());

    // If user is not registered yet, create a minimal record keyed by address
    const key = userId ?? address.toLowerCase();
    if (!userId) {
      users[key] = { eth_address: address.toLowerCase() };
      saveUsers(users);
    }

    const registry = loadVaults();
    registry[key] = { ...registry[key], ...vaults };
    saveVaults(registry);

    res.json({ ok: true, user_id: key, vaults: registry[key] });
  });

  // GET /api/vaults/:address  — look up deployed vaults by wallet address
  app.get("/api/vaults/:address", (req, res) => {
    const addr = req.params.address.toLowerCase();
    const users = loadUsers();
    const vaultRegistry = loadVaults();

    // Find user_id by eth_address
    const userId = Object.keys(users).find((id) => users[id].eth_address === addr);
    if (!userId) {
      res.json({ found: false, vaults: {} });
      return;
    }

    const vaults = vaultRegistry[userId] ?? {};
    res.json({
      found: true,
      user_id: userId,
      vaults, // { arcTestnet: "0x...", baseSepolia: "0x...", ... }
    });
  });

  // ─── Governance DAC API ──────────────────────────────────────────────────

  const GOV_PATH = join(OTTO_DIR, "governance.json");

  // GET /api/governance/dacs — list all configured DACs with member counts
  app.get("/api/governance/dacs", (_req, res) => {
    if (!existsSync(GOV_PATH)) {
      res.json({ dacs: [] });
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(GOV_PATH, "utf8")) as Record<string, unknown>;
      const dacs = (raw.dacs ?? {}) as Record<string, Record<string, unknown>>;
      const members = (raw.members ?? {}) as Record<string, Record<string, { eth_address?: string }>>;

      const result = Object.entries(dacs).map(([id, dac]) => {
        const dacMembers = members[id] ?? {};
        const shareholders = (dac.shareholders ?? []) as string[];
        const linkedAddresses = new Set(
          Object.values(dacMembers).map((m) => (m.eth_address ?? "").toLowerCase())
        );
        const allLinked = shareholders.length === 0 ||
          shareholders.every((s) => linkedAddresses.has(s.toLowerCase()));

        return {
          id,
          name: dac.name ?? "DAC",
          vault_address: dac.vault_address,
          governor_address: dac.governor_address,
          share_token_address: dac.share_token_address,
          shareholders,
          invite_link: dac.invite_link ?? null,
          chat_id: dac.chat_id ?? null,
          member_count: Object.keys(dacMembers).length,
          shareholder_count: shareholders.length,
          governance_active: allLinked,
          created_at: dac.created_at ?? null,
        };
      });
      res.json({ dacs: result });
    } catch {
      res.json({ dacs: [] });
    }
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
  app.get("/eth-price", async (_req, res) => { res.json(await fetchEthPrice()); });
  app.get("/arc-stats",  (_req, res) => { res.json(mockArcStats()); });

  return app;
}
