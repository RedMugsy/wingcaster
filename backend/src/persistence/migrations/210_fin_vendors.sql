-- Stage 11 — vendors + products + rate cards + rate versions + meter map
-- (A §11.1–11.3 restated). Catalog-style RLS (no tenant_id). Rate-version
-- machine: DRAFT → ACTIVE → DEPRECATED (DL-158). Gap-fill of prior ACTIVE
-- effective_to is application-side (Stage 4 / 117 pattern). commercial.*
-- is not touched.

CREATE TABLE fin.vendors (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  name TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  contact_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_vendors_bump_version
  BEFORE UPDATE ON fin.vendors
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.vendor_products (
  id UUID PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES fin.vendors(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  product_code TEXT NOT NULL,
  product_class TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (vendor_id, product_code)
);

CREATE TRIGGER trg_vendor_products_bump_version
  BEFORE UPDATE ON fin.vendor_products
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.vendor_rate_cards (
  id UUID PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES fin.vendors(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_vendor_rate_cards_bump_version
  BEFORE UPDATE ON fin.vendor_rate_cards
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.vendor_rate_versions (
  id UUID PRIMARY KEY,
  rate_card_id UUID NOT NULL REFERENCES fin.vendor_rate_cards(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  version_n INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'DEPRECATED')),
  rates JSONB NOT NULL,
  UNIQUE (rate_card_id, version_n),
  CHECK (jsonb_typeof(rates) = 'object'),
  EXCLUDE USING gist (
    rate_card_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz)) WITH &&
  ) WHERE (status IN ('ACTIVE', 'DEPRECATED'))
);

COMMENT ON COLUMN fin.vendor_rate_versions.rates IS
  'Per product_code → {unit_cost_minor, currency}. BIGINT minor units only.';

CREATE UNIQUE INDEX uq_vendor_rate_versions_one_active
  ON fin.vendor_rate_versions (environment, rate_card_id)
  WHERE status = 'ACTIVE';

-- Meter → vendor mapping. Stage 3 meters have filter_definition, not
-- dimensions (DL-153). Silent skip at rating time when no row exists.
CREATE TABLE fin.meter_vendor_map (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  meter_id UUID NOT NULL REFERENCES fin.meters(id),
  vendor_id UUID NOT NULL REFERENCES fin.vendors(id),
  vendor_product_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, meter_id)
);

CREATE TRIGGER trg_meter_vendor_map_bump_version
  BEFORE UPDATE ON fin.meter_vendor_map
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE OR REPLACE FUNCTION fin.trg_env_matches_vendor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  vendor_env TEXT;
BEGIN
  SELECT environment INTO vendor_env FROM fin.vendors WHERE id = NEW.vendor_id;
  IF vendor_env IS NULL THEN
    RAISE EXCEPTION 'vendor % not found', NEW.vendor_id USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM vendor_env THEN
    RAISE EXCEPTION 'environment % does not match vendor % (%)',
      NEW.environment, NEW.vendor_id, vendor_env
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_products_env_vendor
  BEFORE INSERT OR UPDATE ON fin.vendor_products
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_vendor();
CREATE TRIGGER trg_vendor_rate_cards_env_vendor
  BEFORE INSERT OR UPDATE ON fin.vendor_rate_cards
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_vendor();
CREATE TRIGGER trg_meter_vendor_map_env_vendor
  BEFORE INSERT OR UPDATE ON fin.meter_vendor_map
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_vendor();

CREATE OR REPLACE FUNCTION fin.trg_env_matches_vendor_rate_card()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  card_env TEXT;
BEGIN
  SELECT environment INTO card_env FROM fin.vendor_rate_cards WHERE id = NEW.rate_card_id;
  IF card_env IS NULL THEN
    RAISE EXCEPTION 'vendor_rate_card % not found', NEW.rate_card_id
      USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM card_env THEN
    RAISE EXCEPTION 'environment % does not match vendor_rate_card % (%)',
      NEW.environment, NEW.rate_card_id, card_env
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_rate_versions_env_card
  BEFORE INSERT OR UPDATE ON fin.vendor_rate_versions
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_vendor_rate_card();

-- Status-flip mirrors Stage 4 price_versions (117) with DEPRECATED in
-- place of SUPERSEDED (DL-158). Gap-fill is app-side.
CREATE OR REPLACE FUNCTION fin.trg_vendor_rate_version_status_flip_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.rate_card_id IS DISTINCT FROM NEW.rate_card_id
     OR OLD.environment IS DISTINCT FROM NEW.environment
     OR OLD.version_n IS DISTINCT FROM NEW.version_n
     OR OLD.rates IS DISTINCT FROM NEW.rates
     OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
  THEN
    RAISE EXCEPTION 'vendor_rate_versions is append-only except status/effective_to'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE'
     AND NEW.effective_to IS NOT DISTINCT FROM OLD.effective_to
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ACTIVE' AND NEW.status = 'DEPRECATED' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE'
     AND NEW.effective_to IS DISTINCT FROM OLD.effective_to
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'illegal vendor_rate_version status transition % → %',
    OLD.status, NEW.status
    USING ERRCODE = '22023';
END;
$$;

CREATE TRIGGER trg_vendor_rate_version_status_flip_only
  BEFORE UPDATE ON fin.vendor_rate_versions
  FOR EACH ROW EXECUTE FUNCTION fin.trg_vendor_rate_version_status_flip_only();

ALTER TABLE fin.vendors OWNER TO fin_migrator;
ALTER TABLE fin.vendor_products OWNER TO fin_migrator;
ALTER TABLE fin.vendor_rate_cards OWNER TO fin_migrator;
ALTER TABLE fin.vendor_rate_versions OWNER TO fin_migrator;
ALTER TABLE fin.meter_vendor_map OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_env_matches_vendor() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_env_matches_vendor_rate_card() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_vendor_rate_version_status_flip_only() OWNER TO fin_migrator;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vendors', 'vendor_products', 'vendor_rate_cards',
    'vendor_rate_versions', 'meter_vendor_map'
  ]
  LOOP
    EXECUTE format('ALTER TABLE fin.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE fin.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY fin_migrator_all ON fin.%I FOR ALL TO fin_migrator USING (true) WITH CHECK (true)',
      t
    );
    -- Catalog (no tenant_id). App/finance/auditor see all rows in-role;
    -- recon is environment-scoped. Mirrors 115 prices (DL-158).
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

GRANT SELECT, INSERT, UPDATE ON fin.vendors TO fin_app_role;
GRANT SELECT, INSERT, UPDATE ON fin.vendor_products TO fin_app_role;
GRANT SELECT, INSERT, UPDATE ON fin.vendor_rate_cards TO fin_app_role;
GRANT SELECT, INSERT ON fin.vendor_rate_versions TO fin_app_role;
GRANT UPDATE (status, effective_to) ON fin.vendor_rate_versions TO fin_app_role;
GRANT SELECT, INSERT, UPDATE ON fin.meter_vendor_map TO fin_app_role;

REVOKE DELETE, TRUNCATE ON fin.vendors FROM fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.vendor_products FROM fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.vendor_rate_cards FROM fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.vendor_rate_versions FROM fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.meter_vendor_map FROM fin_app_role;

GRANT SELECT ON fin.vendors, fin.vendor_products, fin.vendor_rate_cards,
  fin.vendor_rate_versions, fin.meter_vendor_map
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_env_matches_vendor() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_env_matches_vendor_rate_card() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_vendor_rate_version_status_flip_only() TO fin_app_role;
