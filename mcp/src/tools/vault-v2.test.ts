import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must appear before imports) ───────────────────────────────────────

vi.mock("../lib/circle/gateway-sdk.js", () => ({
  arcTestnet: {
    id: 5042002,
    name: "Arc Testnet",
    rpcUrls: { default: { http: ["https://rpc.blockdaemon.testnet.arc.network"] } },
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorers: { default: { url: "https://explorer.testnet.arc.network" } },
  },
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: "0xA9A48d73F67B0c820fDE57c8b0639C6F850AE96e" as `0x${string}`,
  })),
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
  handleVaultV2Status,
  handleVaultV2Transfer,
  handleVaultV2Deposit,
  handleVaultV2Whitelist,
  handleVaultV2WhitelistToggle,
  handleVaultV2CeoTransfer,
  handleVaultV2Withdraw,
  handleVaultV2SetLimits,
  handleVaultV2Pause,
  handleVaultV2Finalize,
  handleVaultV2DistributeRevenue,
  handleVaultV2Shareholders,
  handleVaultV2DissolveStatus,
} from "./vault-v2.js";

import { createPublicClient, createWalletClient } from "viem";

const mockCreatePublicClient = vi.mocked(createPublicClient);
const mockCreateWalletClient = vi.mocked(createWalletClient);

// ── Fixtures ────────────────────────────────────────────────────────────────

const AGENT_ADDR = "0xA9A48d73F67B0c820fDE57c8b0639C6F850AE96e";
const VAULT_ADDR = "0xVault000000000000000000000000000000000001";
const GOVERNOR_ADDR = "0xGov0000000000000000000000000000000000001";
const TOKEN_ADDR = "0xToken000000000000000000000000000000000001";
const RECIPIENT = "0x1111111111111111111111111111111111111111";

/** V2 status() return tuple (12 fields) */
function makeV2StatusTuple(overrides: Partial<{
  balance: bigint; maxPerTx: bigint; dailyLimit: bigint; dailySpent: bigint;
  remainingToday: bigint; whitelistEnabled: boolean; paused: boolean;
  agent: string; ceo: string; governor: string; state: number;
  totalInvestedInYield: bigint;
}> = {}) {
  return [
    overrides.balance ?? 100_000_000n,           // balance_ (100 USDC)
    overrides.maxPerTx ?? 10_000_000n,           // maxPerTx_ (10 USDC)
    overrides.dailyLimit ?? 100_000_000n,         // dailyLimit_ (100 USDC)
    overrides.dailySpent ?? 0n,                   // dailySpent_
    overrides.remainingToday ?? 100_000_000n,     // remainingToday_
    overrides.whitelistEnabled ?? false,           // whitelistEnabled_
    overrides.paused ?? false,                     // paused_
    overrides.agent ?? AGENT_ADDR,                 // agent_
    overrides.ceo ?? AGENT_ADDR,                   // ceo_
    overrides.governor ?? GOVERNOR_ADDR,            // governor_
    overrides.state ?? 0,                          // state_ (0=Active)
    overrides.totalInvestedInYield ?? 0n,          // totalInvestedInYield_
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
// Input Validation (shared across handlers)
// ─────────────────────────────────────────────────────────────────────────────

describe("Input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("v2_transfer rejects missing vault_address", async () => {
    await expect(
      handleVaultV2Transfer({ vault_address: "", to: RECIPIENT, amount_usdc: 5 })
    ).rejects.toThrow("vault_address is required");
  });

  it("v2_transfer rejects missing to address", async () => {
    await expect(
      handleVaultV2Transfer({ vault_address: VAULT_ADDR, to: "", amount_usdc: 5 })
    ).rejects.toThrow("to address is required");
  });

  it("v2_transfer rejects zero amount", async () => {
    await expect(
      handleVaultV2Transfer({ vault_address: VAULT_ADDR, to: RECIPIENT, amount_usdc: 0 })
    ).rejects.toThrow("amount_usdc must be positive");
  });

  it("v2_deposit rejects missing vault_address", async () => {
    await expect(
      handleVaultV2Deposit({ vault_address: "", amount_usdc: 10 })
    ).rejects.toThrow("vault_address is required");
  });

  it("v2_deposit rejects negative amount", async () => {
    await expect(
      handleVaultV2Deposit({ vault_address: VAULT_ADDR, amount_usdc: -5 })
    ).rejects.toThrow("amount_usdc must be positive");
  });

  it("v2_whitelist rejects missing address", async () => {
    await expect(
      handleVaultV2Whitelist({ vault_address: VAULT_ADDR, address: "", allowed: true })
    ).rejects.toThrow("address is required");
  });

  it("v2_ceo_transfer rejects zero amount", async () => {
    await expect(
      handleVaultV2CeoTransfer({ vault_address: VAULT_ADDR, to: RECIPIENT, amount_usdc: 0 })
    ).rejects.toThrow("amount_usdc must be positive");
  });

  it("v2_withdraw rejects zero amount", async () => {
    await expect(
      handleVaultV2Withdraw({ vault_address: VAULT_ADDR, amount_usdc: 0 })
    ).rejects.toThrow("amount_usdc must be positive");
  });

  it("v2_set_limits rejects zero max_per_tx_usdc", async () => {
    await expect(
      handleVaultV2SetLimits({ vault_address: VAULT_ADDR, max_per_tx_usdc: 0, daily_limit_usdc: 100 })
    ).rejects.toThrow("max_per_tx_usdc must be positive");
  });

  it("v2_set_limits rejects zero daily_limit_usdc", async () => {
    await expect(
      handleVaultV2SetLimits({ vault_address: VAULT_ADDR, max_per_tx_usdc: 10, daily_limit_usdc: 0 })
    ).rejects.toThrow("daily_limit_usdc must be positive");
  });

  it("v2_finalize rejects missing vault_address", async () => {
    await expect(
      handleVaultV2Finalize({ vault_address: "" })
    ).rejects.toThrow("vault_address is required");
  });

  it("v2_distribute_revenue rejects zero amount", async () => {
    await expect(
      handleVaultV2DistributeRevenue({ vault_address: VAULT_ADDR, amount_usdc: 0 })
    ).rejects.toThrow("amount_usdc must be positive");
  });

  it("v2_status rejects missing vault_address", async () => {
    await expect(
      handleVaultV2Status({ vault_address: "" })
    ).rejects.toThrow("vault_address is required");
  });

  it("v2_shareholders rejects empty shareholders array", async () => {
    await expect(
      handleVaultV2Shareholders({ vault_address: VAULT_ADDR, shareholders: [] })
    ).rejects.toThrow("shareholders array is required");
  });

  it("v2_dissolve_status rejects empty shareholders array", async () => {
    await expect(
      handleVaultV2DissolveStatus({ vault_address: VAULT_ADDR, shareholders: [] })
    ).rejects.toThrow("shareholders array is required");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2Status
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2Status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("returns formatted status with all 12 fields", async () => {
    const readContract = vi.fn()
      .mockResolvedValueOnce(makeV2StatusTuple({ balance: 50_000_000n })) // status()
      .mockResolvedValueOnce(TOKEN_ADDR) // shareToken()
      .mockResolvedValueOnce(0n); // yieldBalance()

    setupMocks({ readContract });

    const result = await handleVaultV2Status({ vault_address: VAULT_ADDR });

    expect(result).toContain("OTTOVault V2 Status");
    expect(result).toContain("50.000000 USDC");
    expect(result).toContain("Active");
    expect(result).toContain("CEO");
    expect(result).toContain("Agent");
    expect(result).toContain("Governor");
  });

  it("shows Dissolving state correctly", async () => {
    const readContract = vi.fn()
      .mockResolvedValueOnce(makeV2StatusTuple({ state: 1, paused: true }))
      .mockResolvedValueOnce(TOKEN_ADDR)
      .mockResolvedValueOnce(0n);

    setupMocks({ readContract });

    const result = await handleVaultV2Status({ vault_address: VAULT_ADDR });

    expect(result).toContain("Dissolving");
    expect(result).toContain("YES"); // paused
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2Transfer
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2Transfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("succeeds when canTransfer returns true", async () => {
    const readContract = vi.fn().mockResolvedValue([true, ""]); // canTransfer ok

    const { writeContract } = setupMocks({ readContract });
    writeContract.mockResolvedValue("0xtransferhash");

    const result = JSON.parse(
      await handleVaultV2Transfer({ vault_address: VAULT_ADDR, to: RECIPIENT, amount_usdc: 5 })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("agentTransfer");
    expect(result.to).toBe(RECIPIENT);
    expect(result.amount_usdc).toBe(5);
    expect(result.txHash).toBe("0xtransferhash");
  });

  it("fails when canTransfer returns false", async () => {
    const readContract = vi.fn().mockResolvedValue([false, "Exceeds per-tx limit"]);

    setupMocks({ readContract });

    const result = JSON.parse(
      await handleVaultV2Transfer({ vault_address: VAULT_ADDR, to: RECIPIENT, amount_usdc: 15 })
    );

    expect(result.success).toBe(false);
    expect(result.reason).toBe("Exceeds per-tx limit");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2Deposit
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2Deposit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("approves USDC then deposits", async () => {
    const { writeContract } = setupMocks();
    writeContract
      .mockResolvedValueOnce("0xapprovetx") // approve
      .mockResolvedValueOnce("0xdeposittx"); // deposit

    const result = JSON.parse(
      await handleVaultV2Deposit({ vault_address: VAULT_ADDR, amount_usdc: 100 })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("deposit");
    expect(result.amount_usdc).toBe(100);
    expect(writeContract).toHaveBeenCalledTimes(2); // approve + deposit
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2Whitelist
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2Whitelist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("adds address to whitelist", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleVaultV2Whitelist({ vault_address: VAULT_ADDR, address: RECIPIENT, allowed: true })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("whitelistAdd");
    expect(result.address).toBe(RECIPIENT);
  });

  it("removes address from whitelist", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleVaultV2Whitelist({ vault_address: VAULT_ADDR, address: RECIPIENT, allowed: false })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("whitelistRemove");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2WhitelistToggle
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2WhitelistToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("enables whitelist", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleVaultV2WhitelistToggle({ vault_address: VAULT_ADDR, enabled: true })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("whitelistToggle");
    expect(result.enabled).toBe(true);
  });

  it("disables whitelist", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleVaultV2WhitelistToggle({ vault_address: VAULT_ADDR, enabled: false })
    );

    expect(result.success).toBe(true);
    expect(result.enabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2CeoTransfer
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2CeoTransfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("transfers USDC as CEO", async () => {
    const { writeContract } = setupMocks();
    writeContract.mockResolvedValue("0xceotxhash");

    const result = JSON.parse(
      await handleVaultV2CeoTransfer({ vault_address: VAULT_ADDR, to: RECIPIENT, amount_usdc: 20 })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("ceoTransfer");
    expect(result.to).toBe(RECIPIENT);
    expect(result.amount_usdc).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2Withdraw
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2Withdraw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("withdraws USDC to CEO address", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleVaultV2Withdraw({ vault_address: VAULT_ADDR, amount_usdc: 50 })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("ceoWithdraw");
    expect(result.amount_usdc).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2SetLimits
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2SetLimits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("sets per-tx and daily limits", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleVaultV2SetLimits({ vault_address: VAULT_ADDR, max_per_tx_usdc: 50, daily_limit_usdc: 500 })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("setLimits");
    expect(result.max_per_tx_usdc).toBe(50);
    expect(result.daily_limit_usdc).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2Pause
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2Pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("pauses vault", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleVaultV2Pause({ vault_address: VAULT_ADDR, paused: true })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("pause");
  });

  it("unpauses vault", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleVaultV2Pause({ vault_address: VAULT_ADDR, paused: false })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("unpause");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2Finalize
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2Finalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("finalizes dissolution", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleVaultV2Finalize({ vault_address: VAULT_ADDR })
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("finalize");
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2DistributeRevenue
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2DistributeRevenue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("distributes revenue", async () => {
    setupMocks();

    const result = JSON.parse(
      await handleVaultV2DistributeRevenue({ vault_address: VAULT_ADDR, amount_usdc: 100 })
    );

    expect(result.success).toBe(true);
    expect(result.amount_usdc).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2Shareholders
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2Shareholders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("returns shareholder details", async () => {
    const shareholderData: Record<string, { balance: bigint; votes: bigint; pending: bigint }> = {
      [AGENT_ADDR]: { balance: 6_000n * (10n ** 18n), votes: 6_000n * (10n ** 18n), pending: 30_000_000n },
      [RECIPIENT]:  { balance: 4_000n * (10n ** 18n), votes: 4_000n * (10n ** 18n), pending: 20_000_000n },
    };

    const readContract = vi.fn().mockImplementation(({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      if (functionName === "shareToken") return Promise.resolve(TOKEN_ADDR);
      if (functionName === "totalSupply") return Promise.resolve(10_000n * (10n ** 18n));
      const addr = args?.[0] as string;
      const data = shareholderData[addr];
      if (functionName === "balanceOf") return Promise.resolve(data?.balance ?? 0n);
      if (functionName === "getVotes") return Promise.resolve(data?.votes ?? 0n);
      return Promise.resolve(0n);
    });

    setupMocks({ readContract });

    const result = JSON.parse(
      await handleVaultV2Shareholders({
        vault_address: VAULT_ADDR,
        shareholders: [AGENT_ADDR, RECIPIENT],
      })
    );

    expect(result.shareholders).toHaveLength(2);
    expect(result.shareholders[0].percentage).toBe("60.00");
    expect(result.shareholders[1].percentage).toBe("40.00");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleVaultV2DissolveStatus
// ─────────────────────────────────────────────────────────────────────────────

describe("handleVaultV2DissolveStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("returns dissolution details with payout amounts", async () => {
    const dissolveData: Record<string, { balance: bigint }> = {
      [AGENT_ADDR]: { balance: 6_000n * (10n ** 18n) },
      [RECIPIENT]:  { balance: 4_000n * (10n ** 18n) },
    };

    const readContract = vi.fn().mockImplementation(({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      if (functionName === "vaultState") return Promise.resolve(2);
      if (functionName === "dissolutionPool") return Promise.resolve(200_000_000n);
      if (functionName === "shareToken") return Promise.resolve(TOKEN_ADDR);
      if (functionName === "totalSupply") return Promise.resolve(10_000n * (10n ** 18n));
      if (functionName === "frozen") return Promise.resolve(true);
      const addr = args?.[0] as string;
      const data = dissolveData[addr];
      if (functionName === "balanceOf") return Promise.resolve(data?.balance ?? 0n);
      return Promise.resolve(0n);
    });

    setupMocks({ readContract });

    const result = JSON.parse(
      await handleVaultV2DissolveStatus({
        vault_address: VAULT_ADDR,
        shareholders: [AGENT_ADDR, RECIPIENT],
      })
    );

    expect(result.state).toBe("Dissolved");
    expect(result.dissolution_pool_usdc).toBe("200.000000");
    expect(result.token_frozen).toBe(true);
    expect(result.shareholders[0].payout_usdc).toBe("120.000000"); // 60% of 200
    expect(result.shareholders[1].payout_usdc).toBe("80.000000");  // 40% of 200
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transaction failure handling
// ─────────────────────────────────────────────────────────────────────────────

describe("Transaction failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  });

  it("v2_ceo_transfer returns success=false on reverted tx", async () => {
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "reverted" });
    setupMocks({ waitForTransactionReceipt });

    const result = JSON.parse(
      await handleVaultV2CeoTransfer({ vault_address: VAULT_ADDR, to: RECIPIENT, amount_usdc: 5 })
    );

    expect(result.success).toBe(false);
  });

  it("v2_deposit returns success=false on reverted deposit tx", async () => {
    const waitForTransactionReceipt = vi.fn()
      .mockResolvedValueOnce({ status: "success" })   // approve succeeds
      .mockResolvedValueOnce({ status: "reverted" });  // deposit reverts
    setupMocks({ waitForTransactionReceipt });

    const result = JSON.parse(
      await handleVaultV2Deposit({ vault_address: VAULT_ADDR, amount_usdc: 10 })
    );

    expect(result.success).toBe(false);
  });

  it("v2_pause returns success=false on reverted tx", async () => {
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "reverted" });
    setupMocks({ waitForTransactionReceipt });

    const result = JSON.parse(
      await handleVaultV2Pause({ vault_address: VAULT_ADDR, paused: true })
    );

    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Missing private key
// ─────────────────────────────────────────────────────────────────────────────

describe("Missing private key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.X402_PAYER_PRIVATE_KEY;
  });

  it("v2_transfer throws when no private key", async () => {
    await expect(
      handleVaultV2Transfer({ vault_address: VAULT_ADDR, to: RECIPIENT, amount_usdc: 5 })
    ).rejects.toThrow("X402_PAYER_PRIVATE_KEY");
  });

  it("v2_deposit throws when no private key", async () => {
    await expect(
      handleVaultV2Deposit({ vault_address: VAULT_ADDR, amount_usdc: 10 })
    ).rejects.toThrow("X402_PAYER_PRIVATE_KEY");
  });
});
