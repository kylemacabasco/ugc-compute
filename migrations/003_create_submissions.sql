-- Create submissions table
-- Tracks user claims on contracts with view counts and earnings

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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_submissions_contract_status ON submissions(contract_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_submissions_contract_approved 
    ON submissions(contract_id, earned_amount) 
    WHERE status = 'approved';

-- RLS
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS submissions_public_read ON submissions;
CREATE POLICY submissions_public_read
    ON submissions FOR SELECT
    USING (true);

DROP POLICY IF EXISTS submissions_public_manage ON submissions;
CREATE POLICY submissions_public_manage
    ON submissions FOR ALL
    USING (true)
    WITH CHECK (true);

-- Trigger
DROP TRIGGER IF EXISTS trg_submissions_updated_at ON submissions;
CREATE TRIGGER trg_submissions_updated_at
    BEFORE UPDATE ON submissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE submissions IS 'User submissions for contracts - tracks claims, views, and earnings';
COMMENT ON COLUMN submissions.view_count IS 'Current view count from platform (updated periodically)';
COMMENT ON COLUMN submissions.earned_amount IS 'Calculated earnings: (view_count / 1000) * contract.rate_per_1k_views';
COMMENT ON COLUMN submissions.status IS 'pending=submitted, approved=validated by AI, rejected=failed validation';