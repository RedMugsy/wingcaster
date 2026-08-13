-- Add surrogate id column to ai_credit_balances so the generic document-style DAL
-- can upsert rows while preserving the natural composite key (scope, scope_id).

ALTER TABLE ai_credit_balances
  ADD COLUMN IF NOT EXISTS id TEXT,
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill existing rows with deterministic ids based on the natural key.
UPDATE ai_credit_balances
SET id = scope || ':' || scope_id
WHERE id IS NULL;

-- Replace any existing primary key with the surrogate id and enforce the natural key.
ALTER TABLE ai_credit_balances
  DROP CONSTRAINT IF EXISTS ai_credit_balances_pkey,
  ADD PRIMARY KEY (id),
  DROP CONSTRAINT IF EXISTS ai_credit_balances_scope_id_unique,
  ADD CONSTRAINT ai_credit_balances_scope_id_unique UNIQUE (scope, scope_id);
