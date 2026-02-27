/**
 * Shared mock for Circle Developer SDK responses
 */

export const mockWallet = {
  id: "wallet-abc-123",
  address: "0xDeAd000000000000000000000000000000000001",
  blockchain: "ARC-TESTNET",
  state: "LIVE",
  name: "Test Wallet",
};

export const mockWalletSet = {
  id: "wset-abc-123",
  name: "Test Wallet Set",
  custodyType: "DEVELOPER",
};

export const mockTransaction = {
  id: "challenge-abc",
  state: "COMPLETE",
  txHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  errorReason: null,
};

export const mockEoaWalletRow = {
  circle_wallet_id: "eoa-wallet-123",
  address: "0xDeAd000000000000000000000000000000000002",
  blockchain: "MULTICHAIN",
  name: "Gateway Signer (Multichain)",
};

export const mockTransactionHistory = [
  {
    id: "tx-1",
    user_id: "user-123",
    chain: "arcTestnet",
    tx_type: "deposit",
    amount: 10,
    tx_hash: "0xabc",
    gateway_wallet_address: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    destination_chain: null,
    status: "success",
    reason: null,
    created_at: "2026-02-27T10:00:00Z",
  },
  {
    id: "tx-2",
    user_id: "user-123",
    chain: "baseSepolia",
    tx_type: "transfer",
    amount: 5,
    tx_hash: "0xdef",
    gateway_wallet_address: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    destination_chain: "avalancheFuji",
    status: "success",
    reason: null,
    created_at: "2026-02-27T09:00:00Z",
  },
];
