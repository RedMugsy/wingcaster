-- Stage 9 — fin.accounting_events (A §9.1 / DL-118). APPEND_ONLY.
-- FKs to accounting_policy_versions / accounting_periods land in 192 / 193
-- (those tables do not exist yet). HARD_CLOSED reject trigger is 193.

CREATE TABLE fin.accounting_events (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  legal_entity_id UUID NOT NULL REFERENCES fin.platform_legal_entities(id),
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'DEFERRED_REVENUE_CREATED',
    'REVENUE_RECOGNIZED',
    'RECEIVABLE_CREATED',
    'BREAKAGE_RECOGNIZED',
    'BAD_DEBT_WRITE_OFF',
    'REFUND_REVENUE_REVERSED',
    'TRANSFER_INTERNAL',
    'ADJUSTMENT_REVENUE',
    'FX_REMEASUREMENT',
    'TAX_ACCRUED',
    'CONSIDERATION_ALLOCATED'
  )),
  event_at TIMESTAMPTZ NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'PURCHASE_INTENT', 'HOLD', 'FACILITY_RESERVATION',
    'LOT', 'INVOICE', 'RATED_USAGE'
  )),
  source_id UUID NOT NULL,
  ledger_transaction_id UUID REFERENCES fin.ledger_transactions(id),
  accounting_policy_version_id UUID NOT NULL,
  accounting_period_id UUID NOT NULL,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID
);

COMMENT ON TABLE fin.accounting_events IS
  'APPEND_ONLY double-entry accounting record (A §9.1). REVOKE UPDATE, DELETE, TRUNCATE. HARD_CLOSED reject is trg_accounting_events_reject_hard_closed (193).';
COMMENT ON COLUMN fin.accounting_events.event_kind IS
  'A §9.1 kinds plus B/C companions REFUND_REVENUE_REVERSED / TRANSFER_INTERNAL / ADJUSTMENT_REVENUE / FX_REMEASUREMENT (DL-123).';
COMMENT ON COLUMN fin.accounting_events.ledger_transaction_id IS
  'Nullable when the event has no ledger movement (e.g. BAD_DEBT_WRITE_OFF).';
COMMENT ON COLUMN fin.accounting_events.event_at IS
  'Economic effective time (A effective_at). Must fall in [period.starts_at, period.ends_at).';

CREATE INDEX idx_accounting_events_period
  ON fin.accounting_events (accounting_period_id, event_at);
CREATE INDEX idx_accounting_events_source
  ON fin.accounting_events (source_type, source_id);
CREATE INDEX idx_accounting_events_tenant
  ON fin.accounting_events (tenant_id, event_at DESC);

-- Once-per-source kinds (parent command claim is the idempotency; this is the belt).
CREATE UNIQUE INDEX uq_accounting_events_once_per_source
  ON fin.accounting_events (environment, source_type, source_id, event_kind)
  WHERE event_kind IN (
    'DEFERRED_REVENUE_CREATED',
    'BREAKAGE_RECOGNIZED',
    'BAD_DEBT_WRITE_OFF'
  );

CREATE TRIGGER trg_accounting_events_env_tenant
  BEFORE INSERT OR UPDATE ON fin.accounting_events
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

ALTER TABLE fin.accounting_events OWNER TO fin_migrator;

ALTER TABLE fin.accounting_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.accounting_events FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.accounting_events
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.accounting_events
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

CREATE POLICY fin_recon_all_read ON fin.accounting_events
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.accounting_events TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.accounting_events FROM fin_app_role;

GRANT SELECT ON fin.accounting_events
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
