-- Stage 1 command-service follow-up (D §2, DL-032, DL-039).

CREATE OR REPLACE FUNCTION fin.account_type_rank(p_type TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'ISSUANCE' THEN 10
    WHEN 'AVAILABLE' THEN 20
    WHEN 'HELD' THEN 30
    WHEN 'CONSUMED' THEN 40
    WHEN 'EXPIRED' THEN 50
    WHEN 'ADJUSTMENT' THEN 60
    WHEN 'CLEARING' THEN 70
    ELSE 90
  END;
$$;

ALTER TABLE fin.idempotency_keys
  DROP CONSTRAINT IF EXISTS idempotency_keys_status_check;
ALTER TABLE fin.idempotency_keys
  ADD CONSTRAINT idempotency_keys_status_check
  CHECK (status IN ('IN_FLIGHT', 'COMPLETED', 'FAILED', 'EXPIRED'));

ALTER TABLE fin.idempotency_keys
  DROP CONSTRAINT IF EXISTS idempotency_keys_environment_tenant_id_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_keys_tenant
  ON fin.idempotency_keys (environment, tenant_id, key)
  WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_keys_platform
  ON fin.idempotency_keys (environment, key)
  WHERE tenant_id IS NULL;

CREATE OR REPLACE FUNCTION fin.trg_idempotency_completed_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'COMPLETED' AND NEW.status IS DISTINCT FROM 'EXPIRED' AND NEW.status IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'COMPLETED idempotency key is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'EXPIRED' AND NEW.status IS DISTINCT FROM 'EXPIRED' THEN
    RAISE EXCEPTION 'EXPIRED idempotency key is terminal'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_idempotency_completed_immutable ON fin.idempotency_keys;
CREATE TRIGGER trg_idempotency_completed_immutable
  BEFORE UPDATE ON fin.idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION fin.trg_idempotency_completed_immutable();

ALTER TABLE fin.reconciliation_runs
  DROP CONSTRAINT IF EXISTS reconciliation_runs_status_check;
ALTER TABLE fin.reconciliation_runs
  ADD CONSTRAINT reconciliation_runs_status_check
  CHECK (status IN ('STARTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED'));
