import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/circle/gateway-sdk.js", () => ({
  fetchGatewayInfo: vi.fn(),
  DOMAIN_IDS: { avalancheFuji: 1, baseSepolia: 6, arcTestnet: 26 },
  CHAIN_BY_DOMAIN: { 26: "arcTestnet", 6: "baseSepolia", 1: "avalancheFuji" },
  USDC_ADDRESSES: {
    arcTestnet: "0x3600000000000000000000000000000000000000",
    avalancheFuji: "0x5425890298aed601595a70ab815c96711a31bc65",
    baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
  CIRCLE_CHAIN_NAMES: {
    avalancheFuji: "AVAX-FUJI",
    baseSepolia: "BASE-SEPOLIA",
    arcTestnet: "ARC-TESTNET",
  },
}));

import {
  handleGetGatewayInfo,
  handleGetSupportedChains,
  handleGetTransferStatus,
} from "./gateway.js";
import { fetchGatewayInfo } from "../lib/circle/gateway-sdk.js";

const mockFetchGatewayInfo = vi.mocked(fetchGatewayInfo);

const mockGatewayInfoResponse = {
  version: 1,
  domains: [
    {
      chain: "ARC",
      network: "testnet",
      domain: 26,
      walletContract: {
        address: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        supportedTokens: ["USDC"],
      },
      minterContract: {
        address: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
        supportedTokens: ["USDC"],
      },
      processedHeight: "1000000",
      burnIntentExpirationHeight: "100",
    },
    {
      chain: "BASE",
      network: "sepolia",
      domain: 6,
      walletContract: {
        address: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        supportedTokens: ["USDC"],
      },
      minterContract: {
        address: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
        supportedTokens: ["USDC"],
      },
      processedHeight: "500000",
      burnIntentExpirationHeight: "100",
    },
  ],
};

describe("handleGetGatewayInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns formatted gateway info with version and domains", async () => {
    mockFetchGatewayInfo.mockResolvedValue(mockGatewayInfoResponse);

    const result = await handleGetGatewayInfo();

    expect(result).toContain("Circle Gateway Info");
    expect(result).toContain("**Version**: 1");
    expect(result).toContain("**Domains**: 2");
    expect(result).toContain("ARC");
    expect(result).toContain("BASE");
    expect(result).toContain("0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
    expect(result).toContain("USDC");
  });

  it("shows domain IDs and block heights", async () => {
    mockFetchGatewayInfo.mockResolvedValue(mockGatewayInfoResponse);

    const result = await handleGetGatewayInfo();

    expect(result).toContain("26");
    expect(result).toContain("1000000");
  });

  it("propagates API errors", async () => {
    mockFetchGatewayInfo.mockRejectedValue(
      new Error("Gateway API error: 503")
    );

    await expect(handleGetGatewayInfo()).rejects.toThrow("Gateway API error");
  });
});

describe("handleGetSupportedChains", () => {
  it("returns table with all three chains", async () => {
    const result = await handleGetSupportedChains();

    expect(result).toContain("arcTestnet");
    expect(result).toContain("baseSepolia");
    expect(result).toContain("avalancheFuji");
    expect(result).toContain("26");  // Arc domain ID
    expect(result).toContain("6");   // Base domain ID
    expect(result).toContain("1");   // Avax domain ID
    expect(result).toContain("ARC-TESTNET");
    expect(result).toContain("BASE-SEPOLIA");
    expect(result).toContain("AVAX-FUJI");
  });

  it("shows USDC addresses", async () => {
    const result = await handleGetSupportedChains();

    expect(result).toContain("0x3600000000000000000000000000000000000000");
    expect(result).toContain("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  });

  it("shows Gateway contract addresses", async () => {
    const result = await handleGetSupportedChains();

    expect(result).toContain("0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
    expect(result).toContain("0x0022222ABE238Cc2C7Bb1f21003F0a260052475B");
  });
});

describe("handleGetTransferStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns transfer status with chain info and amount", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "COMPLETE",
        sourceDomain: 26,
        destinationDomain: 6,
        amount: "5000000",
        attestation: "0xabcdef1234567890abcdef1234567890abcdef12",
        signature: "0xfedcba0987654321fedcba0987654321fedcba09",
      }),
    }) as unknown as typeof fetch;

    const result = await handleGetTransferStatus({
      transfer_id: "transfer-123",
    });

    expect(result).toContain("Transfer Status");
    expect(result).toContain("transfer-123");
    expect(result).toContain("COMPLETE");
    expect(result).toContain("arcTestnet");
    expect(result).toContain("baseSepolia");
    expect(result).toContain("5.000000 USDC");
    expect(result).toContain("0xabcdef");
  });

  it("returns status without chain info when domains missing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "PENDING",
      }),
    }) as unknown as typeof fetch;

    const result = await handleGetTransferStatus({
      transfer_id: "transfer-456",
    });

    expect(result).toContain("PENDING");
    expect(result).toContain("transfer-456");
    expect(result).not.toContain("Source");
  });

  it("throws when API returns error status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "Transfer not found",
    }) as unknown as typeof fetch;

    await expect(
      handleGetTransferStatus({ transfer_id: "nonexistent" })
    ).rejects.toThrow("Gateway API error: 404");
  });

  it("throws on empty transfer_id", async () => {
    await expect(
      handleGetTransferStatus({ transfer_id: "" })
    ).rejects.toThrow();
  });
});
