# OTTOVaultV2 — On-Chain Treasury Contracts

Solidity smart contracts for OTTO's treasury. Enforces spending limits at the EVM level —
limits that no prompt injection or AI compromise can override. V2 adds multi-sig governance
via ShareToken + Governor — vaults are created per-user through OTTORegistry.

## Deployed (Arc Testnet, chainId 5042002)

### Infrastructure (Factory + sub-deployers)

| Contract | Address |
|----------|---------|
| OTTOVaultFactoryV2 | [`0x9edebee1DfEd0E2727A1Ec64cbB4814A3AEaceCe`](https://testnet.arcscan.app/address/0x9edebee1DfEd0E2727A1Ec64cbB4814A3AEaceCe) |
| OTTORegistry | [`0xbACA262d37A956651E3b35271AF76Bb4eDfc1e67`](https://testnet.arcscan.app/address/0xbACA262d37A956651E3b35271AF76Bb4eDfc1e67) |
| OTTOTokenDeployer | [`0x1A0D1670405B1F193F384C51647a0b4026D0c34b`](https://testnet.arcscan.app/address/0x1A0D1670405B1F193F384C51647a0b4026D0c34b) |
| OTTOGovernorDeployer | [`0x871030f39f386930F3BF951d70371816e9C8b1bd`](https://testnet.arcscan.app/address/0x871030f39f386930F3BF951d70371816e9C8b1bd) |
| OTTOVaultDeployer | [`0x07f135206cb3a3a3140e1baBa0953a41214A9825`](https://testnet.arcscan.app/address/0x07f135206cb3a3a3140e1baBa0953a41214A9825) |

Individual vaults (VaultV2 + ShareToken + Governor) are deployed per-user via `factory.deploy()`.

## Security Model

- **Shareholders**: hold ShareToken, govern vault via Governor (proposals, votes)
- **Agent** (OTTO): restricted to `transfer()` within hard on-chain limits
- **Per-tx cap**: 10 USDC (configurable by shareholders)
- **Daily cap**: 100 USDC / 24h rolling window (configurable)
- **Whitelist**: optional recipient allowlist
- **Pause**: shareholders can halt all agent transfers immediately

## Stack

- Solidity 0.8.20, OpenZeppelin (SafeERC20, ReentrancyGuard), Foundry

## Usage

```bash
forge install && forge test -v
```

Deploy (set `USDC_ADDRESS` per chain):
```bash
export AGENT_ADDRESS=<agent_wallet>
export DEPLOYER_PRIVATE_KEY=<private_key>

# Arc Testnet (default USDC)
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast

# Base Sepolia
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast

# Avalanche Fuji
USDC_ADDRESS=0x5425890298aed601595a70ab815c96711a31bc65 \
forge script script/Deploy.s.sol --rpc-url https://api.avax-test.network/ext/bc/C/rpc --broadcast
```

## Tests

17/17 passing. See `test/OTTOVault.t.sol`.
