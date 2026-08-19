-- Stage 3 — metering pipeline support.
-- A §6.5 APPEND_ONLY supersede-via-new-row: the SUPERSEDED status flip is the
-- one legal UPDATE (B §0.2). Column-level GRANT + trigger; OCC is
-- UPDATE … WHERE status = 'ACTIVE' (no version column on APPEND_ONLY).
-- DL-070 / DL-071.

CREATE UNIQUE INDEX uq_metered_usage_one_active
  ON fin.metered_usage (environment, meter_version_id, holder_id, period_key)
  WHERE status = 'ACTIVE';

CREATE OR REPLACE FUNCTION fin.trg_metered_usage_supersede_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'ACTIVE'
     AND NEW.status = 'SUPERSEDED'
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.environment IS NOT DISTINCT FROM OLD.environment
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.meter_version_id IS NOT DISTINCT FROM OLD.meter_version_id
     AND NEW.holder_id IS NOT DISTINCT FROM OLD.holder_id
     AND NEW.period_key IS NOT DISTINCT FROM OLD.period_key
     AND NEW.quantity_units IS NOT DISTINCT FROM OLD.quantity_units
     AND NEW.computation_hash IS NOT DISTINCT FROM OLD.computation_hash
     AND NEW.supersedes_id IS NOT DISTINCT FROM OLD.supersedes_id
     AND NEW.metered_at IS NOT DISTINCT FROM OLD.metered_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'metered_usage is append-only except ACTIVE→SUPERSEDED'
    USING ERRCODE = '22023';
END;
$$;

ALTER FUNCTION fin.trg_metered_usage_supersede_only() OWNER TO fin_migrator;

CREATE TRIGGER trg_metered_usage_supersede_only
  BEFORE UPDATE ON fin.metered_usage
  FOR EACH ROW EXECUTE FUNCTION fin.trg_metered_usage_supersede_only();

GRANT UPDATE (status) ON fin.metered_usage TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_metered_usage_supersede_only() TO fin_app_role;
