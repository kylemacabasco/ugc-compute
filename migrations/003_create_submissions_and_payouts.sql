-- Create submission, earnings, and payout tables plus the view used by automation scripts.

-- Ensure users table has Solana payout metadata
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS solana_wallet_address TEXT,
    ADD COLUMN IF NOT EXISTS payout_contact TEXT,
    ADD COLUMN IF NOT EXISTS last_wallet_validation_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS chk_users_solana_wallet_format;

ALTER TABLE users
    ADD CONSTRAINT chk_users_solana_wallet_format
    CHECK (
        solana_wallet_address IS NULL
        OR length(solana_wallet_address) BETWEEN 32 AND 44
    );

UPDATE users
SET solana_wallet_address = wallet_address
WHERE solana_wallet_address IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_solana_wallet_address
    ON users(solana_wallet_address)
    WHERE solana_wallet_address IS NOT NULL;

COMMENT ON COLUMN users.solana_wallet_address IS 'Primary Solana wallet used when sending contract payouts.';
COMMENT ON COLUMN users.payout_contact IS 'Optional email/discord handle for payout issues.';
COMMENT ON COLUMN users.last_wallet_validation_at IS 'Timestamp of the last signature challenge for this wallet.';

-- Submissions table
CREATE TABLE IF NOT EXISTS submissions (
    id BIGSERIAL PRIMARY KEY,
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_url TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'youtube',
    view_count BIGINT NOT NULL DEFAULT 0,
    earned_amount NUMERIC(20,8) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'invalid')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_contract_status ON submissions(contract_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id, contract_id);

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS submissions_view_own ON submissions;
CREATE POLICY submissions_view_own
    ON submissions FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS submissions_manage_own ON submissions;
CREATE POLICY submissions_manage_own
    ON submissions FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_submissions_updated_at ON submissions;
CREATE TRIGGER trg_submissions_updated_at
    BEFORE UPDATE ON submissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Payouts table
CREATE TABLE IF NOT EXISTS payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(20,8) NOT NULL CHECK (amount > 0),
    solana_transaction_signature TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'failed')),
    error_message TEXT,
    processed_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_payouts_contract ON payouts(contract_id, status);

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payouts_view_own ON payouts;
CREATE POLICY payouts_view_own
    ON payouts FOR SELECT
    USING (auth.uid() = user_id);

-- Earnings table
CREATE TABLE IF NOT EXISTS earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    submission_id BIGINT REFERENCES submissions(id) ON DELETE SET NULL,
    amount_earned NUMERIC(20,8) NOT NULL CHECK (amount_earned >= 0),
    calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    payout_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payout_status IN ('pending', 'processing', 'retry', 'paid', 'failed')),
    payout_id UUID REFERENCES payouts(id) ON DELETE SET NULL,
    notes TEXT,
    last_error TEXT,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_earnings_pending ON earnings(contract_id, payout_status)
    WHERE payout_status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_earnings_user ON earnings(user_id, payout_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_earnings_submission_id ON earnings(submission_id)
    WHERE submission_id IS NOT NULL;

ALTER TABLE earnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS earnings_view_own ON earnings;
CREATE POLICY earnings_view_own
    ON earnings FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS earnings_insert_own ON earnings;
CREATE POLICY earnings_insert_own
    ON earnings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS earnings_update_own ON earnings;
CREATE POLICY earnings_update_own
    ON earnings FOR UPDATE
    USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_earnings_updated_at ON earnings;
CREATE TRIGGER trg_earnings_updated_at
    BEFORE UPDATE ON earnings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Pending payouts view
DROP VIEW IF EXISTS pending_contract_user_totals;

CREATE VIEW pending_contract_user_totals AS
SELECT
    e.contract_id,
    e.user_id,
    COALESCE(u.solana_wallet_address, u.wallet_address) AS solana_wallet_address,
    SUM(e.amount_earned) AS total_amount,
    COUNT(*) AS pending_entries,
    MIN(e.calculated_at) AS first_calculated_at,
    ARRAY_AGG(e.id ORDER BY e.calculated_at) AS earning_ids
FROM earnings e
JOIN users u ON u.id = e.user_id
WHERE e.payout_status IN ('pending', 'retry')
GROUP BY
    e.contract_id,
    e.user_id,
    COALESCE(u.solana_wallet_address, u.wallet_address);
