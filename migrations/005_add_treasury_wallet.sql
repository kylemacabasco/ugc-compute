-- Contract attribution via slugs/memos
-- Note: Deposit/funding handled in PR #20
-- This migration only handles contract slug migration and setup

-- Migrate existing contract_refs table: rename ref_code to contract_slug
DO $$
BEGIN
  -- If ref_code exists and contract_slug doesn't, rename it
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_refs' AND column_name = 'ref_code'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_refs' AND column_name = 'contract_slug'
  ) THEN
    ALTER TABLE contract_refs RENAME COLUMN ref_code TO contract_slug;
    
    -- Rename the index if it exists with old name
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_contract_refs_ref_code') THEN
      ALTER INDEX idx_contract_refs_ref_code RENAME TO idx_contract_refs_contract_slug;
    END IF;
  END IF;
END $$;

-- Add comment explaining the contract slug system
COMMENT ON COLUMN contract_refs.contract_slug IS 'Contract slug for easy identification and funding attribution';

-- Ensure RLS is enabled (safe if already enabled)
ALTER TABLE contract_refs ENABLE ROW LEVEL SECURITY;

-- Create RLS policy (drop first if it exists to avoid conflicts)
DROP POLICY IF EXISTS "Allow all operations on contract_refs" ON contract_refs;
CREATE POLICY "Allow all operations on contract_refs" ON contract_refs
  FOR ALL USING (true);
