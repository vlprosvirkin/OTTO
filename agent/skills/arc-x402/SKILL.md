# arc-x402 Skill

Enables the agent to make autonomous USDC micropayments for HTTP services using the x402 protocol.

## What is x402?

When an HTTP server requires payment, it responds with `402 Payment Required`. The agent automatically:
1. Reads the payment requirements from the response headers
2. Signs an EIP-3009 authorization using the payer wallet
3. Retries the request with a `PAYMENT-SIGNATURE` header
4. Returns the response + payment receipt

Payments settle via Circle Gateway — offchain and gas-free.

## Setup Required

```bash
# Generate agent payer wallet (run once)
tsx scripts/setup_x402_payer.ts

# Check balances
tsx scripts/setup_x402_payer.ts --balance
```

Add `X402_PAYER_PRIVATE_KEY` to `.env` and fund the address with USDC.

## Scripts

```bash
# Check payer wallet config & balances
bash {skills}/arc-x402/scripts/x402_payer_info.sh

# Fetch a paid resource (auto-pays on 402)
bash {skills}/arc-x402/scripts/x402_fetch.sh <url> [method] [body_json]
```
