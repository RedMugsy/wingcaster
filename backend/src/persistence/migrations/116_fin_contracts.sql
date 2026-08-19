-- Stage 4 — contracts + versions + components (A §7.1–7.3 / DL-029).
-- Tenant-scoped RLS on the header; versions and components inherit via join
-- (113 metered_usage_sources pattern). commercial.* is not touched.
-- facility_id is UUID without FK until Stage 8 creates fin.credit_facilities (DL-071).

CREATE TABLE fin.contracts (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  seller_legal_entity_id UUID NOT NULL REFERENCES fin.platform_legal_entities(id),
  contract_number TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'EXPIRED'
  )),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  billing_currency CHAR(3) NOT NULL,
  billing_timezone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (seller_legal_entity_id, contract_number)
);

CREATE TRIGGER trg_contracts_bump_version
  BEFORE UPDATE ON fin.contracts
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_contracts_env_tenant
  BEFORE INSERT OR UPDATE ON fin.contracts
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE TABLE fin.contract_versions (
  id UUID PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES fin.contracts(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  version_n INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  amendment_reason TEXT,
  approved_by_approval_id UUID REFERENCES fin.approval_requests(id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  UNIQUE (contract_id, version_n),
  EXCLUDE USING gist (
    contract_id WITH =,
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz)) WITH &&
  ) WHERE (status IN ('ACTIVE', 'SUPERSEDED'))
);

CREATE TABLE fin.contract_components (
  id UUID PRIMARY KEY,
  contract_version_id UUID NOT NULL REFERENCES fin.contract_versions(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  component_type TEXT NOT NULL CHECK (component_type IN (
    'SUBSCRIPTION', 'PREPAID_COMMITMENT', 'INCLUDED_ALLOWANCE', 'METER_PRICE',
    'OVERAGE_PRICE', 'MINIMUM_SPEND', 'PROMOTIONAL_GRANT', 'ENTITLEMENT',
    'CREDIT_FACILITY', 'ROLLOVER', 'USAGE_LIMIT', 'BILLING_RULE'
  )),
  price_id UUID REFERENCES fin.prices(id),
  meter_id UUID REFERENCES fin.meters(id),
  facility_id UUID,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID
);

CREATE OR REPLACE FUNCTION fin.trg_env_matches_contract()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  contract_env TEXT;
BEGIN
  SELECT environment INTO contract_env FROM fin.contracts WHERE id = NEW.contract_id;
  IF contract_env IS NULL THEN
    RAISE EXCEPTION 'contract % not found', NEW.contract_id USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM contract_env THEN
    RAISE EXCEPTION 'environment % does not match contract % (%)',
      NEW.environment, NEW.contract_id, contract_env
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contract_versions_env_contract
  BEFORE INSERT OR UPDATE ON fin.contract_versions
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_contract();

CREATE OR REPLACE FUNCTION fin.trg_env_matches_contract_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_env TEXT;
BEGIN
  SELECT environment INTO version_env
    FROM fin.contract_versions WHERE id = NEW.contract_version_id;
  IF version_env IS NULL THEN
    RAISE EXCEPTION 'contract_version % not found', NEW.contract_version_id
      USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM version_env THEN
    RAISE EXCEPTION 'environment % does not match contract_version % (%)',
      NEW.environment, NEW.contract_version_id, version_env
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contract_components_env_version
  BEFORE INSERT OR UPDATE ON fin.contract_components
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_contract_version();

-- B §0.2: DRAFT-version components may be rewritten; ACTIVE/SUPERSEDED frozen.
CREATE OR REPLACE FUNCTION fin.trg_contract_components_draft_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_status TEXT;
  parent_id UUID;
BEGIN
  parent_id := COALESCE(NEW.contract_version_id, OLD.contract_version_id);
  SELECT status INTO version_status
    FROM fin.contract_versions WHERE id = parent_id;
  IF version_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'contract_components may only be written on DRAFT versions'
      USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_contract_components_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON fin.contract_components
  FOR EACH ROW EXECUTE FUNCTION fin.trg_contract_components_draft_only();

-- ---------------------------------------------------------------------------
-- RLS: tenant-scoped header; children inherit via join (H §1.2).
-- ---------------------------------------------------------------------------
ALTER TABLE fin.contracts OWNER TO fin_migrator;
ALTER TABLE fin.contract_versions OWNER TO fin_migrator;
ALTER TABLE fin.contract_components OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_env_matches_contract() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_env_matches_contract_version() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_contract_components_draft_only() OWNER TO fin_migrator;

ALTER TABLE fin.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.contract_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.contract_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.contract_components FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.contracts
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.contract_versions
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.contract_components
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.contracts
  AS PERMISSIVE FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
  );

CREATE POLICY fin_recon_all_read ON fin.contracts
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

CREATE POLICY fin_contract_versions_via_parent ON fin.contract_versions
  AS PERMISSIVE FOR ALL
  TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    EXISTS (
      SELECT 1 FROM fin.contracts c
       WHERE c.id = contract_versions.contract_id
         AND c.environment = current_setting('fin.environment', true)
         AND (c.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM fin.contracts c
       WHERE c.id = contract_versions.contract_id
         AND c.environment = current_setting('fin.environment', true)
         AND (c.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  );

CREATE POLICY fin_recon_all_read ON fin.contract_versions
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

CREATE POLICY fin_contract_components_via_parent ON fin.contract_components
  AS PERMISSIVE FOR ALL
  TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    EXISTS (
      SELECT 1 FROM fin.contract_versions cv
      JOIN fin.contracts c ON c.id = cv.contract_id
       WHERE cv.id = contract_components.contract_version_id
         AND c.environment = current_setting('fin.environment', true)
         AND (c.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM fin.contract_versions cv
      JOIN fin.contracts c ON c.id = cv.contract_id
       WHERE cv.id = contract_components.contract_version_id
         AND c.environment = current_setting('fin.environment', true)
         AND (c.tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
    )
  );

CREATE POLICY fin_recon_all_read ON fin.contract_components
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT, UPDATE ON fin.contracts TO fin_app_role;
GRANT SELECT, INSERT ON fin.contract_versions TO fin_app_role;
GRANT SELECT, INSERT, UPDATE ON fin.contract_components TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.contract_versions FROM fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.contracts, fin.contract_components FROM fin_app_role;

GRANT SELECT ON fin.contracts, fin.contract_versions, fin.contract_components
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_env_matches_contract() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_env_matches_contract_version() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_contract_components_draft_only() TO fin_app_role;
