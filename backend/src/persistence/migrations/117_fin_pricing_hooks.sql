-- Stage 4 — version status-flip triggers (mirror 114_fin_metering / DL-068).
-- Legal UPDATEs on price_versions / contract_versions:
--   DRAFT → ACTIVE (status only, plus approved_by_approval_id on contracts)
--   ACTIVE → SUPERSEDED (status + effective_to close)
--   ACTIVE stays ACTIVE with effective_to close (deprecate)
-- Any other mutation is rejected. Column-level GRANT is the privilege gate.

CREATE UNIQUE INDEX uq_price_versions_one_active
  ON fin.price_versions (environment, price_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX uq_contract_versions_one_active
  ON fin.contract_versions (environment, contract_id)
  WHERE status = 'ACTIVE';

CREATE OR REPLACE FUNCTION fin.trg_price_version_status_flip_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.price_id IS DISTINCT FROM NEW.price_id
     OR OLD.environment IS DISTINCT FROM NEW.environment
     OR OLD.version_n IS DISTINCT FROM NEW.version_n
     OR OLD.model IS DISTINCT FROM NEW.model
     OR OLD.unit_rate_minor IS DISTINCT FROM NEW.unit_rate_minor
     OR OLD.package_size_units IS DISTINCT FROM NEW.package_size_units
     OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
  THEN
    RAISE EXCEPTION 'price_versions is append-only except status/effective_to'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE'
     AND NEW.effective_to IS NOT DISTINCT FROM OLD.effective_to
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE'
     AND NEW.effective_to IS DISTINCT FROM OLD.effective_to
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'illegal price_version status transition % → %',
    OLD.status, NEW.status
    USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION fin.trg_contract_version_status_flip_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.contract_id IS DISTINCT FROM NEW.contract_id
     OR OLD.environment IS DISTINCT FROM NEW.environment
     OR OLD.version_n IS DISTINCT FROM NEW.version_n
     OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
     OR OLD.amendment_reason IS DISTINCT FROM NEW.amendment_reason
  THEN
    RAISE EXCEPTION 'contract_versions is append-only except status/effective_to/approval'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE'
     AND NEW.effective_to IS NOT DISTINCT FROM OLD.effective_to
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE'
     AND NEW.effective_to IS DISTINCT FROM OLD.effective_to
     AND NEW.approved_by_approval_id IS NOT DISTINCT FROM OLD.approved_by_approval_id
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'illegal contract_version status transition % → %',
    OLD.status, NEW.status
    USING ERRCODE = '22023';
END;
$$;

ALTER FUNCTION fin.trg_price_version_status_flip_only() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_contract_version_status_flip_only() OWNER TO fin_migrator;

CREATE TRIGGER trg_price_version_status_flip_only
  BEFORE UPDATE ON fin.price_versions
  FOR EACH ROW EXECUTE FUNCTION fin.trg_price_version_status_flip_only();

CREATE TRIGGER trg_contract_version_status_flip_only
  BEFORE UPDATE ON fin.contract_versions
  FOR EACH ROW EXECUTE FUNCTION fin.trg_contract_version_status_flip_only();

GRANT UPDATE (status, effective_to) ON fin.price_versions TO fin_app_role;
GRANT UPDATE (status, effective_to, approved_by_approval_id)
  ON fin.contract_versions TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_price_version_status_flip_only() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_contract_version_status_flip_only() TO fin_app_role;
