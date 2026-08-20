-- Stage 8 — fin.dunning_cases (INTENT, B §6 / DL-030) + fin.dunning_steps (APPEND_ONLY).
-- controls_snapshot JSONB taken at OPEN (DL-036 / DL-107).

CREATE TABLE fin.dunning_cases (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  invoice_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'OPEN', 'REMINDING', 'REMIND_ESCALATED', 'CREDIT_PAUSED',
    'USAGE_SUSPENDED', 'LEGAL', 'WRITE_OFF_REVIEW',
    'CURED', 'WRITTEN_OFF', 'CANCELED'
  )),
  controls_snapshot JSONB NOT NULL,
  policy_delay_ms BIGINT NOT NULL DEFAULT 0 CHECK (policy_delay_ms >= 0),
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

COMMENT ON TABLE fin.dunning_cases IS
  'INTENT dunning machine (B §6 / DL-030). invoice_id has no FK until Stage 10 (DL-109).';
COMMENT ON COLUMN fin.dunning_cases.controls_snapshot IS
  'account_controls snapshot taken at OPEN before the first flag flip (DL-036/DL-107).';

CREATE UNIQUE INDEX uq_dunning_cases_open_invoice
  ON fin.dunning_cases (environment, invoice_id)
  WHERE status NOT IN ('CURED', 'WRITTEN_OFF', 'CANCELED');

CREATE INDEX idx_dunning_cases_status
  ON fin.dunning_cases (status, updated_at);

CREATE TRIGGER trg_dunning_cases_bump_version
  BEFORE UPDATE ON fin.dunning_cases
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_dunning_cases_env_tenant
  BEFORE INSERT OR UPDATE ON fin.dunning_cases
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE OR REPLACE FUNCTION fin.trg_dunning_cases_status_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal BOOLEAN := false;
  terminal TEXT[] := ARRAY['CURED', 'WRITTEN_OFF', 'CANCELED'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'dunning_cases insert status must be OPEN, got %', NEW.status
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.controls_snapshot IS DISTINCT FROM OLD.controls_snapshot
  THEN
    RAISE EXCEPTION 'dunning_cases identity/snapshot columns are immutable'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = ANY (terminal) THEN
    RAISE EXCEPTION 'dunning_cases illegal transition % → %', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IN ('CURED', 'CANCELED') THEN
    legal := true;
  ELSIF OLD.status = 'OPEN' AND NEW.status = 'REMINDING' THEN
    legal := true;
  ELSIF OLD.status = 'REMINDING' AND NEW.status = 'REMIND_ESCALATED' THEN
    legal := true;
  ELSIF OLD.status = 'REMIND_ESCALATED' AND NEW.status = 'CREDIT_PAUSED' THEN
    legal := true;
  ELSIF OLD.status = 'CREDIT_PAUSED' AND NEW.status = 'USAGE_SUSPENDED' THEN
    legal := true;
  ELSIF OLD.status = 'USAGE_SUSPENDED' AND NEW.status = 'LEGAL' THEN
    legal := true;
  ELSIF OLD.status = 'LEGAL' AND NEW.status = 'WRITE_OFF_REVIEW' THEN
    legal := true;
  ELSIF OLD.status = 'WRITE_OFF_REVIEW' AND NEW.status = 'WRITTEN_OFF' THEN
    legal := true;
  END IF;

  IF NOT legal THEN
    RAISE EXCEPTION 'dunning_cases illegal transition % → %', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dunning_cases_status_flip
  BEFORE INSERT OR UPDATE ON fin.dunning_cases
  FOR EACH ROW EXECUTE FUNCTION fin.trg_dunning_cases_status_flip();

CREATE TABLE fin.dunning_steps (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  case_id UUID NOT NULL REFERENCES fin.dunning_cases(id),
  step_kind TEXT NOT NULL CHECK (step_kind IN (
    'REMIND', 'REMIND_ESCALATED', 'PAUSE_NEW_CREDIT', 'SUSPEND_USAGE',
    'LEGAL_ESCALATION', 'WRITE_OFF_REVIEW', 'CURE', 'CANCEL', 'ERROR'
  )),
  entered_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  outcome TEXT,
  reason_code TEXT
);

COMMENT ON TABLE fin.dunning_steps IS
  'APPEND_ONLY dunning steps (A §8.5). REVOKE UPDATE, DELETE from fin_app_role.';

CREATE INDEX idx_dunning_steps_case
  ON fin.dunning_steps (case_id, entered_at);

CREATE TRIGGER trg_dunning_steps_env_tenant
  BEFORE INSERT OR UPDATE ON fin.dunning_steps
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

ALTER TABLE fin.dunning_cases OWNER TO fin_migrator;
ALTER TABLE fin.dunning_steps OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_dunning_cases_status_flip() OWNER TO fin_migrator;

ALTER TABLE fin.dunning_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.dunning_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.dunning_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.dunning_steps FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.dunning_cases
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.dunning_steps
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.dunning_cases
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

CREATE POLICY fin_tenant_isolation ON fin.dunning_steps
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

CREATE POLICY fin_recon_all_read ON fin.dunning_cases
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.dunning_steps
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.dunning_cases TO fin_app_role;
GRANT UPDATE (
  status, reason_code,
  updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.dunning_cases TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.dunning_cases FROM fin_app_role;

GRANT SELECT, INSERT ON fin.dunning_steps TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.dunning_steps FROM fin_app_role;

GRANT SELECT ON fin.dunning_cases
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
GRANT SELECT ON fin.dunning_steps
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_dunning_cases_status_flip() TO fin_app_role;
