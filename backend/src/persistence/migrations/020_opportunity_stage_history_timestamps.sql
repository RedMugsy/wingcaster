-- opportunity_stage_history needs created_at/updated_at because the DAL insert path
-- always writes both columns.

ALTER TABLE IF EXISTS opportunity_stage_history
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
