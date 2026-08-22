-- Stage 13c — fin.cutover_parity_reports (DL-196 / DL-197).
-- APPEND_ONLY: every worker tick INSERTs a final row. Nothing is UPDATEd.
-- UNIQUE (environment, source, window_start, window_end) makes reruns
-- ON CONFLICT DO NOTHING; the original report stands.

CREATE TABLE fin.cutover_parity_reports (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  source TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  tenants_covered INT,
  rows_checked BIGINT NOT NULL DEFAULT 0,
  rows_matched BIGINT NOT NULL DEFAULT 0,
  rows_drifted BIGINT NOT NULL DEFAULT 0,
  rows_missing_fin BIGINT NOT NULL DEFAULT 0,
  rows_missing_legacy BIGINT NOT NULL DEFAULT 0,
  drift_rate_bps BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('GREEN', 'AMBER', 'RED')),
  generated_at TIMESTAMPTZ NOT NULL,
  generated_by_actor_type TEXT,
  generated_by_actor_id TEXT,
  CHECK (window_end > window_start)
);

COMMENT ON TABLE fin.cutover_parity_reports IS
  'APPEND_ONLY Stage 13c parity report (DL-197). One INSERT per (env, source, window); worker never UPDATEs.';
COMMENT ON COLUMN fin.cutover_parity_reports.source IS
  'Legacy source, e.g. commercial.usage_events / commercial.ledger_entries.';
COMMENT ON COLUMN fin.cutover_parity_reports.drift_rate_bps IS
  'Basis points; 10000 = 100%. GREEN = 0 drift, AMBER < 50 bps, RED >= 50 bps (DL-200).';

CREATE UNIQUE INDEX uq_cutover_parity_reports_window
  ON fin.cutover_parity_reports (environment, source, window_start, window_end);

CREATE INDEX idx_cutover_parity_reports_generated
  ON fin.cutover_parity_reports (generated_at DESC);

CREATE INDEX idx_cutover_parity_reports_source_status_generated
  ON fin.cutover_parity_reports (source, status, generated_at DESC);

CREATE OR REPLACE FUNCTION fin.trg_cutover_parity_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CUTOVER_PARITY_APPEND_ONLY' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER trg_cutover_parity_reports_append_only
  BEFORE UPDATE OR DELETE ON fin.cutover_parity_reports
  FOR EACH ROW EXECUTE FUNCTION fin.trg_cutover_parity_append_only();

ALTER TABLE fin.cutover_parity_reports OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_cutover_parity_append_only() OWNER TO fin_migrator;

ALTER TABLE fin.cutover_parity_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.cutover_parity_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.cutover_parity_reports
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_parity_reports_insert ON fin.cutover_parity_reports
  FOR INSERT TO fin_app_role
  WITH CHECK (true);

CREATE POLICY fin_parity_reports_app_read ON fin.cutover_parity_reports
  FOR SELECT TO fin_app_role
  USING (true);

CREATE POLICY fin_parity_reports_admin_read ON fin.cutover_parity_reports
  FOR SELECT TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (fin.platform_admin_bypass());

CREATE POLICY fin_parity_reports_recon_read ON fin.cutover_parity_reports
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.cutover_parity_reports TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.cutover_parity_reports FROM fin_app_role;

GRANT SELECT ON fin.cutover_parity_reports
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_cutover_parity_append_only() TO fin_app_role;
