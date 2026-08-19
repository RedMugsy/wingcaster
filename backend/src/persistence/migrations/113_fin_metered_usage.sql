-- Stage 2 — metered_usage + metered_usage_sources (A §6.5–6.6 / DL-021 M1).
-- Schema only: the metering pipeline that WRITES these tables is Stage 3.

CREATE TABLE fin.metered_usage (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  meter_version_id UUID NOT NULL REFERENCES fin.meter_versions(id),
  holder_id UUID NOT NULL REFERENCES fin.holders(id),
  period_key TEXT NOT NULL,
  quantity_units BIGINT NOT NULL,
  computation_hash TEXT NOT NULL,
  supersedes_id UUID REFERENCES fin.metered_usage(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  metered_at TIMESTAMPTZ NOT NULL
);

CREATE TRIGGER trg_metered_usage_env_tenant
  BEFORE INSERT ON fin.metered_usage
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

-- A §18 #6 / DL-005: TEST metered_usage cannot reference a LIVE meter_version.
CREATE OR REPLACE FUNCTION fin.trg_metered_usage_env_meter_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_env TEXT;
BEGIN
  SELECT environment INTO version_env FROM fin.meter_versions WHERE id = NEW.meter_version_id;
  IF version_env IS NULL THEN
    RAISE EXCEPTION 'meter_version % not found', NEW.meter_version_id USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM version_env THEN
    RAISE EXCEPTION 'environment % does not match meter_version % (%)',
      NEW.environment, NEW.meter_version_id, version_env
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_metered_usage_env_meter_version
  BEFORE INSERT ON fin.metered_usage
  FOR EACH ROW EXECUTE FUNCTION fin.trg_metered_usage_env_meter_version();

ALTER FUNCTION fin.trg_metered_usage_env_meter_version() OWNER TO fin_migrator;

CREATE TABLE fin.metered_usage_sources (
  metered_usage_id UUID NOT NULL REFERENCES fin.metered_usage(id),
  usage_event_id UUID NOT NULL,
  residency_key TEXT NOT NULL,
  contribution_units BIGINT NOT NULL,
  PRIMARY KEY (metered_usage_id, usage_event_id, residency_key),
  FOREIGN KEY (usage_event_id, residency_key)
    REFERENCES fin.usage_events (id, residency_key)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE fin.metered_usage OWNER TO fin_migrator;
ALTER TABLE fin.metered_usage_sources OWNER TO fin_migrator;

ALTER TABLE fin.metered_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.metered_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.metered_usage_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.metered_usage_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.metered_usage
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.metered_usage_sources
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.metered_usage
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

CREATE POLICY fin_recon_all_read ON fin.metered_usage
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

-- Sources inherit tenant grain via the parent metered_usage row (H §1.2 join).
CREATE POLICY fin_metered_sources_via_parent ON fin.metered_usage_sources
  AS PERMISSIVE FOR ALL
  TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    EXISTS (
      SELECT 1 FROM fin.metered_usage m
       WHERE m.id = metered_usage_sources.metered_usage_id
         AND m.environment = current_setting('fin.environment', true)
         AND (m.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM fin.metered_usage m
       WHERE m.id = metered_usage_sources.metered_usage_id
         AND m.environment = current_setting('fin.environment', true)
         AND (m.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  );

CREATE POLICY fin_recon_all_read ON fin.metered_usage_sources
  FOR SELECT TO fin_recon_role
  USING (
    EXISTS (
      SELECT 1 FROM fin.metered_usage m
       WHERE m.id = metered_usage_sources.metered_usage_id
         AND m.environment = current_setting('fin.environment', true)
    )
  );

GRANT SELECT, INSERT ON fin.metered_usage, fin.metered_usage_sources TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.metered_usage, fin.metered_usage_sources FROM fin_app_role;

GRANT SELECT ON fin.metered_usage, fin.metered_usage_sources
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_metered_usage_env_meter_version() TO fin_app_role;
