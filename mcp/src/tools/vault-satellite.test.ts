import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must appear before imports) ───────────────────────────────────────

vi.mock("../lib/circle/gateway-sdk.js", () => ({
  USDC_ADDRESSES: {
    baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    avalancheFuji: "0x5425890298aed601595a70ab815c96711a31bc65",
  },
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: "0xA9A48d73F67B0c820fDE57c8b0639C6F850AE96e" as `0x${string}`,
  })),
}));

vi.mock("viem/chains", () => ({
  baseSepolia: {
    id: 84532,
    name: "Base Sepolia",
    rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  avalancheFuji: {
    id: 43113,
    name: "Avalanche Fuji",
    rpcUrls: { default: { http: ["https://api.avax-test.network/ext/bc/C/rpc"] } },
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  },
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(),
    createWalletClient: vi.fn(),
    http: vi.fn(() => "http-transport"),
  };
});

// ── Imports ─────────────────────────────────────────────────────────────────

import {
  handleSatelliteStatus,
  handleSatelliteTransfer,
  handleSatelliteDeposit,
  handleSatelliteCeoTransfer,
  handleSatelliteWithdraw,
  handleSatelliteSetLimits,
  handleSatelliteWhitelist,
  handleSatelliteWhitelistToggle,
  handleSatellitePause,
} from "./vault-satellite.js";

import { createPublicClient, createWalletClient } from "viem";

const mockCreatePublicClient = vi.mocked(createPublicClient);
const mockCreateWalletClient = vi.mocked(createWalletClient);

// ── Fixtures ────────────────────────────────────────────────────────────────

const AGENT_ADDR = "0xA9A48d73F67B0c820fDE57c8b0639C6F850AE96e";
const VAULT_ADDR = "0xVault000000000000000000000000000000000001";
const RECIPIENT = "0x1111111111111111111111111111111111111111";
const CHAIN = "baseSepolia";

/** Satellite status() return tuple (9 fields) */
function makeSatelliteStatusTuple(overrides: Partial<{
  balance: bigint; maxPerTx: bigint; dailyLimit: bigint; dailySpent: bigint;
  remainingToday: bigint; whitelistEnabled: boolean; paused: boolean;
  agent: string; ceo: string;
}> = {}) {
  return [
    overrides.balance ?? 100_000_000n,
    overrides.maxPerTx ?? 10_000_000n,
    overrides.dailyLimit ?? 100_000_000n,
    overrides.dailySpent ?? 0n,
    overrides.remainingToday ?? 100_000_000n,
    overrides.whitelistEnabled ?? false,
    overrides.paused ?? false,
    overrides.agent ?? AGENT_ADDR,
    overrides.ceo ?? AGENT_ADDR,
  ] as const;
}

function setupMocks({
  readContract = vi.fn(),
  writeContract = vi.fn().mockResolvedValue("0xmocktxhash"),
  waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success" }),
} = {}) {
  mockCreatePublicClient.mockReturnValue({
    readContract,
    waitForTransactionReceipt,
  } as never);

  mockCreateWalletClient.mockReturnValue({
    writeContract,
  } as never);

  return { readContract, writeContract, waitForTransactionReceipt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("satellite_transfer rejects missing vault_address", async () => {
    await expect(
      handleSatelliteTransfer({ vault_address: "", chain: CHAIN, to: RECIPIENT, amount_usdc: 5 })
    ).rejects.toThrow("vault_address is required");
  });

  it("satellite_transfer rejects missing to address", async () => {
    await expect(
      handleSatelliteTransfer({ vault_address: VAULT_ADDR, chain: CHAIN, to: "", amount_usdc: 5 })
    ).rejects.toThrow("to address is required");
  });

  it("satellite_transfer rejects zero amount", async () => {
    await expect(
      handleSatelliteTransfer({ vault_address: VAULT_ADDR, chain: CHAIN, to: RECIPIENT, amount_usdc: 0 })
    ).rejects.toThrow("amount_usdc must be positive");
  });

  it("satellite_status rejects unknown chain", async () => {
    await expect(
      handleSatelliteStatus({ vault_address: VAULT_ADDR, chain: "mainnet" })
    ).rejects.toThrow("Unknown satellite chain");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSatelliteStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("returns formatted status with all fields", async () => {
    const readContract = vi.fn().mockResolvedValue(makeSatelliteStatusTuple());
    setupMocks({ readContract });

    const result = await handleSatelliteStatus({ vault_address: VAULT_ADDR, chain: CHAIN });

    expect(result).toContain("OTTOSatelliteVault Status");
    expect(result).toContain("100.000000 USDC");
    expect(result).toContain("10.000000 USDC");
    expect(result).toContain("Base Sepolia");
    expect(result).toContain(AGENT_ADDR);
    expect(result).toContain("Disabled");
    expect(result).not.toContain("Governor");
  });

  it("shows paused state", async () => {
    const readContract = vi.fn().mockResolvedValue(
      makeSatelliteStatusTuple({ paused: true })
    );
    setupMocks({ readContract });

    const result = await handleSatelliteStatus({ vault_address: VAULT_ADDR, chain: CHAIN });
    expect(result).toContain("**Paused**: YES");
  });

  it("works with avalancheFuji chain", async () => {
    const readContract = vi.fn().mockResolvedValue(makeSatelliteStatusTuple());
    setupMocks({ readContract });

    const result = await handleSatelliteStatus({ vault_address: VAULT_ADDR, chain: "avalancheFuji" });
    expect(result).toContain("Avalanche Fuji");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent Transfer
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSatelliteTransfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("succeeds when canTransfer returns true", async () => {
    const readContract = vi.fn().mockResolvedValue([true, ""]);
    const { writeContract } = setupMocks({ readContract });

    const result = JSON.parse(
      await handleSatelliteTransfer({ vault_address: VAULT_ADDR, chain: CHAIN, to: RECIPIENT, amount_usdc: 5 })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("agentTransfer");
    expect(result.chain).toBe(CHAIN);
    expect(writeContract).toHaveBeenCalledOnce();
  });

  it("returns failure when canTransfer returns false", async () => {
    const readContract = vi.fn().mockResolvedValue([false, "Exceeds daily limit"]);
    const { writeContract } = setupMocks({ readContract });

    const result = JSON.parse(
      await handleSatelliteTransfer({ vault_address: VAULT_ADDR, chain: CHAIN, to: RECIPIENT, amount_usdc: 999 })
    );

    expect(result.success).toBe(false);
    expect(result.reason).toBe("Exceeds daily limit");
    expect(writeContract).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deposit
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSatelliteDeposit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("approves then deposits USDC", async () => {
    const { writeContract } = setupMocks();

    const result = JSON.parse(
      await handleSatelliteDeposit({ vault_address: VAULT_ADDR, chain: CHAIN, amount_usdc: 10 })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("deposit");
    expect(result.amount_usdc).toBe(10);
    // approve + deposit = 2 calls
    expect(writeContract).toHaveBeenCalledTimes(2);
  });

  it("rejects zero amount", async () => {
    await expect(
      handleSatelliteDeposit({ vault_address: VAULT_ADDR, chain: CHAIN, amount_usdc: 0 })
    ).rejects.toThrow("amount_usdc must be positive");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CEO Transfer
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSatelliteCeoTransfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("transfers without limit checks", async () => {
    const { writeContract } = setupMocks();

    const result = JSON.parse(
      await handleSatelliteCeoTransfer({ vault_address: VAULT_ADDR, chain: CHAIN, to: RECIPIENT, amount_usdc: 50 })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("ceoTransfer");
    expect(result.to).toBe(RECIPIENT);
    expect(writeContract).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CEO Withdraw
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSatelliteWithdraw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("withdraws to CEO address", async () => {
    const { writeContract } = setupMocks();

    const result = JSON.parse(
      await handleSatelliteWithdraw({ vault_address: VAULT_ADDR, chain: CHAIN, amount_usdc: 25 })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("ceoWithdraw");
    expect(result.amount_usdc).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Set Limits
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSatelliteSetLimits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("sets new limits", async () => {
    const { writeContract } = setupMocks();

    const result = JSON.parse(
      await handleSatelliteSetLimits({
        vault_address: VAULT_ADDR, chain: CHAIN,
        max_per_tx_usdc: 20, daily_limit_usdc: 200,
      })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("setLimits");
    expect(result.max_per_tx_usdc).toBe(20);
    expect(result.daily_limit_usdc).toBe(200);
  });

  it("rejects zero max_per_tx", async () => {
    await expect(
      handleSatelliteSetLimits({
        vault_address: VAULT_ADDR, chain: CHAIN,
        max_per_tx_usdc: 0, daily_limit_usdc: 100,
      })
    ).rejects.toThrow("max_per_tx_usdc must be positive");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Whitelist
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSatelliteWhitelist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("adds address to whitelist", async () => {
    const { writeContract } = setupMocks();

    const result = JSON.parse(
      await handleSatelliteWhitelist({
        vault_address: VAULT_ADDR, chain: CHAIN,
        address: RECIPIENT, allowed: true,
      })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("whitelistAdd");
  });

  it("removes address from whitelist", async () => {
    const { writeContract } = setupMocks();

    const result = JSON.parse(
      await handleSatelliteWhitelist({
        vault_address: VAULT_ADDR, chain: CHAIN,
        address: RECIPIENT, allowed: false,
      })
    );

    expect(result.action).toBe("whitelistRemove");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Whitelist Toggle
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSatelliteWhitelistToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("enables whitelist", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleSatelliteWhitelistToggle({ vault_address: VAULT_ADDR, chain: CHAIN, enabled: true })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("whitelistToggle");
    expect(result.enabled).toBe(true);
  });

  it("disables whitelist", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleSatelliteWhitelistToggle({ vault_address: VAULT_ADDR, chain: CHAIN, enabled: false })
    );

    expect(result.enabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pause
// ─────────────────────────────────────────────────────────────────────────────

describe("handleSatellitePause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("pauses vault", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleSatellitePause({ vault_address: VAULT_ADDR, chain: CHAIN, paused: true })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("pause");
  });

  it("unpauses vault", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleSatellitePause({ vault_address: VAULT_ADDR, chain: CHAIN, paused: false })
    );

    expect(result.action).toBe("unpause");
  });
});
