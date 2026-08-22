-- Stage 13b — backfill natural-key columns + BLOCK_CUTOVER (DL-181 / DL-183).
-- fin.usage_events already has source_system + source_event_id with UNIQUE
-- (environment, source_system, source_event_id, residency_key) from migration 111.
-- Backfill reuses those columns (no ADD COLUMN on usage_events).

ALTER TABLE fin.rated_usage
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_row_id TEXT;

ALTER TABLE fin.accounting_events
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_row_id TEXT;

COMMENT ON COLUMN fin.rated_usage.source_system IS
  'DL-181 backfill origin (e.g. commercial.ledger_entries). NULL for live rating.';
COMMENT ON COLUMN fin.rated_usage.source_row_id IS
  'DL-181 legacy PK. Partial UNIQUE with source_system enforces idempotent backfill.';
COMMENT ON COLUMN fin.accounting_events.source_system IS
  'DL-181 backfill origin. NULL for live accounting writers.';
COMMENT ON COLUMN fin.accounting_events.source_row_id IS
  'DL-181 legacy PK. Partial UNIQUE with source_system + event_kind enforces idempotent backfill.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_rated_usage_backfill_source
  ON fin.rated_usage (source_system, source_row_id)
  WHERE source_row_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_events_backfill_source
  ON fin.accounting_events (source_system, source_row_id, event_kind)
  WHERE source_row_id IS NOT NULL;

-- R090–R092 drift_action BLOCK_CUTOVER (DL-183). Stage 1 CHECK omitted it.
ALTER TABLE fin.reconciliation_resolution
  DROP CONSTRAINT IF EXISTS reconciliation_resolution_action_check;

ALTER TABLE fin.reconciliation_resolution
  ADD CONSTRAINT reconciliation_resolution_action_check
  CHECK (action IN (
    'WARN',
    'BLOCK_NEW_ISSUANCE',
    'BLOCK_AFFECTED_HOLDER',
    'BLOCK_AFFECTED_BOOK',
    'BLOCK_BILLING_CLOSE',
    'BLOCK_CUTOVER'
  ));
