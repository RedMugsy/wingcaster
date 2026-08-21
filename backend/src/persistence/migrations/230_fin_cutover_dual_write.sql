-- Stage 13a — dual-write dead-letter (DL-173 / DL-174).
-- APPEND_ONLY: every row is a real observed fin.* mirror failure.
-- Legacy write is never blocked; failures land here for audit.

CREATE TABLE fin.cutover_dual_write_errors (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id TEXT,
  legacy_source TEXT NOT NULL,
  legacy_row_id TEXT,
  fin_command TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE fin.cutover_dual_write_errors IS
  'APPEND_ONLY Stage 13a dual-write DLQ (DL-173). fin.* mirror failures only; legacy commit proceeds.';
COMMENT ON COLUMN fin.cutover_dual_write_errors.tenant_id IS
  'Public tenant id (HTTP routing id), not fin.tenants.id. NULL when unresolved.';
COMMENT ON COLUMN fin.cutover_dual_write_errors.legacy_source IS
  'e.g. commercial.usage_events, commercial.ledger_entries, commercial.holds';

CREATE INDEX idx_cutover_dual_write_errors_occurred
  ON fin.cutover_dual_write_errors (occurred_at DESC);

CREATE INDEX idx_cutover_dual_write_errors_source_code_occurred
  ON fin.cutover_dual_write_errors (legacy_source, error_code, occurred_at DESC);

ALTER TABLE fin.cutover_dual_write_errors OWNER TO fin_migrator;

ALTER TABLE fin.cutover_dual_write_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.cutover_dual_write_errors FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.cutover_dual_write_errors
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_dual_write_errors_insert ON fin.cutover_dual_write_errors
  FOR INSERT TO fin_app_role
  WITH CHECK (true);

CREATE POLICY fin_dual_write_errors_admin_read ON fin.cutover_dual_write_errors
  FOR SELECT TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (fin.platform_admin_bypass());

CREATE POLICY fin_dual_write_errors_recon_read ON fin.cutover_dual_write_errors
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT INSERT ON fin.cutover_dual_write_errors TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.cutover_dual_write_errors FROM fin_app_role;

GRANT SELECT ON fin.cutover_dual_write_errors
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
