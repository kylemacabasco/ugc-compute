-- Note: We use a single squads vault (multisig) for all deposits
-- Contract attribution is done via slugs/memos, not per-contract wallets

-- Create contract_refs table for contract slugs
CREATE TABLE IF NOT EXISTS contract_refs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_slug TEXT NOT NULL UNIQUE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for contract_refs
CREATE INDEX IF NOT EXISTS idx_contract_refs_contract_id ON contract_refs(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_refs_contract_slug ON contract_refs(contract_slug);
CREATE INDEX IF NOT EXISTS idx_contract_refs_status ON contract_refs(status);

-- Add comment explaining the contract slug system
COMMENT ON COLUMN contract_refs.contract_slug IS 'Contract slug for easy identification and funding attribution';

-- Add RLS policies for contract_refs
ALTER TABLE contract_refs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on contract_refs" ON contract_refs
  FOR ALL USING (true);
