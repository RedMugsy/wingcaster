-- Stage 9 — revenue_allocation_groups + lines (A §9.2). APPEND_ONLY companions.
-- recognized_amount_minor is the one legal accumulator UPDATE (DL-124).

CREATE TABLE fin.revenue_allocation_groups (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  accounting_event_id UUID REFERENCES fin.accounting_events(id),
  source_type TEXT NOT NULL CHECK (source_type IN (
    'PURCHASE_INTENT', 'HOLD', 'FACILITY_RESERVATION',
    'LOT', 'INVOICE', 'RATED_USAGE'
  )),
  source_id UUID NOT NULL,
  obligation_key TEXT NOT NULL DEFAULT 'DEFAULT',
  amount_minor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID
);

COMMENT ON TABLE fin.revenue_allocation_groups IS
  'APPEND_ONLY group per source (intent / hold / reservation / lot). REVOKE UPDATE, DELETE.';

CREATE UNIQUE INDEX uq_revenue_allocation_groups_source
  ON fin.revenue_allocation_groups (environment, source_type, source_id, obligation_key);

CREATE INDEX idx_revenue_allocation_groups_event
  ON fin.revenue_allocation_groups (accounting_event_id);

CREATE TRIGGER trg_revenue_allocation_groups_env_tenant
  BEFORE INSERT OR UPDATE ON fin.revenue_allocation_groups
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE TABLE fin.revenue_allocation_lines (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  group_id UUID NOT NULL REFERENCES fin.revenue_allocation_groups(id),
  amount_minor BIGINT NOT NULL,
  recognition_at TIMESTAMPTZ,
  recognized_amount_minor BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'PARTIAL', 'RECOGNIZED'
  )),
  rated_usage_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_rev_alloc_line_recognized CHECK (
    recognized_amount_minor >= 0 AND recognized_amount_minor <= amount_minor
  )
);

COMMENT ON TABLE fin.revenue_allocation_lines IS
  'APPEND_ONLY recognition schedule. recognized_amount_minor + status accumulate (DL-124); rated_usage_id is the ON_CONSUMPTION pointer (DL-128).';

CREATE INDEX idx_revenue_allocation_lines_group
  ON fin.revenue_allocation_lines (group_id, recognition_at);

CREATE TRIGGER trg_revenue_allocation_lines_env_tenant
  BEFORE INSERT OR UPDATE ON fin.revenue_allocation_lines
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

ALTER TABLE fin.revenue_allocation_groups OWNER TO fin_migrator;
ALTER TABLE fin.revenue_allocation_lines OWNER TO fin_migrator;

ALTER TABLE fin.revenue_allocation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.revenue_allocation_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.revenue_allocation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.revenue_allocation_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.revenue_allocation_groups
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.revenue_allocation_lines
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.revenue_allocation_groups
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

CREATE POLICY fin_tenant_isolation ON fin.revenue_allocation_lines
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

CREATE POLICY fin_recon_all_read ON fin.revenue_allocation_groups
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.revenue_allocation_lines
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.revenue_allocation_groups TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.revenue_allocation_groups FROM fin_app_role;

GRANT SELECT, INSERT ON fin.revenue_allocation_lines TO fin_app_role;
GRANT UPDATE (recognized_amount_minor, status, rated_usage_id) ON fin.revenue_allocation_lines TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.revenue_allocation_lines FROM fin_app_role;

GRANT SELECT ON fin.revenue_allocation_groups
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
GRANT SELECT ON fin.revenue_allocation_lines
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
