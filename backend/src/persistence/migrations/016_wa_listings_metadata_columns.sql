-- Add created_at/updated_at columns to wa_listings tables that are missing them,
-- so the generic document-style DAL (which expects id, created_at, updated_at, data)
-- can operate on every module table.

ALTER TABLE wa_listings.processed_messages
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE wa_listings.ai_usage_logs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE wa_listings.audit_logs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- ai_credit_transactions is a core platform table, not wa_listings, but it is missing
-- the updated_at column expected by the generic DAL.
ALTER TABLE ai_credit_transactions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
