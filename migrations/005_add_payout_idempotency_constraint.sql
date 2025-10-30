-- Migration 005: Add idempotency constraint to prevent duplicate payout distributions
-- This ensures that once payouts are created for a contract, they cannot be duplicated

-- Add a partial unique index to enforce one-time payout distribution per contract
-- Only applies to pending/processing/completed statuses (not failed, which can be retried)
CREATE UNIQUE INDEX IF NOT EXISTS ux_payouts_contract_pending
ON payouts (contract_id)
WHERE status IN ('pending', 'processing', 'completed', 'paid');

-- Add comment explaining the constraint
COMMENT ON INDEX ux_payouts_contract_pending IS 
'Prevents duplicate payout distributions for a contract. Only one set of payouts can exist in pending/processing/completed/paid status.';

