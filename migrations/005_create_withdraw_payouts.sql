-- Withdrawal Payouts table for Squads Multi-sig Payouts
-- Integrates with existing contracts, submissions, and users tables

DROP TABLE IF EXISTS withdrawal_payouts CASCADE;

CREATE TABLE withdrawal_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Links to existing tables
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    submission_id BIGINT REFERENCES submissions(id) ON DELETE SET NULL,
    
    -- Solana addresses
    from_address TEXT NOT NULL,  -- Squads vault address
    to_address TEXT NOT NULL,    -- User's wallet_address
    
    -- Amount details
    mint TEXT,                   -- NULL = SOL
    amount_base_units TEXT NOT NULL,  -- Lamports (string for precision)
    decimals INTEGER NOT NULL DEFAULT 9,
    ui_amount TEXT NOT NULL,     -- Human-readable amount
    
    -- Payout calculation details
    views_achieved INTEGER,      -- User's view count
    earned_amount NUMERIC(20,8), -- Before scaling
    actual_payout NUMERIC(20,8), -- After scaling
    
    -- Squads multi-sig tracking
    squads_proposal_id TEXT,
    squads_transaction_index INTEGER,
    
    -- Transaction tracking
    tx_sig TEXT,
    slot BIGINT,
    block_time TIMESTAMPTZ,
    
    -- Status flow
    status TEXT NOT NULL DEFAULT 'approved' CHECK (
        status IN ('approved', 'proposal_created', 'broadcast', 'confirmed', 'finalized', 'failed')
    ),
    
    fail_reason TEXT,
    
    -- Audit trail
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_withdrawal_payouts_user ON withdrawal_payouts(user_id, status);
CREATE INDEX idx_withdrawal_payouts_contract ON withdrawal_payouts(contract_id, status);
CREATE INDEX idx_withdrawal_payouts_submission ON withdrawal_payouts(submission_id);
CREATE INDEX idx_withdrawal_payouts_status ON withdrawal_payouts(status) 
    WHERE status IN ('approved', 'proposal_created', 'broadcast');
CREATE INDEX idx_withdrawal_payouts_squads_proposal ON withdrawal_payouts(squads_proposal_id) 
    WHERE squads_proposal_id IS NOT NULL;

CREATE UNIQUE INDEX ux_withdrawal_payouts_submission 
    ON withdrawal_payouts(submission_id) 
    WHERE submission_id IS NOT NULL;

-- RLS
ALTER TABLE withdrawal_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY withdrawal_payouts_public_all
    ON withdrawal_payouts FOR ALL
    USING (true) WITH CHECK (true);

-- Trigger
CREATE TRIGGER trg_withdrawal_payouts_updated_at
    BEFORE UPDATE ON withdrawal_payouts
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE withdrawal_payouts IS 'Squads multi-sig withdrawal records for contract payouts';
COMMENT ON COLUMN withdrawal_payouts.squads_proposal_id IS 'Transaction signature from Squads proposal creation';
COMMENT ON COLUMN withdrawal_payouts.squads_transaction_index IS 'Index of transaction in Squads multi-sig';
COMMENT ON COLUMN withdrawal_payouts.views_achieved IS 'User view count at time of payout calculation';
COMMENT ON COLUMN withdrawal_payouts.earned_amount IS 'Amount earned before proportional scaling (SOL)';
COMMENT ON COLUMN withdrawal_payouts.actual_payout IS 'Final payout after budget cap scaling (SOL)';