---
name: arc-oracle
version: 1.0.0
description: "Stork Oracle price feeds: fetch real-time asset prices via REST API or on-chain aggregator. Use when the user asks about prices, market data, ETH price, or oracle feeds."
user-invocable: true
metadata: {"openclaw":{"emoji":"📈"}}
---

# arc-oracle Skill

Fetch real-time price feeds from Stork Oracle — both via REST API and on-chain aggregator on Arc Testnet.

## What is Stork?

Stork is a decentralized oracle network providing low-latency price feeds. OTTO uses Stork for:
1. **REST API** — Fast off-chain price lookups with sub-second latency
2. **On-chain aggregator** — Trustless on-chain price data on Arc Testnet

## Setup Required

Add to `.env`:
```bash
STORK_API_KEY=<stork basic auth token>
```

Without the API key, REST queries fall back to mock data. On-chain queries work without a key.

## Scripts

```bash
# Fetch latest price from Stork REST API (default: ETHUSD)
bash {skills}/arc-oracle/scripts/stork_price.sh [asset]

# Read price from Stork on-chain aggregator on Arc Testnet
bash {skills}/arc-oracle/scripts/stork_onchain.sh [asset] [chain]
```
