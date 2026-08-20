-- Stage 9 — fin.tax_snapshots (A §9.3). TABLE + writer helper only.
-- Stage 10 ISSUE consumes it. invoice_id has no FK until fin.invoices (DL-122).

CREATE TABLE fin.tax_snapshots (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  invoice_id UUID NOT NULL,
  jurisdiction CHAR(2) NOT NULL,
  tax_treatment TEXT NOT NULL CHECK (tax_treatment IN (
    'STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE'
  )),
  vat_bps INTEGER NOT NULL,
  tax_minor BIGINT NOT NULL,
  provider TEXT,
  provider_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_tax_snapshots_vat_treatment CHECK (
    (tax_treatment = 'STANDARD' AND vat_bps > 0)
    OR (tax_treatment <> 'STANDARD' AND vat_bps = 0)
  )
);

COMMENT ON TABLE fin.tax_snapshots IS
  'APPEND_ONLY tax decision at invoice ISSUE (A §9.3). Writer helper only in Stage 9; Stage 10 wires ISSUE.';
COMMENT ON COLUMN fin.tax_snapshots.invoice_id IS
  'UUID without FK until Stage 10 fin.invoices (DL-122).';

CREATE INDEX idx_tax_snapshots_invoice
  ON fin.tax_snapshots (invoice_id);

CREATE TRIGGER trg_tax_snapshots_env_tenant
  BEFORE INSERT OR UPDATE ON fin.tax_snapshots
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

ALTER TABLE fin.tax_snapshots OWNER TO fin_migrator;

ALTER TABLE fin.tax_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.tax_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.tax_snapshots
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.tax_snapshots
  AS PERMISSIVE FOR ALL
  TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_recon_all_read ON fin.tax_snapshots
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.tax_snapshots TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.tax_snapshots FROM fin_app_role;

GRANT SELECT ON fin.tax_snapshots
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
