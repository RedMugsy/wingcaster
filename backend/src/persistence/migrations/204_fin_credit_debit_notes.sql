-- Stage 10 — fin.credit_notes + fin.debit_notes (A §10.8 / B §17 / DL-031).
-- INTENT then APPEND_ONLY after ISSUE. note_number set at ISSUE, kept on VOID.
-- Must reference an ISSUED (or later non-VOID) invoice — enforced in the command.

CREATE TABLE fin.credit_notes (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  invoice_id UUID NOT NULL REFERENCES fin.invoices(id),
  legal_entity_id UUID NOT NULL REFERENCES fin.platform_legal_entities(id),
  note_number TEXT,
  invoice_sequence_id UUID REFERENCES fin.invoice_sequences(id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'APPROVED', 'ISSUED', 'VOID')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  reason_code TEXT,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE fin.debit_notes (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  invoice_id UUID NOT NULL REFERENCES fin.invoices(id),
  legal_entity_id UUID NOT NULL REFERENCES fin.platform_legal_entities(id),
  note_number TEXT,
  invoice_sequence_id UUID REFERENCES fin.invoice_sequences(id),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'APPROVED', 'ISSUED', 'VOID')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  reason_code TEXT,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

COMMENT ON TABLE fin.credit_notes IS
  'INTENT then APPEND_ONLY after ISSUE (B §17 / DL-031). note_number kept on VOID (spec §124).';
COMMENT ON TABLE fin.debit_notes IS
  'INTENT then APPEND_ONLY after ISSUE (B §17 / DL-031). note_number kept on VOID (spec §124).';
COMMENT ON COLUMN fin.credit_notes.note_number IS
  'NULL until ISSUE. Kept on VOID. CREDIT_NOTE sequence, never reused.';
COMMENT ON COLUMN fin.debit_notes.note_number IS
  'NULL until ISSUE. Kept on VOID. DEBIT_NOTE sequence, never reused.';

CREATE UNIQUE INDEX uq_credit_notes_legal_entity_number
  ON fin.credit_notes (legal_entity_id, note_number)
  WHERE note_number IS NOT NULL;
CREATE UNIQUE INDEX uq_debit_notes_legal_entity_number
  ON fin.debit_notes (legal_entity_id, note_number)
  WHERE note_number IS NOT NULL;
CREATE INDEX idx_credit_notes_invoice ON fin.credit_notes (invoice_id, status);
CREATE INDEX idx_debit_notes_invoice ON fin.debit_notes (invoice_id, status);

CREATE TRIGGER trg_credit_notes_bump_version
  BEFORE UPDATE ON fin.credit_notes
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();
CREATE TRIGGER trg_debit_notes_bump_version
  BEFORE UPDATE ON fin.debit_notes
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();
CREATE TRIGGER trg_credit_notes_env_tenant
  BEFORE INSERT OR UPDATE ON fin.credit_notes
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();
CREATE TRIGGER trg_debit_notes_env_tenant
  BEFORE INSERT OR UPDATE ON fin.debit_notes
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE OR REPLACE FUNCTION fin.trg_notes_status_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'NOTE_PARENT_NOT_ISSUED'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('ISSUED', 'VOID') THEN
    IF NEW.note_number IS DISTINCT FROM OLD.note_number
       OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
       OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
       OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
       OR NEW.invoice_sequence_id IS DISTINCT FROM OLD.invoice_sequence_id
    THEN
      RAISE EXCEPTION 'INVOICE_MUTATE_AFTER_ISSUE'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status IN ('APPROVED', 'VOID') THEN
    legal := true;
  ELSIF OLD.status = 'APPROVED' AND NEW.status IN ('DRAFT', 'ISSUED', 'VOID') THEN
    legal := true;
  ELSIF OLD.status = 'ISSUED' AND NEW.status = 'VOID' THEN
    legal := true;
  END IF;

  IF NOT legal THEN
    RAISE EXCEPTION 'notes illegal transition % → %', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_credit_notes_status_flip
  BEFORE INSERT OR UPDATE ON fin.credit_notes
  FOR EACH ROW EXECUTE FUNCTION fin.trg_notes_status_flip();
CREATE TRIGGER trg_debit_notes_status_flip
  BEFORE INSERT OR UPDATE ON fin.debit_notes
  FOR EACH ROW EXECUTE FUNCTION fin.trg_notes_status_flip();

ALTER TABLE fin.invoice_adjustments
  ADD CONSTRAINT fk_invoice_adjustments_credit_note
  FOREIGN KEY (credit_note_id) REFERENCES fin.credit_notes(id);
ALTER TABLE fin.invoice_adjustments
  ADD CONSTRAINT fk_invoice_adjustments_debit_note
  FOREIGN KEY (debit_note_id) REFERENCES fin.debit_notes(id);

ALTER TABLE fin.credit_notes OWNER TO fin_migrator;
ALTER TABLE fin.debit_notes OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_notes_status_flip() OWNER TO fin_migrator;

ALTER TABLE fin.credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.credit_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.debit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.debit_notes FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.credit_notes
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.debit_notes
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.credit_notes
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
CREATE POLICY fin_tenant_isolation ON fin.debit_notes
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

CREATE POLICY fin_recon_all_read ON fin.credit_notes
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.debit_notes
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.credit_notes TO fin_app_role;
GRANT UPDATE (
  status, note_number, invoice_sequence_id, issued_at, reason_code,
  updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.credit_notes TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.credit_notes FROM fin_app_role;

GRANT SELECT, INSERT ON fin.debit_notes TO fin_app_role;
GRANT UPDATE (
  status, note_number, invoice_sequence_id, issued_at, reason_code,
  updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.debit_notes TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.debit_notes FROM fin_app_role;

GRANT SELECT ON fin.credit_notes, fin.debit_notes
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_notes_status_flip() TO fin_app_role;
