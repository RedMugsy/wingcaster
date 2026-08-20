-- Stage 10 — fin.invoice_sequences (A §10.2 / D §6.3 / DL-132).
-- MUTABLE header. NO version column, NO OCC. Concurrency is
-- FOR UPDATE + UPDATE next_n = next_n + 1 RETURNING next_n - 1.
-- UNIQUE (environment, legal_entity_id, jurisdiction, doc_type, fiscal_context).
-- Do not collapse a missing tuple part — each combination is its own sequence.
-- Seeds live in test support, not here.

CREATE TABLE fin.invoice_sequences (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  legal_entity_id UUID NOT NULL REFERENCES fin.platform_legal_entities(id),
  jurisdiction TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE')),
  fiscal_context TEXT NOT NULL,
  prefix TEXT NOT NULL,
  next_n BIGINT NOT NULL DEFAULT 1 CHECK (next_n > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE fin.invoice_sequences IS
  'MUTABLE sequence header (A §10.2). NO version / NO OCC — D §6.3 exception (DL-132). FOR UPDATE + UPDATE next_n = next_n + 1 RETURNING is the only concurrency control. VOID keeps the assigned invoice_number; numbers are never reused.';
COMMENT ON COLUMN fin.invoice_sequences.next_n IS
  'Next number to assign. Increment under FOR UPDATE: UPDATE next_n = next_n + 1 RETURNING next_n - 1 AS assigned.';
COMMENT ON COLUMN fin.invoice_sequences.fiscal_context IS
  'Fiscal year, ZATCA phase, or any other fiscal slice. Missing any part of (legal_entity, jurisdiction, doc_type, fiscal_context) yields a separate sequence — do not collapse.';

CREATE UNIQUE INDEX uq_invoice_sequences_tuple
  ON fin.invoice_sequences (
    environment, legal_entity_id, jurisdiction, doc_type, fiscal_context
  );
CREATE INDEX idx_invoice_sequences_entity
  ON fin.invoice_sequences (legal_entity_id, doc_type, fiscal_context);

ALTER TABLE fin.invoices
  ADD CONSTRAINT fk_invoices_sequence
  FOREIGN KEY (invoice_sequence_id) REFERENCES fin.invoice_sequences(id);

ALTER TABLE fin.invoice_sequences OWNER TO fin_migrator;

ALTER TABLE fin.invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.invoice_sequences FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.invoice_sequences
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_env_isolation ON fin.invoice_sequences
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

CREATE POLICY fin_recon_all_read ON fin.invoice_sequences
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.invoice_sequences TO fin_app_role;
GRANT UPDATE (next_n, updated_at) ON fin.invoice_sequences TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.invoice_sequences FROM fin_app_role;

GRANT SELECT ON fin.invoice_sequences
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
