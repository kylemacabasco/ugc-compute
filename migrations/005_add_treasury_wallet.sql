-- Add treasury wallet fields to contracts table
ALTER TABLE contracts 
ADD COLUMN IF NOT EXISTS treasury_wallet_address TEXT,
ADD COLUMN IF NOT EXISTS treasury_keypair_encrypted TEXT;

-- Add index for treasury wallet lookups
CREATE INDEX IF NOT EXISTS idx_contracts_treasury_wallet ON contracts(treasury_wallet_address);

-- Add comment explaining the treasury wallet system
COMMENT ON COLUMN contracts.treasury_wallet_address IS 'Unique Solana wallet address for this contract to receive funding deposits';
COMMENT ON COLUMN contracts.treasury_keypair_encrypted IS 'Encrypted private key for the treasury wallet';

-- Create contract_refs table for contract slugs
CREATE TABLE IF NOT EXISTS contract_refs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ref_code TEXT NOT NULL UNIQUE,
  contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for contract_refs
CREATE INDEX IF NOT EXISTS idx_contract_refs_contract_id ON contract_refs(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_refs_ref_code ON contract_refs(ref_code);
CREATE INDEX IF NOT EXISTS idx_contract_refs_status ON contract_refs(status);

-- Add comment explaining the contract slug system
COMMENT ON COLUMN contract_refs.ref_code IS 'Contract slug for easy identification and funding attribution';

-- Add RLS policies for contract_refs
ALTER TABLE contract_refs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on contract_refs" ON contract_refs
  FOR ALL USING (true);
