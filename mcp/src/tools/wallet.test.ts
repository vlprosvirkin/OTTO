import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mockWallet,
  mockWalletSet,
  mockTransactionHistory,
  mockEoaWalletRow,
} from "../__mocks__/circle-sdk.js";

const mockInsert = vi.fn().mockResolvedValue({ data: [], error: null });
const mockUpsert = vi.fn().mockResolvedValue({ data: [], error: null });
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockSingle = vi.fn();

// Chain mockable Supabase query builder
function makeQueryBuilder(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    insert: vi.fn().mockResolvedValue({ data, error }),
    upsert: vi.fn().mockResolvedValue({ data, error }),
    then: undefined as unknown,
  };
  // Make it thenable for direct await
  (builder as { data?: unknown; error?: unknown }).data = data;
  return builder;
}

vi.mock("../lib/circle/sdk.js", () => ({
  circleDeveloperSdk: {
    createWalletSet: vi.fn(),
    createWallets: vi.fn(),
    getWallet: vi.fn(),
  },
}));

vi.mock("../lib/supabase/client.js", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock("../lib/circle/create-gateway-eoa-wallets.js", () => ({
  getOrCreateGatewayEOAWallet: vi.fn(),
  listGatewayEOAWallets: vi.fn(),
}));

import {
  handleCreateWalletSet,
  handleCreateMultichainWallet,
  handleGetWalletInfo,
  handleGetEoaWallets,
  handleGetTransactionHistory,
  handleGetUserWallets,
} from "./wallet.js";
import { circleDeveloperSdk } from "../lib/circle/sdk.js";
import { supabase } from "../lib/supabase/client.js";
import { listGatewayEOAWallets } from "../lib/circle/create-gateway-eoa-wallets.js";

const mockSdk = vi.mocked(circleDeveloperSdk);
const mockSupabase = vi.mocked(supabase);
const mockListEoa = vi.mocked(listGatewayEOAWallets);

describe("handleCreateWalletSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a wallet set and returns its ID", async () => {
    mockSdk.createWalletSet.mockResolvedValue({
      data: { walletSet: mockWalletSet },
    } as ReturnType<typeof mockSdk.createWalletSet>);

    const result = await handleCreateWalletSet({ name: "My Wallet Set" });

    expect(result).toContain("Wallet Set Created");
    expect(result).toContain(mockWalletSet.id);
    expect(result).toContain("create_multichain_wallet");
    expect(mockSdk.createWalletSet).toHaveBeenCalledWith({
      name: "My Wallet Set",
    });
  });

  it("throws when Circle API returns no walletSet", async () => {
    mockSdk.createWalletSet.mockResolvedValue({
      data: null,
    } as ReturnType<typeof mockSdk.createWalletSet>);

    await expect(
      handleCreateWalletSet({ name: "Test" })
    ).rejects.toThrow("no data returned");
  });

  it("throws on empty name", async () => {
    await expect(
      handleCreateWalletSet({ name: "" })
    ).rejects.toThrow();
  });
});

describe("handleCreateMultichainWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates wallets on all three chains", async () => {
    const wallets = [
      { ...mockWallet, blockchain: "ARC-TESTNET", id: "w1" },
      { ...mockWallet, blockchain: "BASE-SEPOLIA", id: "w2" },
      { ...mockWallet, blockchain: "AVAX-FUJI", id: "w3" },
    ];
    mockSdk.createWallets.mockResolvedValue({
      data: { wallets },
    } as ReturnType<typeof mockSdk.createWallets>);

    const result = await handleCreateMultichainWallet({
      wallet_set_id: "wset-abc",
    });

    expect(result).toContain("Multichain SCA Wallets Created");
    expect(result).toContain("ARC-TESTNET");
    expect(result).toContain("BASE-SEPOLIA");
    expect(result).toContain("AVAX-FUJI");
    expect(mockSdk.createWallets).toHaveBeenCalledWith({
      walletSetId: "wset-abc",
      accountType: "SCA",
      blockchains: ["ARC-TESTNET", "BASE-SEPOLIA", "AVAX-FUJI"],
      count: 1,
    });
  });

  it("stores wallets in Supabase when user_id provided", async () => {
    const wallets = [{ ...mockWallet, blockchain: "ARC-TESTNET", id: "w1" }];
    mockSdk.createWallets.mockResolvedValue({
      data: { wallets },
    } as ReturnType<typeof mockSdk.createWallets>);

    const upsertMock = vi.fn().mockResolvedValue({ data: [], error: null });
    mockSupabase.from.mockReturnValue({ upsert: upsertMock } as ReturnType<typeof mockSupabase.from>);

    await handleCreateMultichainWallet({
      wallet_set_id: "wset-abc",
      user_id: "user-123",
    });

    expect(mockSupabase.from).toHaveBeenCalledWith("wallets");
    expect(upsertMock).toHaveBeenCalled();
  });

  it("throws when no wallets returned", async () => {
    mockSdk.createWallets.mockResolvedValue({
      data: { wallets: [] },
    } as ReturnType<typeof mockSdk.createWallets>);

    await expect(
      handleCreateMultichainWallet({ wallet_set_id: "wset-abc" })
    ).rejects.toThrow("no wallets returned");
  });
});

describe("handleGetWalletInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns wallet info", async () => {
    mockSdk.getWallet.mockResolvedValue({
      data: { wallet: mockWallet },
    } as ReturnType<typeof mockSdk.getWallet>);

    const result = await handleGetWalletInfo({ wallet_id: "wallet-abc-123" });

    expect(result).toContain("Wallet Information");
    expect(result).toContain(mockWallet.id);
    expect(result).toContain(mockWallet.address);
    expect(result).toContain(mockWallet.blockchain);
    expect(result).toContain("LIVE");
    expect(mockSdk.getWallet).toHaveBeenCalledWith({ id: "wallet-abc-123" });
  });

  it("throws when wallet not found", async () => {
    mockSdk.getWallet.mockResolvedValue({
      data: { wallet: null },
    } as ReturnType<typeof mockSdk.getWallet>);

    await expect(
      handleGetWalletInfo({ wallet_id: "nonexistent" })
    ).rejects.toThrow("not found");
  });

  it("throws on empty wallet_id", async () => {
    await expect(
      handleGetWalletInfo({ wallet_id: "" })
    ).rejects.toThrow();
  });
});

describe("handleGetEoaWallets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists EOA wallets for a user", async () => {
    mockListEoa.mockResolvedValue([mockEoaWalletRow]);

    const result = await handleGetEoaWallets({ user_id: "user-123" });

    expect(result).toContain("EOA Signer Wallets");
    expect(result).toContain(mockEoaWalletRow.address);
    expect(result).toContain(mockEoaWalletRow.circle_wallet_id);
    expect(mockListEoa).toHaveBeenCalledWith("user-123");
  });

  it("shows helpful message when no wallets found", async () => {
    mockListEoa.mockResolvedValue([]);

    const result = await handleGetEoaWallets({ user_id: "user-123" });

    expect(result).toContain("No EOA signer wallets found");
    expect(result).toContain("init_eoa_wallet");
  });

  it("throws on empty user_id", async () => {
    await expect(
      handleGetEoaWallets({ user_id: "" })
    ).rejects.toThrow();
  });
});

/**
 * Creates a thenable Supabase query builder mock.
 * All chaining methods (select, eq, order, limit) return `this`,
 * and `await builder` resolves to { data, error }.
 */
function makeSupabaseTxMock(data: unknown, error: unknown = null) {
  const resolved = { data, error };
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(resolved).then(resolve, reject),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve(resolved).catch(reject),
  };
  builder.select = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockReturnValue(builder);
  builder.order = vi.fn().mockReturnValue(builder);
  builder.limit = vi.fn().mockReturnValue(builder);
  return builder;
}

describe("handleGetTransactionHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns formatted transaction history", async () => {
    const qb = makeSupabaseTxMock(mockTransactionHistory);
    mockSupabase.from.mockReturnValue(qb as ReturnType<typeof mockSupabase.from>);

    const result = await handleGetTransactionHistory({ user_id: "user-123" });

    expect(result).toContain("Transaction History");
    expect(result).toContain("DEPOSIT");
    expect(result).toContain("TRANSFER");
    expect(result).toContain("10 USDC");
    expect(result).toContain("5 USDC");
    expect(result).toContain("arcTestnet");
    expect(result).toContain("avalancheFuji");
    expect(result).toContain("✓"); // success status
  });

  it("filters by tx_type when provided", async () => {
    const qb = makeSupabaseTxMock([mockTransactionHistory[0]]);
    mockSupabase.from.mockReturnValue(qb as ReturnType<typeof mockSupabase.from>);

    const result = await handleGetTransactionHistory({
      user_id: "user-123",
      tx_type: "deposit",
    });

    expect(result).toContain("DEPOSIT");
    // eq should have been called with tx_type filter after limit
    expect(vi.mocked(qb.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("tx_type", "deposit");
  });

  it("returns helpful message when no transactions found", async () => {
    const qb = makeSupabaseTxMock([]);
    mockSupabase.from.mockReturnValue(qb as ReturnType<typeof mockSupabase.from>);

    const result = await handleGetTransactionHistory({ user_id: "user-123" });

    expect(result).toContain("No transactions found");
  });

  it("throws when Supabase returns error", async () => {
    const qb = makeSupabaseTxMock(null, { message: "permission denied" });
    mockSupabase.from.mockReturnValue(qb as ReturnType<typeof mockSupabase.from>);

    await expect(
      handleGetTransactionHistory({ user_id: "user-123" })
    ).rejects.toThrow("permission denied");
  });

  it("throws on empty user_id", async () => {
    await expect(
      handleGetTransactionHistory({ user_id: "" })
    ).rejects.toThrow();
  });
});
