import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/circle/gateway-sdk.js", () => ({
  initiateDepositFromCustodialWallet: vi.fn(),
  withdrawFromCustodialWallet: vi.fn(),
}));

vi.mock("../lib/supabase/client.js", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

vi.mock("../lib/circle/create-gateway-eoa-wallets.js", () => ({
  getOrCreateGatewayEOAWallet: vi.fn().mockResolvedValue({
    walletId: "eoa-wallet-123",
    address: "0xDeAd000000000000000000000000000000000002",
  }),
}));

import { handleDepositUsdc, handleWithdrawUsdc } from "./deposit.js";
import {
  initiateDepositFromCustodialWallet,
  withdrawFromCustodialWallet,
} from "../lib/circle/gateway-sdk.js";

const mockDeposit = vi.mocked(initiateDepositFromCustodialWallet);
const mockWithdraw = vi.mocked(withdrawFromCustodialWallet);

describe("handleDepositUsdc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deposits USDC and returns success message with txHash", async () => {
    mockDeposit.mockResolvedValue(
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    );

    const result = await handleDepositUsdc({
      wallet_id: "wallet-abc",
      chain: "arcTestnet",
      amount_usdc: 10,
    });

    expect(result).toContain("USDC Deposit Successful");
    expect(result).toContain("10 USDC");
    expect(result).toContain("arcTestnet");
    expect(result).toContain("0xdeadbeef");
    expect(mockDeposit).toHaveBeenCalledWith(
      "wallet-abc",
      "arcTestnet",
      BigInt(10_000_000), // 10 USDC in atomic units
      undefined // no delegate
    );
  });

  it("converts amount correctly to atomic units", async () => {
    mockDeposit.mockResolvedValue("0xabc");

    await handleDepositUsdc({
      wallet_id: "wallet-abc",
      chain: "baseSepolia",
      amount_usdc: 5.5,
    });

    expect(mockDeposit).toHaveBeenCalledWith(
      "wallet-abc",
      "baseSepolia",
      BigInt(5_500_000), // 5.5 USDC
      undefined
    );
  });

  it("sets up EOA delegate when user_id provided", async () => {
    mockDeposit.mockResolvedValue("0xabc");
    const { getOrCreateGatewayEOAWallet } = await import(
      "../lib/circle/create-gateway-eoa-wallets.js"
    );

    const result = await handleDepositUsdc({
      wallet_id: "wallet-abc",
      chain: "arcTestnet",
      amount_usdc: 10,
      user_id: "user-123",
    });

    expect(getOrCreateGatewayEOAWallet).toHaveBeenCalledWith(
      "user-123",
      "ARC-TESTNET"
    );
    expect(mockDeposit).toHaveBeenCalledWith(
      "wallet-abc",
      "arcTestnet",
      BigInt(10_000_000),
      "0xDeAd000000000000000000000000000000000002" // delegate address
    );
    expect(result).toContain("EOA Delegate Set");
  });

  it("throws on invalid chain", async () => {
    await expect(
      handleDepositUsdc({
        wallet_id: "wallet-abc",
        chain: "mainnet" as "arcTestnet",
        amount_usdc: 10,
      })
    ).rejects.toThrow();
  });

  it("throws on zero or negative amount", async () => {
    await expect(
      handleDepositUsdc({
        wallet_id: "wallet-abc",
        chain: "arcTestnet",
        amount_usdc: 0,
      })
    ).rejects.toThrow();

    await expect(
      handleDepositUsdc({
        wallet_id: "wallet-abc",
        chain: "arcTestnet",
        amount_usdc: -5,
      })
    ).rejects.toThrow();
  });

  it("propagates Circle SDK errors", async () => {
    mockDeposit.mockRejectedValue(
      new Error("Insufficient USDC balance")
    );

    await expect(
      handleDepositUsdc({
        wallet_id: "wallet-abc",
        chain: "arcTestnet",
        amount_usdc: 999999,
      })
    ).rejects.toThrow("Insufficient USDC balance");
  });
});

describe("handleWithdrawUsdc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initiates withdrawal and returns success message", async () => {
    mockWithdraw.mockResolvedValue("0xwithdrawtxhash");

    const result = await handleWithdrawUsdc({
      wallet_id: "wallet-abc",
      chain: "baseSepolia",
      amount_usdc: 5,
    });

    expect(result).toContain("Withdrawal Initiated");
    expect(result).toContain("5 USDC");
    expect(result).toContain("baseSepolia");
    expect(result).toContain("0xwithdrawtxhash");
    expect(result).toContain("delay period");
    expect(mockWithdraw).toHaveBeenCalledWith(
      "wallet-abc",
      "baseSepolia",
      BigInt(5_000_000)
    );
  });

  it("throws on unsupported chain", async () => {
    await expect(
      handleWithdrawUsdc({
        wallet_id: "wallet-abc",
        chain: "polygon" as "arcTestnet",
        amount_usdc: 5,
      })
    ).rejects.toThrow();
  });
});
