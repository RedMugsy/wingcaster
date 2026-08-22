-- Stage 13c — fin.cutover_parity_drift (DL-196).
-- APPEND_ONLY observed mismatch. Parity does not reconcile.

CREATE TABLE fin.cutover_parity_drift (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  report_id UUID NOT NULL REFERENCES fin.cutover_parity_reports(id),
  source TEXT NOT NULL,
  source_row_id TEXT NOT NULL,
  drift_kind TEXT NOT NULL CHECK (drift_kind IN (
    'MISSING_FIN',
    'MISSING_LEGACY',
    'FIELD_MISMATCH',
    'DUPLICATE_FIN',
    'TIMESTAMP_SKEW',
    'AMOUNT_MISMATCH',
    'CURRENCY_MISMATCH',
    'TENANT_MISMATCH',
    'ENVIRONMENT_MISMATCH',
    'OTHER'
  )),
  legacy_snapshot JSONB,
  fin_snapshot JSONB,
  field_diffs JSONB,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE fin.cutover_parity_drift IS
  'APPEND_ONLY Stage 13c parity drift (DL-196). Observation only; corrections belong to 13b or a manual operator action.';

CREATE UNIQUE INDEX uq_cutover_parity_drift_natural
  ON fin.cutover_parity_drift (report_id, source, source_row_id, drift_kind);

CREATE INDEX idx_cutover_parity_drift_report
  ON fin.cutover_parity_drift (report_id);

CREATE INDEX idx_cutover_parity_drift_source_kind_observed
  ON fin.cutover_parity_drift (source, drift_kind, observed_at DESC);

CREATE INDEX idx_cutover_parity_drift_source_row
  ON fin.cutover_parity_drift (source_row_id);

CREATE TRIGGER trg_cutover_parity_drift_append_only
  BEFORE UPDATE OR DELETE ON fin.cutover_parity_drift
  FOR EACH ROW EXECUTE FUNCTION fin.trg_cutover_parity_append_only();

ALTER TABLE fin.cutover_parity_drift OWNER TO fin_migrator;

ALTER TABLE fin.cutover_parity_drift ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.cutover_parity_drift FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.cutover_parity_drift
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_parity_drift_insert ON fin.cutover_parity_drift
  FOR INSERT TO fin_app_role
  WITH CHECK (true);

CREATE POLICY fin_parity_drift_app_read ON fin.cutover_parity_drift
  FOR SELECT TO fin_app_role
  USING (true);

CREATE POLICY fin_parity_drift_admin_read ON fin.cutover_parity_drift
  FOR SELECT TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (fin.platform_admin_bypass());

CREATE POLICY fin_parity_drift_recon_read ON fin.cutover_parity_drift
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.cutover_parity_drift TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.cutover_parity_drift FROM fin_app_role;

GRANT SELECT ON fin.cutover_parity_drift
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
