-- Stage 2 — meters (MUTABLE header) + meter_versions (VERSIONED / APPEND_ONLY)
-- A §6.3–6.4 / DL-023 overlap exclusion.

CREATE TABLE fin.meters (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, code)
);

CREATE TRIGGER trg_meters_bump_version
  BEFORE UPDATE ON fin.meters
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.meter_versions (
  id UUID PRIMARY KEY,
  meter_id UUID NOT NULL REFERENCES fin.meters(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  version_n INTEGER NOT NULL,
  aggregation_type TEXT NOT NULL CHECK (aggregation_type IN (
    'COUNT', 'SUM', 'MAX', 'UNIQUE_COUNT', 'LATEST', 'TIME_WEIGHTED'
  )),
  filter_definition JSONB NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  UNIQUE (meter_id, version_n),
  EXCLUDE USING gist (
    meter_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz)) WITH &&
  )
);

CREATE OR REPLACE FUNCTION fin.trg_env_matches_meter()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  meter_env TEXT;
BEGIN
  SELECT environment INTO meter_env FROM fin.meters WHERE id = NEW.meter_id;
  IF meter_env IS NULL THEN
    RAISE EXCEPTION 'meter % not found', NEW.meter_id USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM meter_env THEN
    RAISE EXCEPTION 'environment % does not match meter % (%)',
      NEW.environment, NEW.meter_id, meter_env
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_meter_versions_env_meter
  BEFORE INSERT OR UPDATE ON fin.meter_versions
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_meter();

-- ---------------------------------------------------------------------------
-- RLS: catalog-style (H §1.2) — no tenant grain.
-- ---------------------------------------------------------------------------
ALTER TABLE fin.meters OWNER TO fin_migrator;
ALTER TABLE fin.meter_versions OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_env_matches_meter() OWNER TO fin_migrator;

ALTER TABLE fin.meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.meters FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.meter_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.meter_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.meters
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.meter_versions
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_catalog_app ON fin.meters
  FOR ALL TO fin_app_role USING (true) WITH CHECK (true);
CREATE POLICY fin_catalog_read ON fin.meters
  FOR SELECT TO fin_finance_role, fin_auditor_role, fin_recon_role USING (true);

-- Header is MUTABLE (INSERT/UPDATE). Version rows are APPEND_ONLY: INSERT+SELECT
-- only; REVOKE UPDATE below is the mutability control (A §1.1 VERSIONED).
CREATE POLICY fin_catalog_app ON fin.meter_versions
  FOR INSERT TO fin_app_role WITH CHECK (true);
CREATE POLICY fin_catalog_app_select ON fin.meter_versions
  FOR SELECT TO fin_app_role USING (true);
CREATE POLICY fin_catalog_read ON fin.meter_versions
  FOR SELECT TO fin_finance_role, fin_auditor_role, fin_recon_role USING (true);

GRANT SELECT, INSERT, UPDATE ON fin.meters TO fin_app_role;
GRANT SELECT, INSERT ON fin.meter_versions TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.meter_versions FROM fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.meters FROM fin_app_role;

GRANT SELECT ON fin.meters, fin.meter_versions
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_env_matches_meter() TO fin_app_role;
