-- Create contract + asset tables for campaign authoring and escrowed bounties.
-- Users paste a title, upload creatives, and escrow SOL before going live.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Contracts table
CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'awaiting_funding', 'open', 'paused', 'filled', 'paid_out', 'archived')),
    payout_status TEXT NOT NULL DEFAULT 'idle'
        CHECK (payout_status IN ('idle', 'pending', 'processing', 'retry', 'paid')),
    bounty_amount NUMERIC(20,2) NOT NULL CHECK (bounty_amount > 0),
    total_value NUMERIC(20,2) GENERATED ALWAYS AS (bounty_amount) STORED,
    claimed_value NUMERIC(20,2) NOT NULL DEFAULT 0,
    filled_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'SOL',
    rate_per_1k_views NUMERIC(20,6) NOT NULL DEFAULT 0,
    deposit_required BOOLEAN NOT NULL DEFAULT true,
    deposit_status TEXT NOT NULL DEFAULT 'awaiting_signature'
        CHECK (deposit_status IN ('awaiting_signature', 'pending', 'confirmed', 'failed')),
    deposit_amount_sol NUMERIC(20,8),
    deposit_signature TEXT,
    deposit_transaction_url TEXT,
    deposit_confirmed_at TIMESTAMP WITH TIME ZONE,
    funding_deadline TIMESTAMP WITH TIME ZONE,
    asset_count INTEGER NOT NULL DEFAULT 0,
    auto_payout_enabled BOOLEAN NOT NULL DEFAULT true,
    monitor_checkpoint TIMESTAMP WITH TIME ZONE,
    last_filled_at TIMESTAMP WITH TIME ZONE,
    last_paid_out_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status, payout_status);
CREATE INDEX IF NOT EXISTS idx_contracts_creator ON contracts(creator_id);
CREATE INDEX IF NOT EXISTS idx_contracts_funding ON contracts(deposit_status)
    WHERE deposit_required IS TRUE;

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contracts_public_read ON contracts;
CREATE POLICY contracts_public_read
    ON contracts FOR SELECT
    USING (true);

DROP POLICY IF EXISTS contracts_creator_insert ON contracts;
CREATE POLICY contracts_creator_insert
    ON contracts FOR INSERT
    WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS contracts_creator_update ON contracts;
CREATE POLICY contracts_creator_update
    ON contracts FOR UPDATE
    USING (auth.uid() = creator_id)
    WITH CHECK (auth.uid() = creator_id);

DROP TRIGGER IF EXISTS trg_contracts_updated_at ON contracts;
CREATE TRIGGER trg_contracts_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Contract assets table
CREATE TABLE IF NOT EXISTS contract_assets (
    id BIGSERIAL PRIMARY KEY,
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    original_name TEXT,
    mime_type TEXT,
    checksum TEXT,
    size_bytes BIGINT,
    visibility TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'private')),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_assets_contract ON contract_assets(contract_id);

ALTER TABLE contract_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_assets_public_read ON contract_assets;
CREATE POLICY contract_assets_public_read
    ON contract_assets FOR SELECT
    USING (visibility = 'public');

DROP POLICY IF EXISTS contract_assets_creator_manage ON contract_assets;
CREATE POLICY contract_assets_creator_manage
    ON contract_assets FOR ALL
    USING (
        auth.uid() IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_assets.contract_id
              AND c.creator_id = auth.uid()
        )
    )
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_assets.contract_id
              AND c.creator_id = auth.uid()
        )
    );

-- Contract funding events table
CREATE TABLE IF NOT EXISTS contract_fundings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    signer_wallet TEXT NOT NULL,
    sol_amount NUMERIC(20,8) NOT NULL CHECK (sol_amount > 0),
    tx_signature TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'failed')),
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_contract_fundings_contract ON contract_fundings(contract_id, status);

ALTER TABLE contract_fundings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_fundings_creator_read ON contract_fundings;
CREATE POLICY contract_fundings_creator_read
    ON contract_fundings FOR SELECT
    USING (
        auth.uid() IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_fundings.contract_id
              AND c.creator_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS contract_fundings_creator_insert ON contract_fundings;
CREATE POLICY contract_fundings_creator_insert
    ON contract_fundings FOR INSERT
    WITH CHECK (
        auth.uid() = created_by
        AND EXISTS (
            SELECT 1 FROM contracts c
            WHERE c.id = contract_fundings.contract_id
              AND c.creator_id = auth.uid()
        )
    );

-- Contract events audit log
CREATE TABLE IF NOT EXISTS contract_events (
    id BIGSERIAL PRIMARY KEY,
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'created',
        'status_changed',
        'funding_submitted',
        'funding_confirmed',
        'payout_triggered',
        'payout_complete',
        'payout_failed',
        'manual_note'
    )),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_events_contract ON contract_events(contract_id, created_at DESC);

ALTER TABLE contract_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_events_public_read ON contract_events;
CREATE POLICY contract_events_public_read
    ON contract_events FOR SELECT
    USING (true);
