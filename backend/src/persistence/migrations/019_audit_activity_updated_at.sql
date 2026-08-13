-- Audit/activity tables were missing updated_at, but the DAL insert path always
-- sets it. Add the column so logging works under Postgres.

ALTER TABLE IF EXISTS audit_log
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE IF EXISTS activity_log
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
