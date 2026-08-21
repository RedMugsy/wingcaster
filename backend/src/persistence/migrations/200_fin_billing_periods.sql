-- Stage 10 — fin.billing_periods (A §10.1 / B §11). INTENT.
-- Per billing-account invoicing window. NOT accounting_periods (Stage 9).
-- UNIQUE (environment, billing_account_id, period_key).
-- Advisory class FIN_BILLING_PERIOD_CLOSE = 1020 (DL-131). Do not reuse 1016.

CREATE TABLE fin.billing_periods (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  period_key TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'OPEN', 'USAGE_CLOSING', 'USAGE_CLOSED', 'RATING_CLOSED',
    'INVOICE_DRAFTED', 'INVOICED', 'FINAL'
  )),
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT chk_billing_period_window CHECK (ends_at > starts_at)
);

COMMENT ON TABLE fin.billing_periods IS
  'INTENT per-account invoicing window (A §10.1 / B §11). Distinct from fin.accounting_periods (SOX close). 12-step close (spec §77) is a worker checklist inside these seven statuses.';

CREATE UNIQUE INDEX uq_billing_periods_account_key
  ON fin.billing_periods (environment, billing_account_id, period_key);
CREATE INDEX idx_billing_periods_tenant_status
  ON fin.billing_periods (tenant_id, status, period_key);

CREATE TRIGGER trg_billing_periods_bump_version
  BEFORE UPDATE ON fin.billing_periods
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_billing_periods_env_tenant
  BEFORE INSERT OR UPDATE ON fin.billing_periods
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE OR REPLACE FUNCTION fin.trg_billing_periods_status_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'BILLING_PERIOD_SKIP'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.period_key IS DISTINCT FROM OLD.period_key
     OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
     OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
  THEN
    RAISE EXCEPTION 'billing_periods identity columns are immutable'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'FINAL' THEN
    RAISE EXCEPTION 'BILLING_PERIOD_FINAL'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'OPEN' AND NEW.status = 'USAGE_CLOSING' THEN
    legal := true;
  ELSIF OLD.status = 'USAGE_CLOSING' AND NEW.status = 'USAGE_CLOSED' THEN
    legal := true;
  ELSIF OLD.status = 'USAGE_CLOSING' AND NEW.status = 'OPEN' THEN
    legal := true;
  ELSIF OLD.status = 'USAGE_CLOSED' AND NEW.status = 'RATING_CLOSED' THEN
    legal := true;
  ELSIF OLD.status = 'RATING_CLOSED' AND NEW.status = 'INVOICE_DRAFTED' THEN
    legal := true;
  ELSIF OLD.status = 'INVOICE_DRAFTED' AND NEW.status = 'INVOICED' THEN
    legal := true;
  ELSIF OLD.status = 'INVOICE_DRAFTED' AND NEW.status = 'RATING_CLOSED' THEN
    legal := true;
  ELSIF OLD.status = 'INVOICED' AND NEW.status = 'FINAL' THEN
    legal := true;
  ELSIF OLD.status IN ('INVOICED', 'FINAL') AND NEW.status IN ('OPEN', 'USAGE_CLOSING', 'USAGE_CLOSED', 'RATING_CLOSED', 'INVOICE_DRAFTED') THEN
    RAISE EXCEPTION 'BILLING_PERIOD_REOPEN_AFTER_ISSUE'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT legal THEN
    RAISE EXCEPTION 'BILLING_PERIOD_SKIP'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_billing_periods_status_flip
  BEFORE INSERT OR UPDATE ON fin.billing_periods
  FOR EACH ROW EXECUTE FUNCTION fin.trg_billing_periods_status_flip();

-- Stage 5 reserved billing_period_id without FK (DL-080). Stage 10 lands it.
ALTER TABLE fin.rated_usage
  ADD CONSTRAINT fk_rated_usage_billing_period
  FOREIGN KEY (billing_period_id) REFERENCES fin.billing_periods(id);

ALTER TABLE fin.billing_periods OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_billing_periods_status_flip() OWNER TO fin_migrator;

ALTER TABLE fin.billing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.billing_periods FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.billing_periods
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.billing_periods
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

CREATE POLICY fin_recon_all_read ON fin.billing_periods
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.billing_periods TO fin_app_role;
GRANT UPDATE (
  status, reason_code,
  updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.billing_periods TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.billing_periods FROM fin_app_role;

GRANT SELECT ON fin.billing_periods
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_billing_periods_status_flip() TO fin_app_role;
