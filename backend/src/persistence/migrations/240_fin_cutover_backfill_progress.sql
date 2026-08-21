-- Stage 13b — fin.cutover_backfill_progress (DL-182).
-- APPEND_ONLY: each batch start and each batch completion is a new row.
-- last_processed_at is never UPDATEd in place.

CREATE TABLE fin.cutover_backfill_progress (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  source TEXT NOT NULL,
  last_processed_at TIMESTAMPTZ,
  last_processed_id TEXT,
  rows_processed BIGINT NOT NULL DEFAULT 0,
  rows_written BIGINT NOT NULL DEFAULT 0,
  rows_corrected BIGINT NOT NULL DEFAULT 0,
  batch_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  actor_type TEXT,
  actor_id TEXT
);

COMMENT ON TABLE fin.cutover_backfill_progress IS
  'APPEND_ONLY Stage 13b backfill progress (DL-182). One INSERT per start and per completion; no UPDATE of last_processed_at.';
COMMENT ON COLUMN fin.cutover_backfill_progress.source IS
  'Legacy source, e.g. commercial.usage_events / commercial.ledger_entries.';
COMMENT ON COLUMN fin.cutover_backfill_progress.last_processed_id IS
  'DL-185 cursor companion to last_processed_at so same-timestamp chunks resume by (occurred_at, id).';

-- One start and one completion row per (source, batch_id).
-- Concurrent workers are excluded by advisory lock FIN_CUTOVER_BACKFILL = 1030
-- (APPEND_ONLY start rows keep completed_at NULL forever, so a live unique
-- on (environment, source) WHERE completed_at IS NULL would admit only one
-- backfill run for the life of the table).
CREATE UNIQUE INDEX uq_cutover_backfill_progress_source_batch_start
  ON fin.cutover_backfill_progress (source, batch_id)
  WHERE completed_at IS NULL;
CREATE UNIQUE INDEX uq_cutover_backfill_progress_source_batch_complete
  ON fin.cutover_backfill_progress (source, batch_id)
  WHERE completed_at IS NOT NULL;

CREATE INDEX idx_cutover_backfill_progress_source_completed
  ON fin.cutover_backfill_progress (source, completed_at DESC);

ALTER TABLE fin.cutover_backfill_progress OWNER TO fin_migrator;

ALTER TABLE fin.cutover_backfill_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.cutover_backfill_progress FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.cutover_backfill_progress
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_backfill_progress_insert ON fin.cutover_backfill_progress
  FOR INSERT TO fin_app_role
  WITH CHECK (true);

CREATE POLICY fin_backfill_progress_app_read ON fin.cutover_backfill_progress
  FOR SELECT TO fin_app_role
  USING (true);

CREATE POLICY fin_backfill_progress_admin_read ON fin.cutover_backfill_progress
  FOR SELECT TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (fin.platform_admin_bypass());

CREATE POLICY fin_backfill_progress_recon_read ON fin.cutover_backfill_progress
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.cutover_backfill_progress TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.cutover_backfill_progress FROM fin_app_role;

GRANT SELECT ON fin.cutover_backfill_progress
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
