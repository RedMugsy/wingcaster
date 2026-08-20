-- Stage 9 — fin.accounting_periods (A §9.0 / B §550 / DL-016).
-- Legal-entity SOX close. NOT billing_periods.
-- HARD_CLOSED insert reject for accounting_events lives here (table now exists).

CREATE TABLE fin.accounting_periods (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  legal_entity_id UUID NOT NULL REFERENCES fin.platform_legal_entities(id),
  period_key TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'SOFT_CLOSED', 'HARD_CLOSED')),
  closed_at TIMESTAMPTZ,
  closed_by_actor_id UUID,
  reconciliation_override_approval_id UUID REFERENCES fin.approval_requests(id),
  ever_hard_closed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT chk_accounting_period_window CHECK (ends_at > starts_at)
);

COMMENT ON TABLE fin.accounting_periods IS
  'INTENT legal-entity close (A §9.0 / B §550). starts_at/ends_at are A names (plan period_start/period_end — DL-125).';
COMMENT ON COLUMN fin.accounting_periods.ever_hard_closed IS
  'A omitted; B §550 SOFT→OPEN is forbidden once this row has been HARD_CLOSED (DL-125).';

CREATE UNIQUE INDEX uq_accounting_periods_key
  ON fin.accounting_periods (environment, legal_entity_id, period_key);
CREATE UNIQUE INDEX uq_accounting_periods_window
  ON fin.accounting_periods (environment, legal_entity_id, starts_at, ends_at);
CREATE INDEX idx_accounting_periods_entity_status
  ON fin.accounting_periods (legal_entity_id, status, period_key);

CREATE TRIGGER trg_accounting_periods_bump_version
  BEFORE UPDATE ON fin.accounting_periods
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE OR REPLACE FUNCTION fin.trg_accounting_periods_status_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'ACCOUNTING_PERIOD_SKIP_TO_HARD'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.period_key IS DISTINCT FROM OLD.period_key
     OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
     OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
  THEN
    RAISE EXCEPTION 'accounting_periods identity columns are immutable'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'OPEN' AND NEW.status = 'SOFT_CLOSED' THEN
    legal := true;
  ELSIF OLD.status = 'SOFT_CLOSED' AND NEW.status = 'HARD_CLOSED' THEN
    legal := true;
    NEW.ever_hard_closed := true;
  ELSIF OLD.status = 'HARD_CLOSED' AND NEW.status = 'SOFT_CLOSED' THEN
    legal := true;
  ELSIF OLD.status = 'SOFT_CLOSED' AND NEW.status = 'OPEN' THEN
    RAISE EXCEPTION 'ACCOUNTING_PERIOD_CANNOT_FULLY_REOPEN'
      USING ERRCODE = 'P0001';
  ELSIF OLD.status = 'OPEN' AND NEW.status = 'HARD_CLOSED' THEN
    RAISE EXCEPTION 'ACCOUNTING_PERIOD_SKIP_TO_HARD'
      USING ERRCODE = 'P0001';
  ELSIF OLD.status = 'HARD_CLOSED' AND NEW.status = 'OPEN' THEN
    RAISE EXCEPTION 'ACCOUNTING_PERIOD_CANNOT_FULLY_REOPEN'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT legal THEN
    RAISE EXCEPTION 'accounting_periods illegal transition % → %', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_accounting_periods_status_flip
  BEFORE INSERT OR UPDATE ON fin.accounting_periods
  FOR EACH ROW EXECUTE FUNCTION fin.trg_accounting_periods_status_flip();

ALTER TABLE fin.accounting_events
  ADD CONSTRAINT fk_accounting_events_period
  FOREIGN KEY (accounting_period_id)
  REFERENCES fin.accounting_periods(id);

-- Audit M2 / B20: reject INSERT into a HARD_CLOSED period.
CREATE OR REPLACE FUNCTION fin.trg_accounting_events_reject_hard_closed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  period_status TEXT;
  period_start TIMESTAMPTZ;
  period_end TIMESTAMPTZ;
BEGIN
  SELECT status, starts_at, ends_at
    INTO period_status, period_start, period_end
    FROM fin.accounting_periods
   WHERE id = NEW.accounting_period_id;

  IF period_status IS NULL THEN
    RAISE EXCEPTION 'ACCOUNTING_PERIOD_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  IF period_status = 'HARD_CLOSED' THEN
    RAISE EXCEPTION 'ACCOUNTING_PERIOD_HARD_CLOSED'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.event_at < period_start OR NEW.event_at >= period_end THEN
    RAISE EXCEPTION 'ACCOUNTING_EVENT_OUTSIDE_PERIOD'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_accounting_events_reject_hard_closed
  BEFORE INSERT ON fin.accounting_events
  FOR EACH ROW EXECUTE FUNCTION fin.trg_accounting_events_reject_hard_closed();

ALTER TABLE fin.accounting_periods OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_accounting_periods_status_flip() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_accounting_events_reject_hard_closed() OWNER TO fin_migrator;

ALTER TABLE fin.accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.accounting_periods FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.accounting_periods
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_env_isolation ON fin.accounting_periods
  AS PERMISSIVE FOR ALL
  TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    OR fin.platform_admin_bypass()
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    OR fin.platform_admin_bypass()
  );

CREATE POLICY fin_recon_all_read ON fin.accounting_periods
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.accounting_periods TO fin_app_role;
GRANT UPDATE (
  status, closed_at, closed_by_actor_id, reconciliation_override_approval_id,
  ever_hard_closed, updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.accounting_periods TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.accounting_periods FROM fin_app_role;

GRANT SELECT ON fin.accounting_periods
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_accounting_periods_status_flip() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_accounting_events_reject_hard_closed() TO fin_app_role;
