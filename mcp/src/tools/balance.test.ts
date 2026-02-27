import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock lib modules before importing tools
vi.mock("../lib/circle/gateway-sdk.js", () => ({
  fetchGatewayBalance: vi.fn(),
  getUsdcBalance: vi.fn(),
  checkWalletGasBalance: vi.fn(),
  CHAIN_BY_DOMAIN: { 26: "arcTestnet", 6: "baseSepolia", 1: "avalancheFuji" },
}));

import {
  handleGetGatewayBalance,
  handleGetUsdcBalance,
  handleCheckWalletGas,
} from "./balance.js";
import {
  fetchGatewayBalance,
  getUsdcBalance,
  checkWalletGasBalance,
} from "../lib/circle/gateway-sdk.js";

const mockFetchGatewayBalance = vi.mocked(fetchGatewayBalance);
const mockGetUsdcBalance = vi.mocked(getUsdcBalance);
const mockCheckWalletGasBalance = vi.mocked(checkWalletGasBalance);

describe("handleGetGatewayBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns formatted unified balance across all domains", async () => {
    mockFetchGatewayBalance.mockResolvedValue({
      token: "USDC",
      balances: [
        { domain: 26, depositor: "0x123", balance: "10000000" }, // 10 USDC
        { domain: 6, depositor: "0x123", balance: "5000000" },   // 5 USDC
        { domain: 1, depositor: "0x123", balance: "0" },         // 0 USDC
      ],
    });

    const result = await handleGetGatewayBalance({
      address: "0x1234567890123456789012345678901234567890",
    });

    expect(result).toContain("Arc Testnet");
    expect(result).toContain("10.000000 USDC");
    expect(result).toContain("Base Sepolia");
    expect(result).toContain("5.000000 USDC");
    expect(result).toContain("Total Unified Balance");
    expect(result).toContain("15.000000 USDC");
  });

  it("handles zero balances", async () => {
    mockFetchGatewayBalance.mockResolvedValue({
      token: "USDC",
      balances: [
        { domain: 26, depositor: "0x123", balance: "0" },
        { domain: 6, depositor: "0x123", balance: "0" },
        { domain: 1, depositor: "0x123", balance: "0" },
      ],
    });

    const result = await handleGetGatewayBalance({
      address: "0x1234567890123456789012345678901234567890",
    });

    expect(result).toContain("0.000000 USDC");
    expect(result).toContain("Total Unified Balance");
  });

  it("throws on invalid address format", async () => {
    await expect(
      handleGetGatewayBalance({ address: "not-an-address" })
    ).rejects.toThrow();
  });

  it("propagates Gateway API errors", async () => {
    mockFetchGatewayBalance.mockRejectedValue(
      new Error("Gateway API error: 500")
    );

    await expect(
      handleGetGatewayBalance({
        address: "0x1234567890123456789012345678901234567890",
      })
    ).rejects.toThrow("Gateway API error: 500");
  });
});

describe("handleGetUsdcBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns formatted on-chain USDC balance", async () => {
    mockGetUsdcBalance.mockResolvedValue(BigInt(7_500_000)); // 7.5 USDC

    const result = await handleGetUsdcBalance({
      address: "0x1234567890123456789012345678901234567890",
      chain: "baseSepolia",
    });

    expect(result).toContain("7.500000 USDC");
    expect(result).toContain("baseSepolia");
    expect(result).toContain("7500000"); // atomic units
  });

  it("handles zero balance", async () => {
    mockGetUsdcBalance.mockResolvedValue(BigInt(0));

    const result = await handleGetUsdcBalance({
      address: "0x1234567890123456789012345678901234567890",
      chain: "arcTestnet",
    });

    expect(result).toContain("0.000000 USDC");
  });

  it("throws on unsupported chain", async () => {
    await expect(
      handleGetUsdcBalance({
        address: "0x1234567890123456789012345678901234567890",
        chain: "mainnet" as "arcTestnet",
      })
    ).rejects.toThrow();
  });

  it("throws on invalid address", async () => {
    await expect(
      handleGetUsdcBalance({
        address: "invalid",
        chain: "baseSepolia",
      })
    ).rejects.toThrow();
  });
});

describe("handleCheckWalletGas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Yes' when wallet has gas", async () => {
    mockCheckWalletGasBalance.mockResolvedValue({
      hasGas: true,
      address: "0xDeAd000000000000000000000000000000000001",
      balance: "100000000000000000", // 0.1 ETH
    });

    const result = await handleCheckWalletGas({
      wallet_id: "wallet-abc",
      chain: "baseSepolia",
    });

    expect(result).toContain("Yes");
    expect(result).toContain("wallet-abc");
    expect(result).toContain("baseSepolia");
    expect(result).toContain("ETH");
  });

  it("shows 'No' when wallet has no gas", async () => {
    mockCheckWalletGasBalance.mockResolvedValue({
      hasGas: false,
      address: "0xDeAd000000000000000000000000000000000001",
      balance: "0",
    });

    const result = await handleCheckWalletGas({
      wallet_id: "wallet-abc",
      chain: "baseSepolia",
    });

    expect(result).toContain("No");
    expect(result).toContain("needs funding");
  });

  it("shows AVAX for avalancheFuji", async () => {
    mockCheckWalletGasBalance.mockResolvedValue({
      hasGas: true,
      address: "0xDeAd000000000000000000000000000000000001",
      balance: "50000000000000000",
    });

    const result = await handleCheckWalletGas({
      wallet_id: "wallet-abc",
      chain: "avalancheFuji",
    });

    expect(result).toContain("AVAX");
  });

  it("throws on missing wallet_id", async () => {
    await expect(
      handleCheckWalletGas({ wallet_id: "", chain: "baseSepolia" })
    ).rejects.toThrow();
  });
});
