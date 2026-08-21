-- Stage 11 — vendor usage facts, reported usage, cost estimates, actuals
-- (A §11.2–11.5 restated). vendor_actual_costs.vendor_statement_line_id
-- FK is added in 212 (table does not exist yet).

CREATE TABLE fin.vendor_usage_events (
  id UUID PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES fin.vendors(id),
  vendor_product_code TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID REFERENCES fin.tenants(id),
  holder_id UUID REFERENCES fin.holders(id),
  source_event_id TEXT,
  quantity_units BIGINT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE fin.vendor_usage_events IS
  'APPEND_ONLY provider-side usage facts (Stage 2 mirror). No rating hooks.';
COMMENT ON COLUMN fin.vendor_usage_events.source_event_id IS
  'Provider event id. UNIQUE(vendor_id, source_event_id) WHERE NOT NULL is NEVER dropped (Stage 2 + Stage 7 + Stage 10 PSP unique pattern).';

-- Permanent provider uniqueness. NEVER dropped.
CREATE UNIQUE INDEX uq_vendor_usage_events_source
  ON fin.vendor_usage_events (vendor_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

COMMENT ON INDEX fin.uq_vendor_usage_events_source IS
  'NEVER expires, NEVER dropped. Provider retries of the same event id. Mirror of uq_payments_provider_event / usage_events source unique.';

CREATE INDEX idx_vendor_usage_events_vendor_occurred
  ON fin.vendor_usage_events (vendor_id, occurred_at);

CREATE TRIGGER trg_vendor_usage_events_env_vendor
  BEFORE INSERT OR UPDATE ON fin.vendor_usage_events
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_vendor();

-- MUTABLE accumulated header (restates A §11.5 APPEND_ONLY — DL-158).
CREATE TABLE fin.vendor_reported_usage (
  id UUID PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES fin.vendors(id),
  vendor_product_code TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  reporting_period_key TEXT NOT NULL,
  quantity_units BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (vendor_id, vendor_product_code, reporting_period_key)
);

CREATE TRIGGER trg_vendor_reported_usage_bump_version
  BEFORE UPDATE ON fin.vendor_reported_usage
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_vendor_reported_usage_env_vendor
  BEFORE INSERT OR UPDATE ON fin.vendor_reported_usage
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_vendor();

CREATE TABLE fin.vendor_cost_estimates (
  id UUID PRIMARY KEY,
  rated_usage_id UUID NOT NULL REFERENCES fin.rated_usage(id),
  vendor_id UUID NOT NULL REFERENCES fin.vendors(id),
  vendor_product_code TEXT NOT NULL,
  vendor_rate_version_id UUID NOT NULL REFERENCES fin.vendor_rate_versions(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  quantity_units BIGINT NOT NULL,
  unit_cost_minor BIGINT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID
);

COMMENT ON TABLE fin.vendor_cost_estimates IS
  'Re-estimation on rate change INSERTs ACTIVE and flips prior to SUPERSEDED. Audit trail preserved.';

CREATE UNIQUE INDEX uq_vendor_cost_estimates_one_active
  ON fin.vendor_cost_estimates (rated_usage_id)
  WHERE status = 'ACTIVE';

CREATE INDEX idx_vendor_cost_estimates_vendor
  ON fin.vendor_cost_estimates (vendor_id, vendor_product_code, status);

CREATE TRIGGER trg_vendor_cost_estimates_env_vendor
  BEFORE INSERT OR UPDATE ON fin.vendor_cost_estimates
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_vendor();

CREATE TABLE fin.vendor_actual_costs (
  id UUID PRIMARY KEY,
  vendor_statement_line_id UUID,
  vendor_id UUID NOT NULL REFERENCES fin.vendors(id),
  vendor_product_code TEXT NOT NULL,
  rated_usage_id UUID REFERENCES fin.rated_usage(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  quantity_units BIGINT NOT NULL,
  unit_cost_minor BIGINT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID
);

COMMENT ON TABLE fin.vendor_actual_costs IS
  'APPEND_ONLY after parent vendor_statement FINALIZE. vendor_statement_line_id is nullable pre-FINALIZE; FK added in 212.';
COMMENT ON COLUMN fin.vendor_actual_costs.vendor_statement_line_id IS
  'Nullable pre-FINALIZE. FK to fin.vendor_statement_lines added in 212.';

CREATE INDEX idx_vendor_actual_costs_vendor
  ON fin.vendor_actual_costs (vendor_id, vendor_product_code);
CREATE INDEX idx_vendor_actual_costs_rated
  ON fin.vendor_actual_costs (rated_usage_id);

CREATE TRIGGER trg_vendor_actual_costs_env_vendor
  BEFORE INSERT OR UPDATE ON fin.vendor_actual_costs
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_vendor();

ALTER TABLE fin.vendor_usage_events OWNER TO fin_migrator;
ALTER TABLE fin.vendor_reported_usage OWNER TO fin_migrator;
ALTER TABLE fin.vendor_cost_estimates OWNER TO fin_migrator;
ALTER TABLE fin.vendor_actual_costs OWNER TO fin_migrator;

ALTER TABLE fin.vendor_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_usage_events FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_reported_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_reported_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_cost_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_cost_estimates FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_actual_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_actual_costs FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.vendor_usage_events
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_tenant_isolation ON fin.vendor_usage_events
  AS PERMISSIVE FOR ALL
  TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (
      tenant_id IS NULL
      OR tenant_id::text = current_setting('fin.tenant_id', true)
      OR fin.platform_admin_bypass()
    )
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (
      tenant_id IS NULL
      OR tenant_id::text = current_setting('fin.tenant_id', true)
      OR fin.platform_admin_bypass()
    )
  );
CREATE POLICY fin_recon_all_read ON fin.vendor_usage_events
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vendor_reported_usage', 'vendor_cost_estimates', 'vendor_actual_costs'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY fin_migrator_all ON fin.%I FOR ALL TO fin_migrator USING (true) WITH CHECK (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY fin_catalog_app ON fin.%I FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role USING (true) WITH CHECK (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY fin_recon_all_read ON fin.%I FOR SELECT TO fin_recon_role USING (environment = current_setting(''fin.environment'', true))',
      t
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT ON fin.vendor_usage_events TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.vendor_usage_events FROM fin_app_role;

GRANT SELECT, INSERT, UPDATE ON fin.vendor_reported_usage TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.vendor_reported_usage FROM fin_app_role;

GRANT SELECT, INSERT ON fin.vendor_cost_estimates TO fin_app_role;
GRANT UPDATE (status, updated_at, updated_by_actor_type, updated_by_actor_id)
  ON fin.vendor_cost_estimates TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.vendor_cost_estimates FROM fin_app_role;

GRANT SELECT, INSERT ON fin.vendor_actual_costs TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.vendor_actual_costs FROM fin_app_role;

GRANT SELECT ON fin.vendor_usage_events, fin.vendor_reported_usage,
  fin.vendor_cost_estimates, fin.vendor_actual_costs
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
