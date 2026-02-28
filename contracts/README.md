# OTTOVault — On-Chain Treasury Contract

Solidity smart contract for OTTO's treasury. Enforces spending limits at the EVM level —
limits that no prompt injection or AI compromise can override.

## Deployed

| Chain | Address | USDC |
|-------|---------|------|
| Arc Testnet (5042002) | [`0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA`](https://explorer.testnet.arc.network/address/0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA) | `0x3600...0000` |
| Base Sepolia (84532) | [`0x47C1feaC66381410f5B050c39F67f15BbD058Af1`](https://sepolia.basescan.org/address/0x47C1feaC66381410f5B050c39F67f15BbD058Af1) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Avalanche Fuji (43113) | [`0x47C1feaC66381410f5B050c39F67f15BbD058Af1`](https://testnet.snowtrace.io/address/0x47C1feaC66381410f5B050c39F67f15BbD058Af1) | `0x5425890298aed601595a70ab815c96711a31bc65` |

## Security Model

- **Admin**: sets limits, manages whitelist, can pause, can emergency-withdraw
- **Agent** (OTTO): restricted to `transfer()` within hard on-chain limits
- **Per-tx cap**: 10 USDC (configurable by admin)
- **Daily cap**: 100 USDC / 24h rolling window (configurable)
- **Whitelist**: optional recipient allowlist
- **Pause**: admin emergency stop — halts all agent transfers immediately

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
