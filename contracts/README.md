# OTTOVault — On-Chain Treasury Contract

Solidity smart contract for OTTO's treasury. Enforces spending limits at the EVM level —
limits that no prompt injection or AI compromise can override.

## Deployed

| Chain | Address |
|-------|---------|
| Arc Testnet (5042002) | [`0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA`](https://explorer.testnet.arc.network/address/0xFFfeEd6fC75eA575660C6cBe07E09e238Ba7febA) |

USDC: `0x3600000000000000000000000000000000000000`

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

Deploy:
```bash
export AGENT_ADDRESS=<agent_wallet>
export DEPLOYER_PRIVATE_KEY=<private_key>
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
```

## Tests

17/17 passing. See `test/OTTOVault.t.sol`.
