import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/circle/gateway-sdk.js", () => ({
  arcTestnet: {
    id: 5042002,
    name: "Arc Testnet",
    rpcUrls: { default: { http: ["https://rpc.blockdaemon.testnet.arc.network"] } },
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorers: { default: { url: "https://explorer.testnet.arc.network" } },
  },
  USDC_ADDRESSES: {
    arcTestnet: "0x3600000000000000000000000000000000000000",
    baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    avalancheFuji: "0x5425890298aed601595a70ab815c96711a31bc65",
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

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  handleUsycRate,
  handleUsycBalance,
  handleUsycDeposit,
  handleUsycRedeem,
} from "./usyc.js";
import { createPublicClient, createWalletClient } from "viem";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleUsycRate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns rate from Hashnote API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ price: 1.0485, apy: "4.85%" }),
    }));

    const result = JSON.parse(await handleUsycRate());
    expect(result.source).toBe("Hashnote");
    expect(result.rate).toBe(1.0485);

    vi.unstubAllGlobals();
  });

  it("returns error when API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
    }));

    const result = JSON.parse(await handleUsycRate());
    expect(result.error).toContain("503");

    vi.unstubAllGlobals();
  });

  it("returns error when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Network down")));

    const result = JSON.parse(await handleUsycRate());
    expect(result.error).toContain("Network down");

    vi.unstubAllGlobals();
  });
});

describe("handleUsycBalance", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  });

  it("returns USYC balance for address", async () => {
    const mockReadContract = vi.fn()
      .mockResolvedValueOnce(5000000n) // balanceOf: 5 USYC
      .mockResolvedValueOnce(6n);      // decimals: 6
    (createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract,
    });

    // Mock rate API for USD value
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ price: 1.05 }),
    }));

    const result = JSON.parse(await handleUsycBalance({
      address: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
      chain: "arcTestnet",
    }));
    expect(result.usyc_balance).toBe("5.000000");
    expect(result.usdc_value).toBe("5.25");
    expect(result.chain).toBe("arcTestnet");

    vi.unstubAllGlobals();
  });

  it("returns zero balance correctly", async () => {
    const mockReadContract = vi.fn()
      .mockResolvedValueOnce(0n)  // balanceOf: 0
      .mockResolvedValueOnce(6n); // decimals: 6
    (createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract,
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ price: 1.05 }),
    }));

    const result = JSON.parse(await handleUsycBalance({ chain: "arcTestnet" }));
    expect(result.usyc_balance).toBe("0.000000");
    expect(result.usdc_value).toBe("0.00");

    vi.unstubAllGlobals();
  });

  it("throws when USYC is not deployed on chain", async () => {
    const result = JSON.parse(await handleUsycBalance({ chain: "baseSepolia" }).catch(
      (e: Error) => JSON.stringify({ error: e.message })
    ));
    expect(result.error).toContain("not deployed");
  });
});

describe("handleUsycDeposit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  });

  it("returns error when USDC balance is insufficient", async () => {
    (createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: vi.fn().mockResolvedValueOnce(1000000n), // only 1 USDC
    });

    const result = JSON.parse(await handleUsycDeposit({ amount_usdc: 100 }));
    expect(result.error).toBe("Insufficient USDC balance");
    expect(result.required).toBe("100.000000");
    expect(result.available).toBe("1.000000");
  });

  it("succeeds with approve + buy flow", async () => {
    const mockReadContract = vi.fn()
      .mockResolvedValueOnce(200000000n); // 200 USDC balance
    const mockWaitForTx = vi.fn()
      .mockResolvedValueOnce({}) // approve receipt
      .mockResolvedValueOnce({ status: "success" }); // buy receipt
    const mockWriteContract = vi.fn()
      .mockResolvedValueOnce("0xapprove_hash")
      .mockResolvedValueOnce("0xbuy_hash");

    (createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract,
      waitForTransactionReceipt: mockWaitForTx,
    });
    (createWalletClient as ReturnType<typeof vi.fn>).mockReturnValue({
      writeContract: mockWriteContract,
    });

    const result = JSON.parse(await handleUsycDeposit({ amount_usdc: 50 }));
    expect(result.success).toBe(true);
    expect(result.tx_hash).toBe("0xbuy_hash");
    expect(result.approve_tx).toBe("0xapprove_hash");
    expect(result.amount_usdc).toBe(50);
  });

  it("throws when amount is zero", async () => {
    await expect(handleUsycDeposit({ amount_usdc: 0 })).rejects.toThrow("positive");
  });
});

describe("handleUsycRedeem", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.X402_PAYER_PRIVATE_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  });

  it("returns error when USYC balance is insufficient", async () => {
    (createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: vi.fn().mockResolvedValueOnce(1000000n), // only 1 USYC
    });

    const result = JSON.parse(await handleUsycRedeem({ amount_usyc: 100 }));
    expect(result.error).toBe("Insufficient USYC balance");
  });

  it("succeeds with sell flow", async () => {
    (createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: vi.fn().mockResolvedValueOnce(200000000n), // 200 USYC
      waitForTransactionReceipt: vi.fn().mockResolvedValueOnce({ status: "success" }),
    });
    (createWalletClient as ReturnType<typeof vi.fn>).mockReturnValue({
      writeContract: vi.fn().mockResolvedValueOnce("0xsell_hash"),
    });

    const result = JSON.parse(await handleUsycRedeem({ amount_usyc: 50 }));
    expect(result.success).toBe(true);
    expect(result.tx_hash).toBe("0xsell_hash");
    expect(result.amount_usyc).toBe(50);
  });

  it("throws when amount is negative", async () => {
    await expect(handleUsycRedeem({ amount_usyc: -5 })).rejects.toThrow("positive");
  });
});
