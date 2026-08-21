-- Stage 13a — per-tenant cutover allowlist (DL-172).
-- tenant_id is the PUBLIC tenant id (HTTP routing), not fin.tenants.id.
-- Seeded empty; Stage 12 / 13c admin surface manages rows.

CREATE TABLE fin.cutover_tenant_allowlist (
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('OFF', 'DUAL')),
  reason_code TEXT,
  added_by_actor_type TEXT,
  added_by_actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, tenant_id)
);

COMMENT ON TABLE fin.cutover_tenant_allowlist IS
  'Stage 13a per-tenant FIN_CUTOVER allowlist (DL-172). Public tenant id; no FK to fin.tenants.';
COMMENT ON COLUMN fin.cutover_tenant_allowlist.tenant_id IS
  'Public tenant id used by HTTP routing (same as public.tenants.id).';
COMMENT ON COLUMN fin.cutover_tenant_allowlist.mode IS
  'OFF or DUAL only. FIN_ONLY is global via FIN_CUTOVER_MODE_GLOBAL env.';

ALTER TABLE fin.cutover_tenant_allowlist OWNER TO fin_migrator;

ALTER TABLE fin.cutover_tenant_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.cutover_tenant_allowlist FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.cutover_tenant_allowlist
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_allowlist_app_read ON fin.cutover_tenant_allowlist
  FOR SELECT TO fin_app_role
  USING (true);

CREATE POLICY fin_allowlist_admin_write ON fin.cutover_tenant_allowlist
  FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (fin.platform_admin_bypass())
  WITH CHECK (fin.platform_admin_bypass());

CREATE POLICY fin_allowlist_recon_read ON fin.cutover_tenant_allowlist
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT ON fin.cutover_tenant_allowlist TO fin_app_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fin.cutover_tenant_allowlist FROM fin_app_role;

GRANT SELECT ON fin.cutover_tenant_allowlist
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;