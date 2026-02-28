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
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(),
    http: vi.fn(() => "http-transport"),
  };
});

// ── Imports ───────────────────────────────────────────────────────────────────

import { handleStorkPrice, handleStorkOnChainPrice } from "./stork.js";
import { createPublicClient } from "viem";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleStorkPrice", () => {
  beforeEach(() => {
    delete process.env.STORK_API_KEY;
    vi.restoreAllMocks();
  });

  it("returns mock data when STORK_API_KEY is not set", async () => {
    const result = JSON.parse(await handleStorkPrice({}));
    expect(result.source).toBe("mock (Stork unavailable)");
    expect(result.asset).toBe("ETHUSD");
    expect(typeof result.price).toBe("number");
    expect(result.note).toContain("STORK_API_KEY not set");
  });

  it("uses custom assets parameter", async () => {
    const result = JSON.parse(await handleStorkPrice({ assets: "BTCUSD" }));
    expect(result.asset).toBe("BTCUSD");
    expect(result.source).toBe("mock (Stork unavailable)");
  });

  it("returns Stork data when API key is set and response is valid", async () => {
    process.env.STORK_API_KEY = "test-key";
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          ETHUSD: {
            price: "2847.42",
            timestamp_ns: 1709120000000000000,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = JSON.parse(await handleStorkPrice({}));
    expect(result.source).toBe("Stork Oracle");
    expect(result.asset).toBe("ETHUSD");
    expect(result.price).toBe(2847.42);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("assets=ETHUSD"),
      expect.objectContaining({
        headers: { Authorization: "Basic test-key" },
      })
    );

    vi.unstubAllGlobals();
  });

  it("falls back to mock when API returns non-ok status", async () => {
    process.env.STORK_API_KEY = "test-key";
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = JSON.parse(await handleStorkPrice({}));
    expect(result.source).toBe("mock (Stork unavailable)");
    expect(result.note).toContain("Stork API returned 401");

    vi.unstubAllGlobals();
  });

  it("falls back to mock when fetch throws", async () => {
    process.env.STORK_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Network error")));

    const result = JSON.parse(await handleStorkPrice({}));
    expect(result.source).toBe("mock (Stork unavailable)");
    expect(result.note).toContain("Network error");

    vi.unstubAllGlobals();
  });
});

describe("handleStorkOnChainPrice", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads price from on-chain contract", async () => {
    const mockReadContract = vi.fn().mockResolvedValueOnce([
      1709120000000000000n, // timestampNs
      2847420000000000000000n, // quantizedValue (18 decimals)
    ]);
    (createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: mockReadContract,
    });

    const result = JSON.parse(await handleStorkOnChainPrice({ asset: "ETHUSD" }));
    expect(result.asset).toBe("ETHUSD");
    expect(result.source).toContain("Stork On-Chain");
    expect(typeof result.price).toBe("number");
    expect(result.contract).toBe("0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62");
  });

  it("returns error when contract read fails", async () => {
    (createPublicClient as ReturnType<typeof vi.fn>).mockReturnValue({
      readContract: vi.fn().mockRejectedValueOnce(new Error("Contract not deployed")),
    });

    const result = JSON.parse(await handleStorkOnChainPrice({ asset: "ETHUSD", chain: "arcTestnet" }));
    expect(result.error).toContain("Contract not deployed");
    expect(result.hint).toContain("arcTestnet");
  });

  it("throws on unsupported chain", async () => {
    await expect(
      handleStorkOnChainPrice({ chain: "invalidChain" })
    ).rejects.toThrow("Unsupported chain");
  });
});
