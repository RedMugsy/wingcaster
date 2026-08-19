-- Stage 4 — prices header + versions + tiers + dimensions (A §7.4–7.7).
-- Catalog-style RLS (H §1.1 / 112 meters pattern). No tenant grain.
-- DL-023 gist is partial: DRAFT rows are excluded so overlap is an
-- activate-time 23P01 (DL-069). commercial.* is not touched.

CREATE TABLE fin.prices (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  code TEXT NOT NULL,
  meter_id UUID REFERENCES fin.meters(id),
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, code)
);

CREATE TRIGGER trg_prices_bump_version
  BEFORE UPDATE ON fin.prices
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.price_versions (
  id UUID PRIMARY KEY,
  price_id UUID NOT NULL REFERENCES fin.prices(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  version_n INTEGER NOT NULL,
  model TEXT NOT NULL CHECK (model IN (
    'PER_UNIT', 'GRADUATED_TIER', 'VOLUME_TIER', 'PACKAGE',
    'INCLUDED_QUANTITY', 'DIMENSIONAL', 'FLAT'
  )),
  unit_rate_minor BIGINT,
  package_size_units BIGINT,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  UNIQUE (price_id, version_n),
  EXCLUDE USING gist (
    price_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz)) WITH &&
  ) WHERE (status IN ('ACTIVE', 'SUPERSEDED'))
);

CREATE TABLE fin.price_tiers (
  id UUID PRIMARY KEY,
  price_version_id UUID NOT NULL REFERENCES fin.price_versions(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tier_no INTEGER NOT NULL CHECK (tier_no >= 1),
  upto_units BIGINT,
  rate_minor BIGINT NOT NULL,
  UNIQUE (price_version_id, tier_no),
  CHECK (upto_units IS NULL OR upto_units > 0)
);

CREATE TABLE fin.price_dimensions (
  id UUID PRIMARY KEY,
  price_version_id UUID NOT NULL REFERENCES fin.price_versions(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  dimension_kind TEXT NOT NULL CHECK (dimension_kind IN (
    'TERRITORY', 'CHANNEL', 'SEGMENT', 'WHATSAPP_CATEGORY', 'RESIDENCY_KEY'
  )),
  dimension_value TEXT NOT NULL,
  unit_rate_minor BIGINT NOT NULL,
  UNIQUE (price_version_id, dimension_kind, dimension_value)
);

CREATE OR REPLACE FUNCTION fin.trg_env_matches_price()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  price_env TEXT;
BEGIN
  SELECT environment INTO price_env FROM fin.prices WHERE id = NEW.price_id;
  IF price_env IS NULL THEN
    RAISE EXCEPTION 'price % not found', NEW.price_id USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM price_env THEN
    RAISE EXCEPTION 'environment % does not match price % (%)',
      NEW.environment, NEW.price_id, price_env
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_price_versions_env_price
  BEFORE INSERT OR UPDATE ON fin.price_versions
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_price();

CREATE OR REPLACE FUNCTION fin.trg_env_matches_price_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_env TEXT;
BEGIN
  SELECT environment INTO version_env
    FROM fin.price_versions WHERE id = NEW.price_version_id;
  IF version_env IS NULL THEN
    RAISE EXCEPTION 'price_version % not found', NEW.price_version_id
      USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM version_env THEN
    RAISE EXCEPTION 'environment % does not match price_version % (%)',
      NEW.environment, NEW.price_version_id, version_env
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_price_tiers_env_version
  BEFORE INSERT OR UPDATE ON fin.price_tiers
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_price_version();

CREATE TRIGGER trg_price_dimensions_env_version
  BEFORE INSERT OR UPDATE ON fin.price_dimensions
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_price_version();

-- ---------------------------------------------------------------------------
-- RLS: catalog-style (H §1.1) — no tenant grain.
-- ---------------------------------------------------------------------------
ALTER TABLE fin.prices OWNER TO fin_migrator;
ALTER TABLE fin.price_versions OWNER TO fin_migrator;
ALTER TABLE fin.price_tiers OWNER TO fin_migrator;
ALTER TABLE fin.price_dimensions OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_env_matches_price() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_env_matches_price_version() OWNER TO fin_migrator;

ALTER TABLE fin.prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.prices FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.price_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.price_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.price_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.price_tiers FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.price_dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.price_dimensions FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.prices
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.price_versions
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.price_tiers
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.price_dimensions
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_catalog_app ON fin.prices
  FOR ALL TO fin_app_role USING (true) WITH CHECK (true);
CREATE POLICY fin_catalog_read ON fin.prices
  FOR SELECT TO fin_finance_role, fin_auditor_role, fin_recon_role USING (true);

CREATE POLICY fin_catalog_app ON fin.price_versions
  FOR INSERT TO fin_app_role WITH CHECK (true);
CREATE POLICY fin_catalog_app_select ON fin.price_versions
  FOR SELECT TO fin_app_role USING (true);
CREATE POLICY fin_catalog_app_update ON fin.price_versions
  FOR UPDATE TO fin_app_role USING (true) WITH CHECK (true);
CREATE POLICY fin_catalog_read ON fin.price_versions
  FOR SELECT TO fin_finance_role, fin_auditor_role, fin_recon_role USING (true);

CREATE POLICY fin_catalog_app ON fin.price_tiers
  FOR INSERT TO fin_app_role WITH CHECK (true);
CREATE POLICY fin_catalog_app_select ON fin.price_tiers
  FOR SELECT TO fin_app_role USING (true);
CREATE POLICY fin_catalog_read ON fin.price_tiers
  FOR SELECT TO fin_finance_role, fin_auditor_role, fin_recon_role USING (true);

CREATE POLICY fin_catalog_app ON fin.price_dimensions
  FOR INSERT TO fin_app_role WITH CHECK (true);
CREATE POLICY fin_catalog_app_select ON fin.price_dimensions
  FOR SELECT TO fin_app_role USING (true);
CREATE POLICY fin_catalog_read ON fin.price_dimensions
  FOR SELECT TO fin_finance_role, fin_auditor_role, fin_recon_role USING (true);

GRANT SELECT, INSERT, UPDATE ON fin.prices TO fin_app_role;
GRANT SELECT, INSERT ON fin.price_versions, fin.price_tiers, fin.price_dimensions
  TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.price_versions, fin.price_tiers, fin.price_dimensions
  FROM fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.prices FROM fin_app_role;

GRANT SELECT ON fin.prices, fin.price_versions, fin.price_tiers, fin.price_dimensions
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_env_matches_price() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_env_matches_price_version() TO fin_app_role;
