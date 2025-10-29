-- Create contracts table (minimal version)
-- Removes: contract_assets, contract_fundings, contract_events
-- Use deposits table for funding, metadata for assets/requirements

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Contracts table
CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'awaiting_funding', 'open', 'paused', 'completed', 'archived')),
    contract_amount NUMERIC(20,2) NOT NULL CHECK (contract_amount > 0),
    rate_per_1k_views NUMERIC(20,6) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'SOL',
    deposit_required BOOLEAN NOT NULL DEFAULT true,
    deposit_status TEXT NOT NULL DEFAULT 'awaiting_signature'
        CHECK (deposit_status IN ('awaiting_signature', 'pending', 'confirmed', 'failed')),
    deposit_amount_sol NUMERIC(20,8),
    deposit_signature TEXT,
    deposit_confirmed_at TIMESTAMP WITH TIME ZONE,
    funding_deadline TIMESTAMP WITH TIME ZONE,
    auto_payout_enabled BOOLEAN NOT NULL DEFAULT true,
    completed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_creator ON contracts(creator_id);
CREATE INDEX IF NOT EXISTS idx_contracts_funding ON contracts(deposit_status)
    WHERE deposit_required IS TRUE;
CREATE INDEX IF NOT EXISTS idx_contracts_completed ON contracts(completed_at)
    WHERE completed_at IS NOT NULL;

-- RLS
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contracts_public_read ON contracts;
CREATE POLICY contracts_public_read
    ON contracts FOR SELECT
    USING (true);

DROP POLICY IF EXISTS contracts_public_insert ON contracts;
CREATE POLICY contracts_public_insert
    ON contracts FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS contracts_public_update ON contracts;
CREATE POLICY contracts_public_update
    ON contracts FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- Trigger
DROP TRIGGER IF EXISTS trg_contracts_updated_at ON contracts;
CREATE TRIGGER trg_contracts_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE contracts IS 'Main contracts table for UGC campaigns';
COMMENT ON COLUMN contracts.metadata IS 'Stores requirements, assets URLs, and other flexible data as JSON';
COMMENT ON COLUMN contracts.deposit_signature IS 'Transaction signature from deposits table';