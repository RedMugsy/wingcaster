-- Stage 8 — fin.credit_facilities (A §8.2 / B §18). MUTABLE header.
-- Status machine: PENDING → ACTIVE/CLOSED; ACTIVE → PAUSED/SUSPENDED/CLOSED;
-- PAUSED → ACTIVE/CLOSED; SUSPENDED → ACTIVE/CLOSED. CLOSED terminal.
-- DL-104…DL-112. limit_minor is mutable on ACTIVE/PAUSED (B §18, no separate
-- amendment machine). currency added (A omitted; money without currency is
-- illegal — DL-110). UNIQUE (environment, billing_account_id, currency)
-- (A omitted kind — DL-111).

CREATE TABLE fin.credit_facilities (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  currency CHAR(3) NOT NULL,
  limit_minor BIGINT NOT NULL CHECK (limit_minor > 0),
  net_terms_days INTEGER NOT NULL CHECK (net_terms_days > 0),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'CLOSED'
  )),
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, billing_account_id, currency)
);

COMMENT ON TABLE fin.credit_facilities IS
  'MUTABLE postpaid facility header (A §8.2 / B §18). limit_minor mutable on ACTIVE/PAUSED with FACILITY_OPS (DL-110/111).';

CREATE INDEX idx_credit_facilities_billing_status
  ON fin.credit_facilities (billing_account_id, status);

CREATE TRIGGER trg_credit_facilities_bump_version
  BEFORE UPDATE ON fin.credit_facilities
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_credit_facilities_env_tenant
  BEFORE INSERT OR UPDATE ON fin.credit_facilities
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE OR REPLACE FUNCTION fin.trg_credit_facilities_status_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'credit_facilities insert status must be PENDING, got %', NEW.status
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.net_terms_days IS DISTINCT FROM OLD.net_terms_days
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
  THEN
    RAISE EXCEPTION 'credit_facilities identity columns are immutable'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'CLOSED' AND NEW.limit_minor IS DISTINCT FROM OLD.limit_minor THEN
    RAISE EXCEPTION 'credit_facilities.limit_minor is immutable after CLOSED'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'PENDING' AND NEW.status IN ('ACTIVE', 'CLOSED') THEN
    legal := true;
  ELSIF OLD.status = 'ACTIVE' AND NEW.status IN ('PAUSED', 'SUSPENDED', 'CLOSED') THEN
    legal := true;
  ELSIF OLD.status = 'PAUSED' AND NEW.status IN ('ACTIVE', 'CLOSED') THEN
    legal := true;
  ELSIF OLD.status = 'SUSPENDED' AND NEW.status IN ('ACTIVE', 'CLOSED') THEN
    legal := true;
  END IF;

  IF NOT legal THEN
    RAISE EXCEPTION 'credit_facilities illegal transition % → %', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_credit_facilities_status_flip
  BEFORE INSERT OR UPDATE ON fin.credit_facilities
  FOR EACH ROW EXECUTE FUNCTION fin.trg_credit_facilities_status_flip();

ALTER TABLE fin.credit_facilities OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_credit_facilities_status_flip() OWNER TO fin_migrator;

ALTER TABLE fin.credit_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.credit_facilities FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.credit_facilities
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.credit_facilities
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

CREATE POLICY fin_recon_all_read ON fin.credit_facilities
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.credit_facilities TO fin_app_role;
GRANT UPDATE (
  status, limit_minor, valid_to, reason_code,
  updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.credit_facilities TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.credit_facilities FROM fin_app_role;

GRANT SELECT ON fin.credit_facilities
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_credit_facilities_status_flip() TO fin_app_role;
