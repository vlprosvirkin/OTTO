-- Arc Wallet MCP — Supabase schema
-- Run this in: supabase.com → SQL Editor → New Query → Run
--
-- Modified from original arc-multichain-wallet migrations:
-- user_id is TEXT (not FK to auth.users) so the MCP agent can work
-- without Supabase Auth.

-- ── Wallets ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wallets (
    id              UUID    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id         TEXT    NOT NULL,                        -- plain string, no auth FK
    circle_wallet_id TEXT   NOT NULL UNIQUE,
    wallet_set_id   TEXT    NOT NULL,
    wallet_address  TEXT,
    address         TEXT,                                    -- alias for wallet_address
    blockchain      TEXT,
    type            TEXT,                                    -- 'sca' | 'gateway_signer'
    name            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);

-- ── Transaction History ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transaction_history (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 TEXT        NOT NULL,            -- plain string, no auth FK
    chain                   TEXT        NOT NULL,
    tx_type                 TEXT        NOT NULL,            -- 'deposit' | 'transfer' | 'unify'
    amount                  NUMERIC     NOT NULL,
    tx_hash                 TEXT,
    gateway_wallet_address  TEXT,
    destination_chain       TEXT,
    status                  TEXT        DEFAULT 'success'
                                        CHECK (status IN ('pending', 'success', 'failed')),
    reason                  TEXT,
    created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tx_user_status     ON public.transaction_history(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tx_created_at      ON public.transaction_history(created_at DESC);

-- ── OTTO Users ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.otto_users (
    user_id         TEXT        PRIMARY KEY,              -- Telegram ID or eth_address fallback
    eth_address     TEXT        UNIQUE,                   -- wallet address (lowercase)
    tg_id           BIGINT,
    tg_username     TEXT,
    tg_first_name   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otto_users_eth ON public.otto_users(eth_address);

-- ── OTTO Vaults ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.otto_vaults (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT        NOT NULL REFERENCES public.otto_users(user_id) ON DELETE CASCADE,
    chain           TEXT        NOT NULL
                                CHECK (chain IN ('arcTestnet', 'baseSepolia', 'avalancheFuji')),
    vault_address   TEXT        NOT NULL,                 -- lowercase
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, chain)
);

CREATE INDEX IF NOT EXISTS idx_otto_vaults_user ON public.otto_vaults(user_id);
