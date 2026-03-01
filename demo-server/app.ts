/**
 * OTTO Demo Oracle — Express app factory.
 * Separated from server.ts so the app can be imported in tests without starting a listener.
 */

import express, { type RequestHandler } from "express";
import { createHmac, createHash } from "crypto";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase client ─────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const mockClient = {
  from: () => ({
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }), order: () => Promise.resolve({ data: [], error: null }) }) }),
    upsert: () => Promise.resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
    delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
  }),
} as any;

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : mockClient;

// ─── User / vault registry (Supabase) ───────────────────────────────────────


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

    const key = String(tg.id);
    await supabase.from("otto_users").upsert({
      user_id: key,
      eth_address: address.toLowerCase(),
      tg_id: tg.id,
      tg_username: tg.username,
      tg_first_name: tg.first_name,
    }, { onConflict: "user_id" });

    // Send welcome message via Telegram with vault info
    sendBindNotification(tg.id, address, tg.first_name, vaults).catch(() => {});

    res.json({ ok: true, tg_id: tg.id, address: address.toLowerCase() });
  });

  // GET /api/user/:address  — look up binding by wallet address
  app.get("/api/user/:address", async (req, res) => {
    const addr = req.params.address.toLowerCase();
    const { data: entry } = await supabase
      .from("otto_users")
      .select("*")
      .eq("eth_address", addr)
      .single();
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
  app.post("/api/vaults", async (req, res) => {
    const { address, vaults, shareholders } = req.body as {
      address?: string;
      vaults?: Partial<Record<string, string>>;
      shareholders?: string[];
    };
    if (!address || !vaults || Object.keys(vaults).length === 0) {
      res.status(400).json({ error: "address and vaults required" });
      return;
    }

    const normalizedShareholders = (shareholders ?? []).map((a: string) => a.toLowerCase());

    // Find existing user by eth_address, or create minimal record
    const { data: existing } = await supabase
      .from("otto_users")
      .select("user_id")
      .eq("eth_address", address.toLowerCase())
      .single();

    const key = existing?.user_id ?? address.toLowerCase();
    if (!existing) {
      await supabase.from("otto_users").upsert(
        { user_id: key, eth_address: address.toLowerCase() },
        { onConflict: "user_id" }
      );
    }

    // Auto-create otto_users records for shareholders
    if (normalizedShareholders.length > 0) {
      const userRows = normalizedShareholders.map((addr: string) => ({
        user_id: addr,
        eth_address: addr,
      }));
      await supabase.from("otto_users").upsert(userRows, { onConflict: "user_id" });
    }

    // Upsert each vault with shareholders
    const upserts = Object.entries(vaults).map(([chain, vault_address]) =>
      supabase.from("otto_vaults").upsert(
        {
          user_id: key,
          chain,
          vault_address: (vault_address as string).toLowerCase(),
          shareholders: normalizedShareholders,
        },
        { onConflict: "user_id,chain" }
      )
    );
    await Promise.all(upserts);

    // Return all vaults for this user
    const { data: allVaults } = await supabase
      .from("otto_vaults")
      .select("chain, vault_address")
      .eq("user_id", key);
    const vaultMap = Object.fromEntries((allVaults ?? []).map((r: any) => [r.chain, r.vault_address]));

    res.json({ ok: true, user_id: key, vaults: vaultMap });
  });

  // GET /api/vaults/:address  — look up deployed vaults by wallet address
  app.get("/api/vaults/:address", async (req, res) => {
    const addr = req.params.address.toLowerCase();

    // Find user_id by eth_address
    const { data: user } = await supabase
      .from("otto_users")
      .select("user_id")
      .eq("eth_address", addr)
      .single();
    if (!user) {
      res.json({ found: false, vaults: {} });
      return;
    }

    const { data: vaultRows } = await supabase
      .from("otto_vaults")
      .select("chain, vault_address")
      .eq("user_id", user.user_id);
    const vaults = Object.fromEntries((vaultRows ?? []).map((r: any) => [r.chain, r.vault_address]));

    res.json({ found: true, user_id: user.user_id, vaults });
  });

  // DELETE /api/vaults/:address  — clear all deployed vault addresses for a wallet
  app.delete("/api/vaults/:address", async (req, res) => {
    const addr = req.params.address.toLowerCase();

    const { data: user } = await supabase
      .from("otto_users")
      .select("user_id")
      .eq("eth_address", addr)
      .single();
    if (!user) {
      res.json({ ok: true, message: "no user found, nothing to clear" });
      return;
    }

    await supabase.from("otto_vaults").delete().eq("user_id", user.user_id);
    res.json({ ok: true, user_id: user.user_id, message: "vaults cleared" });
  });

  // ─── Governance DAC API ──────────────────────────────────────────────────

  // GET /api/governance/dacs — list all configured DACs with member counts
  app.get("/api/governance/dacs", async (_req, res) => {
    // Load DAC vaults (those with governor_address set)
    const { data: vaults } = await supabase
      .from("otto_vaults")
      .select("vault_address, governor_address, share_token_address, shareholders, name, chat_id, invite_link, created_at")
      .not("governor_address", "is", null);

    // Load all DAC members
    const { data: allMembers } = await supabase
      .from("otto_dac_members")
      .select("vault_address, tg_user_id, eth_address");

    const membersByVault: Record<string, Array<{ eth_address: string }>> = {};
    for (const m of allMembers ?? []) {
      const key = m.vault_address.toLowerCase();
      if (!membersByVault[key]) membersByVault[key] = [];
      membersByVault[key].push({ eth_address: m.eth_address });
    }

    const result = (vaults ?? []).map((v: any) => {
      const shareholders = v.shareholders ?? [];
      const dacMembers = membersByVault[v.vault_address.toLowerCase()] ?? [];
      const linkedAddresses = new Set(dacMembers.map((m: any) => m.eth_address.toLowerCase()));
      const allLinked = shareholders.length === 0 ||
        shareholders.every((s: string) => linkedAddresses.has(s.toLowerCase()));

      return {
        id: v.vault_address,
        name: v.name ?? "DAC",
        vault_address: v.vault_address,
        governor_address: v.governor_address,
        share_token_address: v.share_token_address,
        shareholders,
        invite_link: v.invite_link ?? null,
        chat_id: v.chat_id ?? null,
        member_count: dacMembers.length,
        shareholder_count: shareholders.length,
        governance_active: allLinked,
        created_at: v.created_at ?? null,
      };
    });
    res.json({ dacs: result });
  });

  // POST /api/governance/dacs — register a new DAC after factory deploy
  app.post("/api/governance/dacs", async (req, res) => {
    const {
      vault_address, governor_address, share_token_address,
      shareholders, name, deployer,
    } = req.body as {
      vault_address?: string;
      governor_address?: string;
      share_token_address?: string;
      shareholders?: string[];
      name?: string;
      deployer?: string;
    };

    if (!vault_address || !governor_address || !share_token_address) {
      res.status(400).json({ error: "vault_address, governor_address, share_token_address required" });
      return;
    }

    // Check if already registered
    const { data: existing } = await supabase
      .from("otto_vaults")
      .select("vault_address")
      .eq("vault_address", vault_address.toLowerCase())
      .not("governor_address", "is", null)
      .single();
    if (existing) {
      res.json({ ok: true, id: vault_address, message: "already registered" });
      return;
    }

    // Update existing otto_vaults row with governance columns, or upsert
    // The vault row may already exist from POST /api/vaults
    const userId = deployer?.toLowerCase() ?? vault_address.toLowerCase();
    await supabase.from("otto_users").upsert(
      { user_id: userId, eth_address: deployer?.toLowerCase() ?? null },
      { onConflict: "user_id" }
    );
    await supabase.from("otto_vaults").upsert({
      user_id: userId,
      chain: "arcTestnet",
      vault_address: vault_address.toLowerCase(),
      governor_address: governor_address.toLowerCase(),
      share_token_address: share_token_address.toLowerCase(),
      shareholders: (shareholders ?? []).map((s: string) => s.toLowerCase()),
      name: name ?? "OTTO Treasury",
    }, { onConflict: "user_id,chain" });

    // Auto-link deployer as member
    if (deployer) {
      const { data: userRow } = await supabase
        .from("otto_users")
        .select("user_id")
        .eq("eth_address", deployer.toLowerCase())
        .single();
      if (userRow) {
        await supabase.from("otto_dac_members").upsert({
          vault_address: vault_address.toLowerCase(),
          tg_user_id: userRow.user_id,
          eth_address: deployer.toLowerCase(),
        }, { onConflict: "vault_address,tg_user_id" });
      }
    }

    res.json({ ok: true, id: vault_address });
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
