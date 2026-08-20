-- Stage 9 — fin.accounting_policy_versions (DL-119).
-- A §9.1 stamped policy_version TEXT; Stage 9 promotes that pin to a row.
-- Header is MUTABLE (effective_to may close). policy_definition is immutable
-- once effective_from <= now(). No amendment machine.

CREATE TABLE fin.accounting_policy_versions (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  name TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  policy_definition JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT chk_accounting_policy_window CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

COMMENT ON TABLE fin.accounting_policy_versions IS
  'Versioned accounting policy. v1 seed is a minimal ON_CONSUMPTION launch pin (DL-119). Real jurisdictional policy is ops.';

CREATE UNIQUE INDEX uq_accounting_policy_versions_name
  ON fin.accounting_policy_versions (environment, name);

CREATE TRIGGER trg_accounting_policy_versions_bump_version
  BEFORE UPDATE ON fin.accounting_policy_versions
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE OR REPLACE FUNCTION fin.trg_accounting_policy_definition_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.policy_definition IS DISTINCT FROM OLD.policy_definition
     AND OLD.effective_from <= clock_timestamp()
  THEN
    RAISE EXCEPTION 'accounting_policy_versions.policy_definition is immutable once effective'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_accounting_policy_definition_immutable
  BEFORE UPDATE ON fin.accounting_policy_versions
  FOR EACH ROW EXECUTE FUNCTION fin.trg_accounting_policy_definition_immutable();

ALTER TABLE fin.accounting_events
  ADD CONSTRAINT fk_accounting_events_policy
  FOREIGN KEY (accounting_policy_version_id)
  REFERENCES fin.accounting_policy_versions(id);

ALTER TABLE fin.accounting_policy_versions OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_accounting_policy_definition_immutable() OWNER TO fin_migrator;

ALTER TABLE fin.accounting_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.accounting_policy_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.accounting_policy_versions
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_env_isolation ON fin.accounting_policy_versions
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

CREATE POLICY fin_recon_all_read ON fin.accounting_policy_versions
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.accounting_policy_versions TO fin_app_role;
GRANT UPDATE (
  effective_to, updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.accounting_policy_versions TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.accounting_policy_versions FROM fin_app_role;

GRANT SELECT ON fin.accounting_policy_versions
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_accounting_policy_definition_immutable() TO fin_app_role;

-- DL-119 — launch pin. Accounting rules are jurisdiction-specific; Stage 9
-- lands the ENGINE and this minimal default. Ops replaces via a new row.
INSERT INTO fin.accounting_policy_versions (
  id, environment, name, effective_from, effective_to, policy_definition,
  created_at, updated_at
) VALUES (
  'a0000000-0000-4000-8000-000000000009',
  'LIVE',
  '2026-08-18.launch',
  '2026-01-01T00:00:00Z',
  NULL,
  '{
    "recognition": "ON_CONSUMPTION",
    "breakage": "ON_EXPIRY",
    "accounts": {
      "DEFERRED_REVENUE_CREATED": "DEFERRED_REVENUE",
      "REVENUE_RECOGNIZED": "REVENUE",
      "RECEIVABLE_CREATED": "ACCOUNTS_RECEIVABLE",
      "BREAKAGE_RECOGNIZED": "BREAKAGE",
      "BAD_DEBT_WRITE_OFF": "CREDIT_LOSS",
      "REFUND_REVENUE_REVERSED": "REVENUE",
      "TRANSFER_INTERNAL": "CLEARING",
      "ADJUSTMENT_REVENUE": "REVENUE",
      "FX_REMEASUREMENT": "FX",
      "TAX_ACCRUED": "TAX",
      "CONSIDERATION_ALLOCATED": "DEFERRED_REVENUE"
    }
  }'::jsonb,
  '2026-08-18T12:00:00Z',
  '2026-08-18T12:00:00Z'
);

INSERT INTO fin.accounting_policy_versions (
  id, environment, name, effective_from, effective_to, policy_definition,
  created_at, updated_at
)
SELECT
  'a0000000-0000-4000-8000-00000000000a',
  'TEST',
  name, effective_from, effective_to, policy_definition,
  created_at, updated_at
  FROM fin.accounting_policy_versions
 WHERE id = 'a0000000-0000-4000-8000-000000000009';
