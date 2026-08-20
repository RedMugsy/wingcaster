-- Stage 8 — fin.facility_reservations (A §8.3 / B §12). INTENT.
-- OPEN → CAPTURED / RELEASED / EXPIRED. DirectSpendPostpaid has hold_id NULL.
-- expires_at is the TTL (A omitted; B expire worker requires it — DL-104).

CREATE TABLE fin.facility_reservations (
  id UUID PRIMARY KEY,
  facility_id UUID NOT NULL REFERENCES fin.credit_facilities(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  hold_id UUID,
  reserved_minor BIGINT NOT NULL CHECK (reserved_minor > 0),
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'OPEN', 'CAPTURED', 'RELEASED', 'EXPIRED'
  )),
  expires_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

COMMENT ON TABLE fin.facility_reservations IS
  'INTENT facility reservation (A §8.3 / B §12). hold_id NULL is legal for DirectSpendPostpaid.';

CREATE INDEX idx_facility_reservations_open
  ON fin.facility_reservations (facility_id)
  WHERE status = 'OPEN';

CREATE INDEX idx_facility_reservations_expiry
  ON fin.facility_reservations (expires_at)
  WHERE status = 'OPEN';

CREATE TRIGGER trg_facility_reservations_bump_version
  BEFORE UPDATE ON fin.facility_reservations
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_facility_reservations_env_tenant
  BEFORE INSERT OR UPDATE ON fin.facility_reservations
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE OR REPLACE FUNCTION fin.trg_facility_reservations_status_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'facility_reservations insert status must be OPEN, got %', NEW.status
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.facility_id IS DISTINCT FROM OLD.facility_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.reserved_minor IS DISTINCT FROM OLD.reserved_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR (OLD.hold_id IS NOT NULL AND NEW.hold_id IS DISTINCT FROM OLD.hold_id)
  THEN
    RAISE EXCEPTION 'facility_reservations economic columns are immutable'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'OPEN' AND NEW.status IN ('CAPTURED', 'RELEASED', 'EXPIRED') THEN
    legal := true;
  END IF;

  IF NOT legal THEN
    RAISE EXCEPTION 'facility_reservations illegal transition % → %', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_facility_reservations_status_flip
  BEFORE INSERT OR UPDATE ON fin.facility_reservations
  FOR EACH ROW EXECUTE FUNCTION fin.trg_facility_reservations_status_flip();

ALTER TABLE fin.facility_reservations OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_facility_reservations_status_flip() OWNER TO fin_migrator;

ALTER TABLE fin.facility_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.facility_reservations FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.facility_reservations
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.facility_reservations
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

CREATE POLICY fin_recon_all_read ON fin.facility_reservations
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.facility_reservations TO fin_app_role;
GRANT UPDATE (
  status, hold_id, captured_at, released_at, expired_at, reason_code,
  updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.facility_reservations TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.facility_reservations FROM fin_app_role;

GRANT SELECT ON fin.facility_reservations
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_facility_reservations_status_flip() TO fin_app_role;
