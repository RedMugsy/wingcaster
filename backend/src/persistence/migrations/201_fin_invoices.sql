-- Stage 10 — fin.invoices + children (A §10.3–10.7 / B §16).
-- INTENT then APPEND_ONLY after ISSUE. invoice_number NULL until ISSUE;
-- remains set for the row's lifetime INCLUDING after VOID (spec §124 / DL-132).
-- invoice_sequence_id FK is added in 202 (table created there).
-- invoice_payment_allocations.amount_minor is SIGN-FLEXIBLE (DL-133) — no CHECK.

CREATE TABLE fin.invoices (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  legal_entity_id UUID NOT NULL REFERENCES fin.platform_legal_entities(id),
  billing_period_id UUID REFERENCES fin.billing_periods(id),
  status TEXT NOT NULL CHECK (status IN (
    'DRAFT', 'APPROVED', 'ISSUED', 'PART_PAID', 'PAID', 'VOID', 'UNCOLLECTIBLE'
  )),
  issued_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  invoice_number TEXT,
  invoice_sequence_id UUID,
  currency CHAR(3) NOT NULL,
  subtotal_minor BIGINT NOT NULL DEFAULT 0,
  tax_minor BIGINT NOT NULL DEFAULT 0,
  total_minor BIGINT NOT NULL DEFAULT 0,
  xml_uuid TEXT UNIQUE,
  qr_payload TEXT,
  prev_invoice_hash TEXT,
  zatca_submitted_at TIMESTAMPTZ,
  pdf_a3_hash TEXT,
  pdf_storage_url TEXT,
  rendered_at TIMESTAMPTZ,
  buyer_legal_name TEXT,
  buyer_email TEXT,
  buyer_address_line1 TEXT,
  buyer_address_line2 TEXT,
  buyer_city TEXT,
  buyer_region TEXT,
  buyer_postal_code TEXT,
  buyer_country TEXT,
  buyer_tax_id TEXT,
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

COMMENT ON TABLE fin.invoices IS
  'INTENT then APPEND_ONLY after ISSUE (A §10.3 / B §16). invoice_number is assigned at ISSUE and KEPT on VOID (spec §124).';
COMMENT ON COLUMN fin.invoices.invoice_number IS
  'NULL until ISSUE. Once set, immutable for the row lifetime including VOID. Sequence numbers are never reused (DL-132).';

CREATE UNIQUE INDEX uq_invoices_legal_entity_number
  ON fin.invoices (legal_entity_id, invoice_number)
  WHERE invoice_number IS NOT NULL;
CREATE INDEX idx_invoices_account_status
  ON fin.invoices (billing_account_id, status, issued_at DESC);
CREATE INDEX idx_invoices_period
  ON fin.invoices (billing_period_id, status);

CREATE TRIGGER trg_invoices_bump_version
  BEFORE UPDATE ON fin.invoices
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_invoices_env_tenant
  BEFORE INSERT OR UPDATE ON fin.invoices
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE OR REPLACE FUNCTION fin.trg_invoices_status_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal BOOLEAN := false;
  issued_like TEXT[] := ARRAY['ISSUED', 'PART_PAID', 'PAID', 'VOID', 'UNCOLLECTIBLE'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'INVOICE_NOT_DRAFT'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = ANY (issued_like) THEN
    IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
       OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
       OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor
       OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
       OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
       OR NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id
       OR NEW.invoice_sequence_id IS DISTINCT FROM OLD.invoice_sequence_id
       OR NEW.currency IS DISTINCT FROM OLD.currency
    THEN
      RAISE EXCEPTION 'INVOICE_MUTATE_AFTER_ISSUE'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
  THEN
    RAISE EXCEPTION 'invoices identity columns are immutable'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status IN ('APPROVED', 'VOID') THEN
    legal := true;
  ELSIF OLD.status = 'APPROVED' AND NEW.status IN ('DRAFT', 'ISSUED') THEN
    legal := true;
  ELSIF OLD.status = 'ISSUED' AND NEW.status IN ('PART_PAID', 'PAID', 'VOID', 'UNCOLLECTIBLE') THEN
    legal := true;
  ELSIF OLD.status = 'PART_PAID' AND NEW.status IN ('PAID', 'VOID', 'UNCOLLECTIBLE', 'ISSUED') THEN
    legal := true;
  ELSIF OLD.status = 'PAID' AND NEW.status = 'PART_PAID' THEN
    legal := true;
  ELSIF OLD.status = 'UNCOLLECTIBLE' AND NEW.status IN ('PAID', 'PART_PAID') THEN
    legal := true;
  END IF;

  IF NOT legal THEN
    RAISE EXCEPTION 'invoices illegal transition % → %', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoices_status_flip
  BEFORE INSERT OR UPDATE ON fin.invoices
  FOR EACH ROW EXECUTE FUNCTION fin.trg_invoices_status_flip();

CREATE TABLE fin.invoice_lines (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  invoice_id UUID NOT NULL REFERENCES fin.invoices(id),
  line_no INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  description TEXT NOT NULL,
  quantity_units BIGINT NOT NULL,
  unit_rate_minor BIGINT NOT NULL DEFAULT 0,
  amount_minor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (invoice_id, line_no)
);

COMMENT ON TABLE fin.invoice_lines IS
  'Writable in DRAFT/APPROVED; APPEND_ONLY after parent ISSUE (A §10.4). No sourceless lines (spec §129).';

CREATE TABLE fin.invoice_tax_lines (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  invoice_id UUID NOT NULL REFERENCES fin.invoices(id),
  tax_snapshot_id UUID NOT NULL REFERENCES fin.tax_snapshots(id),
  tax_minor BIGINT NOT NULL,
  vat_bps INTEGER NOT NULL,
  tax_treatment TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE fin.invoice_adjustments (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  invoice_id UUID NOT NULL REFERENCES fin.invoices(id),
  credit_note_id UUID,
  debit_note_id UUID,
  amount_minor BIGINT NOT NULL,
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID
);

COMMENT ON COLUMN fin.invoice_adjustments.amount_minor IS
  'Signed. Credits negative, debits positive. No sign CHECK (DL-133 companion).';

CREATE TABLE fin.invoice_payment_allocations (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  invoice_id UUID NOT NULL REFERENCES fin.invoices(id),
  payment_id UUID NOT NULL,
  amount_minor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID
);

COMMENT ON COLUMN fin.invoice_payment_allocations.amount_minor IS
  'SIGN-FLEXIBLE (DL-133). Negative rows are compensating entries for ReversePayment. Do NOT add CHECK amount_minor > 0.';

CREATE INDEX idx_invoice_lines_invoice ON fin.invoice_lines (invoice_id, line_no);
CREATE INDEX idx_invoice_tax_lines_invoice ON fin.invoice_tax_lines (invoice_id);
CREATE INDEX idx_invoice_adjustments_invoice ON fin.invoice_adjustments (invoice_id);
CREATE INDEX idx_invoice_payment_allocations_invoice ON fin.invoice_payment_allocations (invoice_id);
CREATE INDEX idx_invoice_payment_allocations_payment ON fin.invoice_payment_allocations (payment_id);

CREATE TRIGGER trg_invoice_lines_env_tenant
  BEFORE INSERT OR UPDATE ON fin.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();
CREATE TRIGGER trg_invoice_tax_lines_env_tenant
  BEFORE INSERT OR UPDATE ON fin.invoice_tax_lines
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();
CREATE TRIGGER trg_invoice_adjustments_env_tenant
  BEFORE INSERT OR UPDATE ON fin.invoice_adjustments
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();
CREATE TRIGGER trg_invoice_payment_allocations_env_tenant
  BEFORE INSERT OR UPDATE ON fin.invoice_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

-- Lines/tax: UPDATE/DELETE forbidden once parent is ISSUED or later.
-- INSERT of lines/tax also forbidden after ISSUE (freeze). Adjustments and
-- payment allocations stay INSERT-only for the whole life (APPEND_ONLY).
CREATE OR REPLACE FUNCTION fin.trg_invoice_lines_freeze_after_issue()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
  invoice_id UUID;
BEGIN
  invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT status INTO parent_status FROM fin.invoices WHERE id = invoice_id;
  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF parent_status IN ('ISSUED', 'PART_PAID', 'PAID', 'VOID', 'UNCOLLECTIBLE') THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      RAISE EXCEPTION 'INVOICE_MUTATE_AFTER_ISSUE' USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'INVOICE_MUTATE_AFTER_ISSUE' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_invoice_lines_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON fin.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION fin.trg_invoice_lines_freeze_after_issue();
CREATE TRIGGER trg_invoice_tax_lines_freeze
  BEFORE INSERT OR UPDATE OR DELETE ON fin.invoice_tax_lines
  FOR EACH ROW EXECUTE FUNCTION fin.trg_invoice_lines_freeze_after_issue();

CREATE OR REPLACE FUNCTION fin.trg_invoice_children_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'INVOICE_MUTATE_AFTER_ISSUE' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER trg_invoice_adjustments_no_update
  BEFORE UPDATE OR DELETE ON fin.invoice_adjustments
  FOR EACH ROW EXECUTE FUNCTION fin.trg_invoice_children_append_only();
CREATE TRIGGER trg_invoice_payment_allocations_no_update
  BEFORE UPDATE OR DELETE ON fin.invoice_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION fin.trg_invoice_children_append_only();

ALTER TABLE fin.invoices OWNER TO fin_migrator;
ALTER TABLE fin.invoice_lines OWNER TO fin_migrator;
ALTER TABLE fin.invoice_tax_lines OWNER TO fin_migrator;
ALTER TABLE fin.invoice_adjustments OWNER TO fin_migrator;
ALTER TABLE fin.invoice_payment_allocations OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_invoices_status_flip() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_invoice_lines_freeze_after_issue() OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_invoice_children_append_only() OWNER TO fin_migrator;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invoices', 'invoice_lines', 'invoice_tax_lines',
    'invoice_adjustments', 'invoice_payment_allocations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE fin.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE fin.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY fin_migrator_all ON fin.%I FOR ALL TO fin_migrator USING (true) WITH CHECK (true)',
      t
    );
    EXECUTE format(
      $p$CREATE POLICY fin_tenant_isolation ON fin.%I
        AS PERMISSIVE FOR ALL
        TO fin_app_role, fin_finance_role, fin_auditor_role
        USING (
          environment = current_setting('fin.environment', true)
          AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
        )
        WITH CHECK (
          environment = current_setting('fin.environment', true)
          AND (tenant_id::text = current_setting('fin.tenant_id', true) OR fin.platform_admin_bypass())
        )$p$,
      t
    );
    EXECUTE format(
      'CREATE POLICY fin_recon_all_read ON fin.%I FOR SELECT TO fin_recon_role USING (environment = current_setting(''fin.environment'', true))',
      t
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT ON fin.invoices TO fin_app_role;
GRANT UPDATE (
  status, issued_at, due_at, invoice_number, invoice_sequence_id,
  subtotal_minor, tax_minor, total_minor,
  xml_uuid, qr_payload, prev_invoice_hash, zatca_submitted_at,
  pdf_a3_hash, pdf_storage_url, rendered_at,
  buyer_legal_name, buyer_email, buyer_address_line1, buyer_address_line2,
  buyer_city, buyer_region, buyer_postal_code, buyer_country, buyer_tax_id,
  reason_code, updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.invoices TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.invoices FROM fin_app_role;

GRANT SELECT, INSERT, UPDATE ON fin.invoice_lines TO fin_app_role;
GRANT SELECT, INSERT, UPDATE ON fin.invoice_tax_lines TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.invoice_lines FROM fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.invoice_tax_lines FROM fin_app_role;

GRANT SELECT, INSERT ON fin.invoice_adjustments TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.invoice_adjustments FROM fin_app_role;
GRANT SELECT, INSERT ON fin.invoice_payment_allocations TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.invoice_payment_allocations FROM fin_app_role;

GRANT SELECT ON fin.invoices, fin.invoice_lines, fin.invoice_tax_lines,
  fin.invoice_adjustments, fin.invoice_payment_allocations
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_invoices_status_flip() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_invoice_lines_freeze_after_issue() TO fin_app_role;
GRANT EXECUTE ON FUNCTION fin.trg_invoice_children_append_only() TO fin_app_role;
