import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Env vars (must be set before vault.ts loads) ─────────────────────────────
process.env.VAULT_ADDRESS_ARC  = "0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA";
process.env.VAULT_ADDRESS_BASE = "0x47C1feaC66381410f5B050c39F67f15BbD058Af1";
process.env.VAULT_ADDRESS_FUJI = "0x47C1feaC66381410f5B050c39F67f15BbD058Af1";

// ── Mocks (must appear before imports) ───────────────────────────────────────

vi.mock("fs", () => ({
  readFileSync:  vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync:     vi.fn(),
  existsSync:    vi.fn(() => false),
}));

vi.mock("../lib/circle/gateway-sdk.js", () => ({
  arcTestnet: {
    id: 5042002,
    name: "Arc Testnet",
    rpcUrls: { default: { http: ["https://rpc.blockdaemon.testnet.arc.network"] } },
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorers: { default: { url: "https://explorer.testnet.arc.network" } },
  },
}));

vi.mock("./vault-bytecode.js", () => ({
  OTTO_VAULT_BYTECODE: "0x6080604052",
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: "0xA9A48d73F67B0c820fDE57c8b0639C6F850AE96e" as `0x${string}`,
  })),
}));

// Spread real viem so encodeFunctionData / isAddress / getAddress stay real.
// Only replace network-creating functions.
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(),
    createWalletClient: vi.fn(),
    http: vi.fn(() => "http-transport"),
  };
});

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  handleRegisterUserAddress,
  handleGetUserAddress,
  handleEncodeAdminTx,
  handleTransferVaultAdmin,
  handleCreateInvoice,
  handleCheckInvoiceStatus,
  handleVaultCheckWhitelist,
  handleVaultPayroll,
} from "./vault.js";

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createPublicClient, createWalletClient } from "viem";

const mockReadFileSync      = vi.mocked(readFileSync);
const mockWriteFileSync     = vi.mocked(writeFileSync);
const mockExistsSync        = vi.mocked(existsSync);
const mockCreatePublicClient = vi.mocked(createPublicClient);
const mockCreateWalletClient = vi.mocked(createWalletClient);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AGENT_ADDR    = "0xA9A48d73F67B0c820fDE57c8b0639C6F850AE96e";
const USER_ETH_ADDR = "0x1234567890123456789012345678901234567890";
const USER_ID       = "97729005";
const VAULT_ADDR    = "0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA"; // default Arc vault

/** Simulate OTTOVault.status() return tuple */
function makeStatusTuple(balance = 0n, admin: string = AGENT_ADDR) {
  return [
    balance,        // balance_
    10_000_000n,    // maxPerTx_
    100_000_000n,   // dailyLimit_
    0n,             // dailySpent_
    100_000_000n,   // remainingToday_
    false,          // whitelistEnabled_
    false,          // paused_
    AGENT_ADDR,     // agent_
    admin,          // admin_  (index 8)
  ] as const;
}

/** Point readFileSync / existsSync at in-memory registry objects */
function setupFiles({
  users    = {} as Record<string, { eth_address?: string }>,
  vaults   = {} as Record<string, Record<string, string>>,
  invoices = {} as Record<string, object>,
} = {}) {
  mockExistsSync.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("users.json"))       return Object.keys(users).length > 0;
    if (p.endsWith("user-vaults.json")) return Object.keys(vaults).length > 0;
    if (p.endsWith("invoices.json"))    return Object.keys(invoices).length > 0;
    return false;
  });

  mockReadFileSync.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("users.json"))       return JSON.stringify(users);
    if (p.endsWith("user-vaults.json")) return JSON.stringify(vaults);
    if (p.endsWith("invoices.json"))    return JSON.stringify(invoices);
    return "{}";
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// handleRegisterUserAddress
// ─────────────────────────────────────────────────────────────────────────────

describe("handleRegisterUserAddress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFiles();
  });

  it("registers a valid ETH address and writes to registry", async () => {
    const result = JSON.parse(
      await handleRegisterUserAddress({ user_id: USER_ID, eth_address: USER_ETH_ADDR })
    );

    expect(result.success).toBe(true);
    expect(result.user_id).toBe(USER_ID);
    expect(result.eth_address).toBe(USER_ETH_ADDR);
    expect(result.previous_address).toBeNull();
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it("updates an existing registered address", async () => {
    const oldAddr = "0x0000000000000000000000000000000000000001";
    setupFiles({ users: { [USER_ID]: { eth_address: oldAddr } } });

    const result = JSON.parse(
      await handleRegisterUserAddress({ user_id: USER_ID, eth_address: USER_ETH_ADDR })
    );

    expect(result.success).toBe(true);
    expect(result.previous_address).toBe(oldAddr);
    expect(result.eth_address).toBe(USER_ETH_ADDR);
  });

  it("returns error for an invalid ETH address", async () => {
    const result = JSON.parse(
      await handleRegisterUserAddress({ user_id: USER_ID, eth_address: "not-an-address" })
    );

    expect(result.success).toBe(false);
    expect(result.reason).toContain("Invalid ETH address");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("throws when user_id is empty", async () => {
    await expect(
      handleRegisterUserAddress({ user_id: "", eth_address: USER_ETH_ADDR })
    ).rejects.toThrow("user_id is required");
  });

  it("throws when eth_address is empty", async () => {
    await expect(
      handleRegisterUserAddress({ user_id: USER_ID, eth_address: "" })
    ).rejects.toThrow("eth_address is required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleGetUserAddress
// ─────────────────────────────────────────────────────────────────────────────

describe("handleGetUserAddress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns address and registered=true for a known user", async () => {
    setupFiles({ users: { [USER_ID]: { eth_address: USER_ETH_ADDR } } });

    const result = JSON.parse(await handleGetUserAddress({ user_id: USER_ID }));

    expect(result.eth_address).toBe(USER_ETH_ADDR);
    expect(result.registered).toBe(true);
    expect(result.user_id).toBe(USER_ID);
  });

  it("returns null and registered=false for an unknown user", async () => {
    setupFiles();

    const result = JSON.parse(await handleGetUserAddress({ user_id: USER_ID }));

    expect(result.eth_address).toBeNull();
    expect(result.registered).toBe(false);
  });

  it("throws when user_id is empty", async () => {
    await expect(handleGetUserAddress({ user_id: "" })).rejects.toThrow("user_id is required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleEncodeAdminTx
// ─────────────────────────────────────────────────────────────────────────────

describe("handleEncodeAdminTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFiles();
  });

  it("encodes setLimits with correct description and signing_url", async () => {
    const result = JSON.parse(
      await handleEncodeAdminTx({ function: "setLimits", max_per_tx_usdc: 50, daily_limit_usdc: 500 })
    );

    expect(result.function).toBe("setLimits");
    expect(result.data).toMatch(/^0x/);
    expect(result.to).toBe(VAULT_ADDR);
    expect(result.chain).toBe("arcTestnet");
    expect(result.chainId).toBe(5042002);
    expect(result.signing_url).toContain("https://ottoarc.xyz/sign");
    expect(result.signing_url).toContain("chainId=5042002");
    expect(result.description).toContain("50 USDC");
    expect(result.description).toContain("500 USDC");
  });

  it("encodes setPaused=true with emergency pause description", async () => {
    const result = JSON.parse(
      await handleEncodeAdminTx({ function: "setPaused", paused: true })
    );

    expect(result.data).toMatch(/^0x/);
    expect(result.description).toMatch(/pause/i);
  });

  it("encodes setPaused=false with unpause description", async () => {
    const result = JSON.parse(
      await handleEncodeAdminTx({ function: "setPaused", paused: false })
    );

    expect(result.description).toMatch(/unpause/i);
  });

  it("encodes setWhitelist add with address in description", async () => {
    const result = JSON.parse(
      await handleEncodeAdminTx({ function: "setWhitelist", address: USER_ETH_ADDR, allowed: true })
    );

    expect(result.data).toMatch(/^0x/);
    expect(result.description).toContain("Add");
    expect(result.description).toContain(USER_ETH_ADDR);
  });

  it("encodes setWhitelistEnabled=false with Disable description", async () => {
    const result = JSON.parse(
      await handleEncodeAdminTx({ function: "setWhitelistEnabled", enabled: false })
    );

    expect(result.data).toMatch(/^0x/);
    expect(result.description).toContain("Disable");
  });

  it("encodes setAgent with new address in description", async () => {
    const result = JSON.parse(
      await handleEncodeAdminTx({ function: "setAgent", new_address: USER_ETH_ADDR })
    );

    expect(result.data).toMatch(/^0x/);
    expect(result.description).toContain(USER_ETH_ADDR);
  });

  it("encodes transferAdmin with new admin in description", async () => {
    const result = JSON.parse(
      await handleEncodeAdminTx({ function: "transferAdmin", new_address: USER_ETH_ADDR })
    );

    expect(result.data).toMatch(/^0x/);
    expect(result.description).toContain(USER_ETH_ADDR);
  });

  it("encodes withdraw with amount in description", async () => {
    const result = JSON.parse(
      await handleEncodeAdminTx({ function: "withdraw", amount_usdc: 100 })
    );

    expect(result.data).toMatch(/^0x/);
    expect(result.description).toContain("100 USDC");
  });

  it("signing_url contains percent-encoded description", async () => {
    const result = JSON.parse(
      await handleEncodeAdminTx({ function: "setLimits", max_per_tx_usdc: 25, daily_limit_usdc: 250 })
    );

    expect(result.signing_url).toContain("desc=");
    expect(decodeURIComponent(result.signing_url)).toContain("25 USDC");
  });

  it("throws when setLimits params are missing", async () => {
    await expect(
      handleEncodeAdminTx({ function: "setLimits" })
    ).rejects.toThrow("setLimits requires max_per_tx_usdc and daily_limit_usdc");
  });

  it("throws when setWhitelist address is invalid", async () => {
    await expect(
      handleEncodeAdminTx({ function: "setWhitelist", address: "not-an-address", allowed: true })
    ).rejects.toThrow("Invalid address");
  });

  it("throws when setPaused param is missing", async () => {
    await expect(
      handleEncodeAdminTx({ function: "setPaused" })
    ).rejects.toThrow("setPaused requires paused");
  });

  it("throws on unknown function name", async () => {
    await expect(
      handleEncodeAdminTx({ function: "hackTheVault" as never })
    ).rejects.toThrow("Unknown admin function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleTransferVaultAdmin
// ─────────────────────────────────────────────────────────────────────────────

describe("handleTransferVaultAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("returns error when user has no registered ETH address", async () => {
    setupFiles();

    const result = JSON.parse(await handleTransferVaultAdmin({ user_id: USER_ID }));

    expect(result.success).toBe(false);
    expect(result.reason).toContain("No ETH address registered");
  });

  it("returns error when no vault found for user on chain", async () => {
    setupFiles({ users: { [USER_ID]: { eth_address: USER_ETH_ADDR } } });

    const result = JSON.parse(
      await handleTransferVaultAdmin({ user_id: USER_ID, chain: "arcTestnet" })
    );

    expect(result.success).toBe(false);
    expect(result.reason).toContain("No vault found");
  });

  it("returns error when OTTO is not the current admin", async () => {
    const otherAdmin = "0xDeAd000000000000000000000000000000000001";
    setupFiles({
      users:  { [USER_ID]: { eth_address: USER_ETH_ADDR } },
      vaults: { [USER_ID]: { arcTestnet: VAULT_ADDR } },
    });

    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(0n, otherAdmin)),
      waitForTransactionReceipt: vi.fn(),
    } as never);

    const result = JSON.parse(
      await handleTransferVaultAdmin({ user_id: USER_ID, chain: "arcTestnet" })
    );

    expect(result.success).toBe(false);
    expect(result.reason).toContain("OTTO is not the current admin");
    expect(result.current_admin).toBe(otherAdmin);
  });

  it("transfers admin successfully when OTTO is current admin", async () => {
    setupFiles({
      users:  { [USER_ID]: { eth_address: USER_ETH_ADDR } },
      vaults: { [USER_ID]: { arcTestnet: VAULT_ADDR } },
    });

    const mockWriteContract = vi.fn().mockResolvedValue("0xtransfertxhash");
    const mockWait = vi.fn().mockResolvedValue({ status: "success" });

    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(0n, AGENT_ADDR)),
      waitForTransactionReceipt: mockWait,
    } as never);

    mockCreateWalletClient.mockReturnValue({
      writeContract: mockWriteContract,
    } as never);

    const result = JSON.parse(
      await handleTransferVaultAdmin({ user_id: USER_ID, chain: "arcTestnet" })
    );

    expect(result.success).toBe(true);
    expect(result.new_admin).toBe(USER_ETH_ADDR);
    expect(result.previous_admin).toBe(AGENT_ADDR);
    expect(result.txHash).toBe("0xtransfertxhash");
    expect(result.vault).toBe(VAULT_ADDR);
  });

  it("accepts an explicit vault_address parameter", async () => {
    const customVault = "0xCafecafeCafecafeCafecafeCafecafeCafecafe";
    setupFiles({ users: { [USER_ID]: { eth_address: USER_ETH_ADDR } } }); // no vault registry entry

    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(0n, AGENT_ADDR)),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    } as never);

    mockCreateWalletClient.mockReturnValue({
      writeContract: vi.fn().mockResolvedValue("0xcustomtxhash"),
    } as never);

    const result = JSON.parse(
      await handleTransferVaultAdmin({ user_id: USER_ID, vault_address: customVault })
    );

    expect(result.success).toBe(true);
    expect(result.vault).toBe(customVault);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleCreateInvoice
// ─────────────────────────────────────────────────────────────────────────────

describe("handleCreateInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates invoice with current vault balance as baseline", async () => {
    setupFiles({ vaults: { [USER_ID]: { arcTestnet: VAULT_ADDR } } });

    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(10_000_000n)), // 10 USDC
    } as never);

    const result = JSON.parse(
      await handleCreateInvoice({ user_id: USER_ID, expected_amount_usdc: 25, chain: "arcTestnet" })
    );

    expect(result.invoice_id).toMatch(/^INV-\d+-[A-F0-9]+$/);
    expect(result.expected_amount_usdc).toBe(25);
    expect(result.initial_vault_balance_usdc).toBe(10);
    expect(result.status).toBe("pending");
    expect(result.vault_address).toBe(VAULT_ADDR);
    expect(result.chain).toBe("arcTestnet");
    expect(result.payment_instructions).toContain("25 USDC");
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("uses default vault when no user_id or vault_address provided", async () => {
    setupFiles();

    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(0n)),
    } as never);

    const result = JSON.parse(
      await handleCreateInvoice({ expected_amount_usdc: 5 })
    );

    expect(result.vault_address).toBe(VAULT_ADDR); // default Arc vault
    expect(result.invoice_id).toMatch(/^INV-/);
  });

  it("sets expiry correctly for custom expires_hours", async () => {
    setupFiles({ vaults: { [USER_ID]: { arcTestnet: VAULT_ADDR } } });

    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(0n)),
    } as never);

    const before = Date.now();
    const result = JSON.parse(
      await handleCreateInvoice({ user_id: USER_ID, expected_amount_usdc: 1, expires_hours: 2 })
    );
    const after = Date.now();

    const expiresMs = new Date(result.expires_at).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 2 * 3_600_000 - 1000);
    expect(expiresMs).toBeLessThanOrEqual(after  + 2 * 3_600_000 + 1000);
  });

  it("throws when no vault found for user_id", async () => {
    setupFiles(); // empty vault registry

    await expect(
      handleCreateInvoice({ user_id: USER_ID, expected_amount_usdc: 10 })
    ).rejects.toThrow(`No vault for user ${USER_ID}`);
  });

  it("throws on zero or negative amount", async () => {
    await expect(
      handleCreateInvoice({ expected_amount_usdc: 0 })
    ).rejects.toThrow("expected_amount_usdc must be positive");

    await expect(
      handleCreateInvoice({ expected_amount_usdc: -5 })
    ).rejects.toThrow("expected_amount_usdc must be positive");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleCheckInvoiceStatus
// ─────────────────────────────────────────────────────────────────────────────

describe("handleCheckInvoiceStatus", () => {
  const INVOICE_ID = "INV-1234567890-ABCDEF";
  const futureDate = new Date(Date.now() + 86_400_000).toISOString(); // 24 h away
  const pastDate   = new Date(Date.now() - 1_000).toISOString();       // already expired

  function makeInvoice(overrides: Record<string, unknown> = {}) {
    return {
      invoice_id:                INVOICE_ID,
      vault_address:             VAULT_ADDR,
      chain:                     "arcTestnet",
      expected_amount_usdc:      10,
      created_at:                new Date().toISOString(),
      expires_at:                futureDate,
      initial_vault_balance_usdc: 5,
      status:                    "pending",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not-found for an unknown invoice_id", async () => {
    setupFiles();

    const result = JSON.parse(
      await handleCheckInvoiceStatus({ invoice_id: "INV-UNKNOWN-000" })
    );

    expect(result.success).toBe(false);
    expect(result.reason).toContain("not found");
  });

  it("marks invoice as paid when balance increase meets expected amount", async () => {
    setupFiles({ invoices: { [INVOICE_ID]: makeInvoice() } });
    // baseline = 5 USDC, current = 15 USDC → increase = 10 ≥ expected 10
    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(15_000_000n)),
    } as never);

    const result = JSON.parse(
      await handleCheckInvoiceStatus({ invoice_id: INVOICE_ID })
    );

    expect(result.status).toBe("paid");
    expect(result.balance_increased_by_usdc).toBeCloseTo(10, 4);
    expect(result.message).toContain("paid");
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("stays pending when balance increase is below expected amount", async () => {
    setupFiles({ invoices: { [INVOICE_ID]: makeInvoice() } });
    // baseline = 5 USDC, current = 8 USDC → increase = 3 < expected 10
    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(8_000_000n)),
    } as never);

    const result = JSON.parse(
      await handleCheckInvoiceStatus({ invoice_id: INVOICE_ID })
    );

    expect(result.status).toBe("pending");
    expect(result.message).toContain("Pending");
    expect(result.balance_increased_by_usdc).toBeCloseTo(3, 4);
  });

  it("marks invoice as expired when past the deadline", async () => {
    setupFiles({ invoices: { [INVOICE_ID]: makeInvoice({ expires_at: pastDate }) } });

    // Code returns early after marking expired — public client is not called
    const result = JSON.parse(
      await handleCheckInvoiceStatus({ invoice_id: INVOICE_ID })
    );

    expect(result.status).toBe("expired");
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
  });

  it("returns immediately for an already-paid invoice without querying chain", async () => {
    setupFiles({ invoices: { [INVOICE_ID]: makeInvoice({ status: "paid" }) } });

    const result = JSON.parse(
      await handleCheckInvoiceStatus({ invoice_id: INVOICE_ID })
    );

    expect(result.status).toBe("paid");
    expect(mockCreatePublicClient).not.toHaveBeenCalled();
  });

  it("throws when invoice_id is empty", async () => {
    await expect(
      handleCheckInvoiceStatus({ invoice_id: "" })
    ).rejects.toThrow("invoice_id is required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultCheckWhitelist
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultCheckWhitelist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFiles();
  });

  it("returns ALLOWED when whitelisted=true and whitelist enabled", async () => {
    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn()
        .mockResolvedValueOnce(true)   // whitelist(address) → true
        .mockResolvedValueOnce(true),  // whitelistEnabled() → true
    } as never);

    const result = JSON.parse(
      await handleVaultCheckWhitelist({ address: USER_ETH_ADDR })
    );

    expect(result.whitelisted).toBe(true);
    expect(result.whitelist_enabled).toBe(true);
    expect(result.effective).toBe("ALLOWED");
  });

  it("returns BLOCKED when whitelisted=false and whitelist enabled", async () => {
    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn()
        .mockResolvedValueOnce(false)  // whitelist(address) → false
        .mockResolvedValueOnce(true),  // whitelistEnabled() → true
    } as never);

    const result = JSON.parse(
      await handleVaultCheckWhitelist({ address: USER_ETH_ADDR })
    );

    expect(result.whitelisted).toBe(false);
    expect(result.whitelist_enabled).toBe(true);
    expect(result.effective).toBe("BLOCKED");
  });

  it("returns ALLOWED (whitelist disabled) when whitelist is off", async () => {
    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn()
        .mockResolvedValueOnce(false)   // whitelist(address) → false
        .mockResolvedValueOnce(false),  // whitelistEnabled() → false
    } as never);

    const result = JSON.parse(
      await handleVaultCheckWhitelist({ address: USER_ETH_ADDR })
    );

    expect(result.whitelisted).toBe(false);
    expect(result.whitelist_enabled).toBe(false);
    expect(result.effective).toBe("ALLOWED (whitelist disabled)");
  });

  it("throws on invalid address", async () => {
    await expect(
      handleVaultCheckWhitelist({ address: "not-an-address" })
    ).rejects.toThrow("Invalid address");
  });

  it("throws on empty address", async () => {
    await expect(
      handleVaultCheckWhitelist({ address: "" })
    ).rejects.toThrow("address is required");
  });

  it("respects chain parameter", async () => {
    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    } as never);

    const result = JSON.parse(
      await handleVaultCheckWhitelist({ address: USER_ETH_ADDR, chain: "baseSepolia" })
    );

    expect(result.chain).toBe("baseSepolia");
    expect(result.effective).toBe("ALLOWED (whitelist disabled)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultPayroll
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultPayroll", () => {
  const RECIP_A = "0x1111111111111111111111111111111111111111";
  const RECIP_B = "0x2222222222222222222222222222222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
    setupFiles();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("succeeds for 2 recipients", async () => {
    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(50_000_000n)), // 50 USDC
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    } as never);

    mockCreateWalletClient.mockReturnValue({
      writeContract: vi.fn()
        .mockResolvedValueOnce("0xtxhash1")
        .mockResolvedValueOnce("0xtxhash2"),
    } as never);

    const result = JSON.parse(
      await handleVaultPayroll({
        recipients: [
          { address: RECIP_A, amount_usdc: 5 },
          { address: RECIP_B, amount_usdc: 3 },
        ],
      })
    );

    expect(result.success).toBe(true);
    expect(result.succeeded_count).toBe(2);
    expect(result.failed_count).toBe(0);
    expect(result.results[0].txHash).toBe("0xtxhash1");
    expect(result.results[1].txHash).toBe("0xtxhash2");
  });

  it("fails pre-flight when vault is paused", async () => {
    const pausedStatus = [
      50_000_000n,  // balance
      10_000_000n,  // maxPerTx
      100_000_000n, // dailyLimit
      0n,           // dailySpent
      100_000_000n, // remainingToday
      false,        // whitelistEnabled
      true,         // paused = TRUE
      AGENT_ADDR,   // agent
      AGENT_ADDR,   // admin
    ] as const;

    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(pausedStatus),
    } as never);

    const result = JSON.parse(
      await handleVaultPayroll({
        recipients: [{ address: RECIP_A, amount_usdc: 5 }],
      })
    );

    expect(result.success).toBe(false);
    expect(result.reason).toContain("paused");
  });

  it("fails pre-flight when total exceeds vault balance", async () => {
    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(5_000_000n)), // 5 USDC
    } as never);

    const result = JSON.parse(
      await handleVaultPayroll({
        recipients: [
          { address: RECIP_A, amount_usdc: 3 },
          { address: RECIP_B, amount_usdc: 4 },
        ],
      })
    );

    expect(result.success).toBe(false);
    expect(result.reason).toContain("exceeds vault balance");
  });

  it("fails pre-flight when total exceeds daily allowance", async () => {
    // balance=200, but remainingToday=5
    const lowAllowance = [
      200_000_000n, // balance
      10_000_000n,  // maxPerTx
      100_000_000n, // dailyLimit
      95_000_000n,  // dailySpent (95 spent)
      5_000_000n,   // remainingToday (only 5 left)
      false, false, AGENT_ADDR, AGENT_ADDR,
    ] as const;

    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(lowAllowance),
    } as never);

    const result = JSON.parse(
      await handleVaultPayroll({
        recipients: [
          { address: RECIP_A, amount_usdc: 3 },
          { address: RECIP_B, amount_usdc: 4 },
        ],
      })
    );

    expect(result.success).toBe(false);
    expect(result.reason).toContain("daily allowance");
  });

  it("fails pre-flight when single recipient exceeds per-tx cap", async () => {
    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(200_000_000n)),
    } as never);

    const result = JSON.parse(
      await handleVaultPayroll({
        recipients: [{ address: RECIP_A, amount_usdc: 15 }], // cap is 10
      })
    );

    expect(result.success).toBe(false);
    expect(result.reason).toContain("per-tx cap");
  });

  it("handles partial failure mid-batch (1 success, 1 fail)", async () => {
    mockCreatePublicClient.mockReturnValue({
      readContract: vi.fn().mockResolvedValue(makeStatusTuple(50_000_000n)),
      waitForTransactionReceipt: vi.fn()
        .mockResolvedValueOnce({ status: "success" })
        .mockResolvedValueOnce({ status: "success" }),
    } as never);

    mockCreateWalletClient.mockReturnValue({
      writeContract: vi.fn()
        .mockResolvedValueOnce("0xtxhash1")
        .mockRejectedValueOnce(new Error("Recipient not whitelisted")),
    } as never);

    const result = JSON.parse(
      await handleVaultPayroll({
        recipients: [
          { address: RECIP_A, amount_usdc: 5 },
          { address: RECIP_B, amount_usdc: 3 },
        ],
      })
    );

    expect(result.success).toBe(false);
    expect(result.succeeded_count).toBe(1);
    expect(result.failed_count).toBe(1);
    expect(result.results[0].success).toBe(true);
    expect(result.results[1].success).toBe(false);
    expect(result.results[1].error).toContain("whitelisted");
  });

  it("throws on empty recipients array", async () => {
    await expect(
      handleVaultPayroll({ recipients: [] })
    ).rejects.toThrow("recipients array is required and must not be empty");
  });
});
