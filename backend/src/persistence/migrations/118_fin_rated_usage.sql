-- Stage 5 — fin.rated_usage (A §6.7). APPEND_ONLY facts; no ledger_transactions (C §6).
-- billing_period_id / accounting_period_id are reserved UUIDs without FK
-- until Stage 10 / Stage 9 (DL-080). late_class is CHECK-constrained.
-- rating_hash preimage lives in explanation; fin.canonical_json is the
-- SQL twin of backend/src/fin/metering/hash.js (DL-082).

CREATE TABLE fin.rated_usage (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  metered_usage_id UUID NOT NULL REFERENCES fin.metered_usage(id),
  contract_version_id UUID NOT NULL REFERENCES fin.contract_versions(id),
  price_version_id UUID NOT NULL REFERENCES fin.price_versions(id),
  billing_period_id UUID,
  accounting_period_id UUID,
  measured_units BIGINT NOT NULL,
  included_units BIGINT NOT NULL DEFAULT 0,
  billable_units BIGINT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  rating_hash TEXT NOT NULL,
  explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
  late_class TEXT NOT NULL CHECK (late_class IN (
    'OPEN_PERIOD', 'PRE_INVOICE', 'POST_INVOICE', 'CLOSED_ACCOUNTING'
  )),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  metered_at TIMESTAMPTZ NOT NULL,
  rated_at TIMESTAMPTZ NOT NULL,
  accounting_effective_period TEXT,
  adjustment_of_id UUID REFERENCES fin.rated_usage(id),
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (billable_units = GREATEST(measured_units - included_units, 0))
);

-- One original rating per metered_usage; re-rates chain via adjustment_of_id.
CREATE UNIQUE INDEX uq_rated_usage_original
  ON fin.rated_usage (environment, metered_usage_id)
  WHERE adjustment_of_id IS NULL;

CREATE INDEX idx_rated_usage_tenant_rated_at
  ON fin.rated_usage (tenant_id, rated_at DESC);
CREATE INDEX idx_rated_usage_billing_period_late
  ON fin.rated_usage (billing_period_id, late_class);
CREATE INDEX idx_rated_usage_rating_hash
  ON fin.rated_usage (rating_hash);
CREATE INDEX idx_rated_usage_adjustment_of
  ON fin.rated_usage (adjustment_of_id);
CREATE INDEX idx_rated_usage_metered_rated_at
  ON fin.rated_usage (metered_usage_id, rated_at DESC);

CREATE TRIGGER trg_rated_usage_env_tenant
  BEFORE INSERT ON fin.rated_usage
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE OR REPLACE FUNCTION fin.trg_rated_usage_env_parents()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  metered_env TEXT;
  cv_env TEXT;
  pv_env TEXT;
BEGIN
  SELECT environment INTO metered_env FROM fin.metered_usage WHERE id = NEW.metered_usage_id;
  IF metered_env IS NULL THEN
    RAISE EXCEPTION 'metered_usage % not found', NEW.metered_usage_id USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM metered_env THEN
    RAISE EXCEPTION 'environment % does not match metered_usage % (%)',
      NEW.environment, NEW.metered_usage_id, metered_env
      USING ERRCODE = '23514';
  END IF;

  SELECT environment INTO cv_env FROM fin.contract_versions WHERE id = NEW.contract_version_id;
  IF cv_env IS NULL THEN
    RAISE EXCEPTION 'contract_version % not found', NEW.contract_version_id USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM cv_env THEN
    RAISE EXCEPTION 'environment % does not match contract_version % (%)',
      NEW.environment, NEW.contract_version_id, cv_env
      USING ERRCODE = '23514';
  END IF;

  SELECT environment INTO pv_env FROM fin.price_versions WHERE id = NEW.price_version_id;
  IF pv_env IS NULL THEN
    RAISE EXCEPTION 'price_version % not found', NEW.price_version_id USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM pv_env THEN
    RAISE EXCEPTION 'environment % does not match price_version % (%)',
      NEW.environment, NEW.price_version_id, pv_env
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rated_usage_env_parents
  BEFORE INSERT ON fin.rated_usage
  FOR EACH ROW EXECUTE FUNCTION fin.trg_rated_usage_env_parents();

-- RFC 8785 subset: sorted object keys, no whitespace. Twin of
-- backend/src/fin/metering/hash.js canonicalJson (DL-082).
CREATE OR REPLACE FUNCTION fin.canonical_json(val jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t text;
  k text;
  parts text[] := ARRAY[]::text[];
  i int;
  n int;
BEGIN
  IF val IS NULL THEN
    RETURN 'null';
  END IF;
  t := jsonb_typeof(val);
  IF t = 'null' THEN
    RETURN 'null';
  ELSIF t = 'boolean' THEN
    IF val = 'true'::jsonb THEN RETURN 'true'; ELSE RETURN 'false'; END IF;
  ELSIF t = 'number' THEN
    RETURN val #>> '{}';
  ELSIF t = 'string' THEN
    RETURN to_json(val #>> '{}')::text;
  ELSIF t = 'array' THEN
    n := COALESCE(jsonb_array_length(val), 0);
    IF n = 0 THEN
      RETURN '[]';
    END IF;
    FOR i IN 0..n-1 LOOP
      parts := array_append(parts, fin.canonical_json(val -> i));
    END LOOP;
    RETURN '[' || array_to_string(parts, ',') || ']';
  ELSIF t = 'object' THEN
    FOR k IN SELECT jsonb_object_keys(val) ORDER BY 1
    LOOP
      parts := array_append(
        parts,
        to_json(k)::text || ':' || fin.canonical_json(val -> k)
      );
    END LOOP;
    RETURN '{' || array_to_string(parts, ',') || '}';
  END IF;
  RETURN 'null';
END;
$$;

ALTER TABLE fin.rated_usage OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_rated_usage_env_parents() OWNER TO fin_migrator;
ALTER FUNCTION fin.canonical_json(jsonb) OWNER TO fin_migrator;

ALTER TABLE fin.rated_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.rated_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.rated_usage
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.rated_usage
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

CREATE POLICY fin_recon_all_read ON fin.rated_usage
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.rated_usage TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.rated_usage FROM fin_app_role;

GRANT SELECT ON fin.rated_usage
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_rated_usage_env_parents() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.canonical_json(jsonb)
  TO fin_app_role, fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
