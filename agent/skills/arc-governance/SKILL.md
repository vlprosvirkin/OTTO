---
name: arc-governance
version: 1.0.0
description: "OTTOVault V2 governance treasury: deploy shareholder-owned vaults, manage cap table, distribute revenue, propose/vote/execute governance actions, invest idle USDC into yield, handle dissolution, AND chat-based governance (link wallets, propose/vote/tally via Telegram). Use when the user asks about shareholders, governance, voting, proposals, CEO, revenue, distribution, dissolve, yield, idle assets, /link, /propose, /vote, members, tally, or chat governance."
user-invocable: true
metadata: {"openclaw":{"emoji":"⚖️"}}
---

# arc-governance Skill

Manage OTTOVault V2 governance treasuries — shareholder ownership, CEO election, revenue distribution, yield management, and dissolution.

## What is OTTOVault V2?

OTTOVault V2 is a governance-controlled treasury on Arc Testnet. It extends V1's agent spending limits with:

- **Shareholder cap table**: ERC20Votes token (OTTOShareToken), fixed supply 10,000 tokens = 10,000 BPS
- **Governance voting**: OpenZeppelin Governor with 51% quorum, any holder can propose
- **Revenue distribution**: Synthetix staking-rewards pattern — O(1) gas per claim
- **Yield management**: CEO invests idle USDC into USYC (tokenized T-bills)
- **Dissolution**: Collect all liquidity, distribute pro-rata to token holders

## Roles

- **CEO**: operational control (limits, whitelist, pause, revenue, yield) — elected by governance
- **Governor**: governance-only (setCeo, dissolve) — OZ Governor contract
- **Agent**: AI agent with on-chain enforced transfer limits (same as V1)

## Governance Flow

1. Any shareholder calls `v2_propose` (setCeo or dissolve)
2. After voting delay (1 block), shareholders vote with `v2_vote`
3. After voting period (100 blocks), if quorum (51%) reached and majority For: execute with `v2_execute`

## Dissolution Flow

1. Propose + vote + execute `dissolve` → state = Dissolving, vault paused
2. CEO redeems yield (`v2_redeem_yield`) and collects cross-chain funds
3. Anyone calls `finalize()` → state = Dissolved, pool captured, token frozen
4. Each shareholder calls `claimDissolution()` → pro-rata USDC payout

## Scripts

### Deploy & Status

```bash
# Deploy full V2 governance stack (VaultV2 + ShareToken + Governor)
bash {skills}/arc-governance/scripts/v2_deploy.sh <factory_address> <salt> <shareholders_csv> <bps_csv> [max_per_tx] [daily_limit]

# Get V2 vault status: balance, yield, limits, roles, state
bash {skills}/arc-governance/scripts/v2_status.sh <vault_address>

# Get shareholder details: balance, %, votes, pending revenue
bash {skills}/arc-governance/scripts/v2_shareholders.sh <vault_address> <shareholders_csv>
```

### Revenue Distribution

```bash
# CEO: distribute revenue to shareholders (auto-transfers USDC to each shareholder)
bash {skills}/arc-governance/scripts/v2_distribute_revenue.sh <vault_address> <amount_usdc>
```

### Yield Management

```bash
# CEO: invest idle USDC into USYC yield
bash {skills}/arc-governance/scripts/v2_invest_yield.sh <vault_address> <amount_usdc>

# CEO: redeem USYC back to USDC
bash {skills}/arc-governance/scripts/v2_redeem_yield.sh <vault_address> <amount_usyc>
```

### Governance Proposals

```bash
# Create a governance proposal (setCeo or dissolve)
bash {skills}/arc-governance/scripts/v2_propose.sh <vault_address> <governor_address> <action> <description> [new_ceo]

# Cast a vote on a proposal (0=Against, 1=For, 2=Abstain)
bash {skills}/arc-governance/scripts/v2_vote.sh <governor_address> <proposal_id> <support>

# Execute a passed proposal
bash {skills}/arc-governance/scripts/v2_execute.sh <vault_address> <governor_address> <action> <description> [new_ceo]
```

### Dissolution

```bash
# Get dissolution status: pool, per-holder claimable, claimed flags
bash {skills}/arc-governance/scripts/v2_dissolve_status.sh <vault_address> <shareholders_csv>
```

## Chat-Based Governance (Telegram)

OTTO can act as a governance relay inside a Telegram group chat. Participants link their wallets, propose actions in natural language, and vote via chat replies. OTTO tracks roles and LP shares in real time.

### How It Works

1. **Setup**: OTTO configures the DAC addresses (vault, governor, share token)
2. **Link**: Each participant sends `/link 0x...` — OTTO verifies share token balance and determines role
3. **Propose**: Any shareholder types `/propose` — OTTO creates an on-chain proposal and posts a vote card
4. **Vote**: Participants reply FOR/AGAINST — OTTO records votes weighted by share tokens
5. **Tally**: Anyone can check the running tally; when quorum is reached, OTTO executes on-chain

### Storage

All governance state is persisted in `~/.otto/governance.json`:
- DAC config (vault, governor, share token addresses)
- Members (tgId → wallet → display name)
- Proposals (action, description, votes with weights)

### Chat Governance Scripts

```bash
# Configure DAC addresses (run once)
bash {skills}/arc-governance/scripts/gov_setup.sh <vault_address> <governor_address> <share_token_address> [chat_id]

# Link Telegram user to wallet (verifies share token balance)
bash {skills}/arc-governance/scripts/gov_link.sh <user_id> <eth_address> [display_name]

# List all linked members with roles and voting power
bash {skills}/arc-governance/scripts/gov_members.sh

# Show your own governance info (wallet, role, shares, vote history)
bash {skills}/arc-governance/scripts/gov_my_info.sh <user_id>

# Create a governance proposal from chat
bash {skills}/arc-governance/scripts/gov_propose.sh <user_id> <action> <description> [new_ceo]

# Cast a vote on a proposal (0=Against, 1=For, 2=Abstain)
bash {skills}/arc-governance/scripts/gov_vote.sh <user_id> <proposal_id> <support>

# Show current vote tally (defaults to most recent proposal)
bash {skills}/arc-governance/scripts/gov_tally.sh [proposal_id]
```

### Chat Commands (for agent.md playbook)

| Command | Who | Action |
|---------|-----|--------|
| `/link 0x...` | Anyone | Link Telegram ID to wallet, verify shares |
| `/propose <action>` | Shareholder | Create governance proposal |
| FOR / AGAINST | Shareholder | Vote on active proposal (reply to vote card) |
| `/tally` | Anyone | Show current vote count |
| `/my` | Linked user | Show your wallet, role, shares |
| `/members` | Anyone | List all DAC members |
| `/status` | Anyone | Treasury balance + active proposals |
