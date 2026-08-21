-- Stage 11 — vendor statements + lines + variance reasons + variances
-- (A §11.6 restated). Machine: DRAFT → RECEIVED → RECONCILED → FINALIZED
-- (DL-158 restates B §21 OPEN/FINALIZED). Lines freeze after FINALIZE
-- (Stage 10 invoice_lines freeze mirror).

CREATE TABLE fin.vendor_variance_reasons (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

COMMENT ON TABLE fin.vendor_variance_reasons IS
  '10-code variance classification (DL-152). Data classifications, not B §23 exceptions.';

INSERT INTO fin.vendor_variance_reasons (code, description) VALUES
  ('drift', 'Internal vs provider quantity drift'),
  ('rate_change', 'Unit cost differs between estimate and actual'),
  ('late_usage', 'Usage arrived after the reporting window'),
  ('duplicate', 'Duplicate provider event or double-counted units'),
  ('missing_source', 'One side of the comparison is empty'),
  ('timezone', 'Period-boundary skew from timezone conversion'),
  ('rounding', 'Single-minor-unit remainder'),
  ('currency_mismatch', 'Currencies differ across the compared sides'),
  ('classification_drift', 'Product/SKU classification differs'),
  ('unknown', 'Unclassified residual');

CREATE TABLE fin.vendor_statements (
  id UUID PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES fin.vendors(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  statement_period_key TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  subtotal_minor BIGINT NOT NULL DEFAULT 0,
  tax_minor BIGINT NOT NULL DEFAULT 0,
  total_minor BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT', 'RECEIVED', 'RECONCILED', 'FINALIZED'
  )),
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, vendor_id, statement_period_key)
);

COMMENT ON TABLE fin.vendor_statements IS
  'INTENT then APPEND_ONLY after FINALIZE (A §11.6 / DL-035 uniqueness). Corrections are a new statement, not a reopen.';

CREATE TRIGGER trg_vendor_statements_bump_version
  BEFORE UPDATE ON fin.vendor_statements
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_vendor_statements_env_vendor
  BEFORE INSERT OR UPDATE ON fin.vendor_statements
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_vendor();

CREATE OR REPLACE FUNCTION fin.trg_vendor_statements_status_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'VENDOR_STATEMENT_NOT_DRAFT'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'FINALIZED' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
       OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
       OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
       OR NEW.statement_period_key IS DISTINCT FROM OLD.statement_period_key
    THEN
      RAISE EXCEPTION 'VENDOR_STATEMENT_ALREADY_FINAL'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.statement_period_key IS DISTINCT FROM OLD.statement_period_key
  THEN
    RAISE EXCEPTION 'vendor_statements identity columns are immutable'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status = 'RECEIVED' THEN
    legal := true;
  ELSIF OLD.status = 'RECEIVED' AND NEW.status = 'RECONCILED' THEN
    legal := true;
  ELSIF OLD.status = 'RECONCILED' AND NEW.status = 'FINALIZED' THEN
    legal := true;
  END IF;

  IF NOT legal THEN
    RAISE EXCEPTION 'vendor_statements illegal transition % → %',
      OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_statements_status_flip
  BEFORE INSERT OR UPDATE ON fin.vendor_statements
  FOR EACH ROW EXECUTE FUNCTION fin.trg_vendor_statements_status_flip();

CREATE TABLE fin.vendor_statement_lines (
  id UUID PRIMARY KEY,
  statement_id UUID NOT NULL REFERENCES fin.vendor_statements(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  product_code TEXT NOT NULL,
  quantity_units BIGINT NOT NULL,
  unit_cost_minor BIGINT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE fin.vendor_statement_lines IS
  'Writable pre-FINALIZE; APPEND_ONLY after parent FINALIZE (Stage 10 invoice_lines freeze mirror).';

CREATE INDEX idx_vendor_statement_lines_statement
  ON fin.vendor_statement_lines (statement_id);

CREATE OR REPLACE FUNCTION fin.trg_env_matches_vendor_statement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  stmt_env TEXT;
BEGIN
  SELECT environment INTO stmt_env FROM fin.vendor_statements WHERE id = NEW.statement_id;
  IF stmt_env IS NULL THEN
    RAISE EXCEPTION 'vendor_statement % not found', NEW.statement_id
      USING ERRCODE = '23503';
  END IF;
  IF NEW.environment IS DISTINCT FROM stmt_env THEN
    RAISE EXCEPTION 'environment % does not match vendor_statement % (%)',
      NEW.environment, NEW.statement_id, stmt_env
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_statement_lines_env_statement
  BEFORE INSERT OR UPDATE ON fin.vendor_statement_lines
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_vendor_statement();

CREATE OR REPLACE FUNCTION fin.trg_vendor_statement_lines_freeze_after_finalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
  statement_id UUID;
BEGIN
  statement_id := COALESCE(NEW.statement_id, OLD.statement_id);
  SELECT status INTO parent_status FROM fin.vendor_statements WHERE id = statement_id;
  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'VENDOR_STATEMENT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF parent_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'VENDOR_STATEMENT_MUTATE_AFTER_FINALIZE' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_vendor_statement_lines_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON fin.vendor_statement_lines
  FOR EACH ROW EXECUTE FUNCTION fin.trg_vendor_statement_lines_freeze_after_finalize();

CREATE TABLE fin.vendor_variances (
  id UUID PRIMARY KEY,
  statement_id UUID NOT NULL REFERENCES fin.vendor_statements(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  axis TEXT NOT NULL CHECK (axis IN ('A', 'B', 'C', 'D', 'E', 'F')),
  reason_code TEXT NOT NULL REFERENCES fin.vendor_variance_reasons(code),
  left_qty BIGINT NOT NULL,
  right_qty BIGINT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (statement_id, axis)
);

COMMENT ON TABLE fin.vendor_variances IS
  '6-way spec §125 variance rows. FINALIZE rejected while unresolved rows exist unless override approval is attached.';

CREATE TRIGGER trg_vendor_variances_env_statement
  BEFORE INSERT OR UPDATE ON fin.vendor_variances
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_vendor_statement();

CREATE OR REPLACE FUNCTION fin.trg_vendor_variances_freeze_after_finalize()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
  statement_id UUID;
BEGIN
  statement_id := COALESCE(NEW.statement_id, OLD.statement_id);
  SELECT status INTO parent_status FROM fin.vendor_statements WHERE id = statement_id;
  IF parent_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'VENDOR_STATEMENT_MUTATE_AFTER_FINALIZE' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_vendor_variances_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON fin.vendor_variances
  FOR EACH ROW EXECUTE FUNCTION fin.trg_vendor_variances_freeze_after_finalize();

ALTER TABLE fin.vendor_actual_costs
  ADD CONSTRAINT vendor_actual_costs_vendor_statement_line_id_fkey
  FOREIGN KEY (vendor_statement_line_id) REFERENCES fin.vendor_statement_lines(id);

ALTER TABLE fin.vendor_variance_reasons OWNER TO fin_migrator;
ALTER TABLE fin.vendor_statements OWNER TO fin_migrator;
ALTER TABLE fin.vendor_statement_lines OWNER TO fin_migrator;
ALTER TABLE fin.vendor_variances OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_vendor_statements_status_flip() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_env_matches_vendor_statement() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_vendor_statement_lines_freeze_after_finalize() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_vendor_variances_freeze_after_finalize() OWNER TO fin_migrator;

ALTER TABLE fin.vendor_variance_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_variance_reasons FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_statements FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_statement_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_variances ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.vendor_variances FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.vendor_variance_reasons
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_catalog_app ON fin.vendor_variance_reasons
  FOR SELECT TO fin_app_role, fin_finance_role, fin_auditor_role, fin_recon_role
  USING (true);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vendor_statements', 'vendor_statement_lines', 'vendor_variances'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY fin_migrator_all ON fin.%I FOR ALL TO fin_migrator USING (true) WITH CHECK (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY fin_catalog_app ON fin.%I FOR ALL TO fin_app_role, fin_finance_role, fin_auditor_role USING (true) WITH CHECK (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY fin_recon_all_read ON fin.%I FOR SELECT TO fin_recon_role USING (environment = current_setting(''fin.environment'', true))',
      t
    );
  END LOOP;
END
$$;

GRANT SELECT ON fin.vendor_variance_reasons TO fin_app_role, fin_recon_role,
  fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT SELECT, INSERT ON fin.vendor_statements TO fin_app_role;
GRANT UPDATE (
  status, subtotal_minor, tax_minor, total_minor,
  updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.vendor_statements TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.vendor_statements FROM fin_app_role;

GRANT SELECT, INSERT, UPDATE ON fin.vendor_statement_lines TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.vendor_statement_lines FROM fin_app_role;

GRANT SELECT, INSERT, UPDATE ON fin.vendor_variances TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.vendor_variances FROM fin_app_role;

GRANT SELECT ON fin.vendor_statements, fin.vendor_statement_lines, fin.vendor_variances
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_vendor_statements_status_flip() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_env_matches_vendor_statement() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_vendor_statement_lines_freeze_after_finalize() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_vendor_variances_freeze_after_finalize() TO fin_app_role;
