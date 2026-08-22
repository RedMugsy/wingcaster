-- Stage 13b — fin.cutover_backfill_corrections (DL-182 / DL-185).
-- APPEND_ONLY audit of legacy rows that cannot be represented cleanly in fin.*.

CREATE TABLE fin.cutover_backfill_corrections (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  source TEXT NOT NULL,
  source_row_id TEXT NOT NULL,
  fin_row_id UUID,
  correction_kind TEXT NOT NULL CHECK (correction_kind IN (
    'MISSING_TENANT_MAP',
    'MISSING_HOLDER_MAP',
    'MISSING_LEGAL_ENTITY',
    'ORPHAN_CONSUMPTION',
    'OUT_OF_ORDER',
    'DUPLICATE_LEGACY_ROW',
    'AMOUNT_MISMATCH',
    'CURRENCY_UNKNOWN',
    'UNMAPPED_ACTION_KEY',
    'OTHER'
  )),
  reason TEXT,
  legacy_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  corrected_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE fin.cutover_backfill_corrections IS
  'APPEND_ONLY Stage 13b backfill correction audit (DL-182). Do not skip unrepresentable legacy rows silently.';

CREATE UNIQUE INDEX uq_cutover_backfill_corrections_natural
  ON fin.cutover_backfill_corrections (source, source_row_id, correction_kind);

CREATE INDEX idx_cutover_backfill_corrections_kind
  ON fin.cutover_backfill_corrections (correction_kind, created_at DESC);

ALTER TABLE fin.cutover_backfill_corrections OWNER TO fin_migrator;

ALTER TABLE fin.cutover_backfill_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.cutover_backfill_corrections FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.cutover_backfill_corrections
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_backfill_corrections_insert ON fin.cutover_backfill_corrections
  FOR INSERT TO fin_app_role
  WITH CHECK (true);

CREATE POLICY fin_backfill_corrections_app_read ON fin.cutover_backfill_corrections
  FOR SELECT TO fin_app_role
  USING (true);

CREATE POLICY fin_backfill_corrections_admin_read ON fin.cutover_backfill_corrections
  FOR SELECT TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (fin.platform_admin_bypass());

CREATE POLICY fin_backfill_corrections_recon_read ON fin.cutover_backfill_corrections
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.cutover_backfill_corrections TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.cutover_backfill_corrections FROM fin_app_role;

GRANT SELECT ON fin.cutover_backfill_corrections
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
