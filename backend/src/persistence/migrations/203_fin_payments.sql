-- Stage 10 — fin.payments + payment_allocations + unapplied_cash
-- (A §10.9–10.11 / B §payments / E §5 / DL-133 / DL-134).
-- UNIQUE (provider, provider_event_id) WHERE provider_event_id IS NOT NULL
-- is permanent — NEVER dropped, NEVER expires (mirror Stage 7 purchase_intents).
-- unapplied_cash is CACHE, updated by the command in the same tx (DL-134).

CREATE TABLE fin.payments (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL CHECK (status IN ('RECEIVED', 'ALLOCATED', 'REVERSED')),
  provider TEXT,
  provider_event_id TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  reversed_at TIMESTAMPTZ,
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

COMMENT ON TABLE fin.payments IS
  'INTENT payment machine (B §payments). UNIQUE(provider, provider_event_id) WHERE provider_event_id IS NOT NULL never expires (E §5 / A §10.9). Do not drop that index.';
COMMENT ON COLUMN fin.payments.provider_event_id IS
  'PSP event id. Layer-3 uniqueness with provider; NEVER expires. NULL for MANUAL.';

-- Permanent provider uniqueness (E §5). NEVER dropped.
CREATE UNIQUE INDEX uq_payments_provider_event
  ON fin.payments (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

COMMENT ON INDEX fin.uq_payments_provider_event IS
  'NEVER expires, NEVER dropped. Stripe/PSP retries of the same event id (E §5). Mirror of uq_purchase_intents_provider_event.';

CREATE INDEX idx_payments_account_status
  ON fin.payments (billing_account_id, status, received_at DESC);

CREATE TRIGGER trg_payments_bump_version
  BEFORE UPDATE ON fin.payments
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_payments_env_tenant
  BEFORE INSERT OR UPDATE ON fin.payments
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE OR REPLACE FUNCTION fin.trg_payments_status_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RECEIVED' THEN
      RAISE EXCEPTION 'payments insert status must be RECEIVED, got %', NEW.status
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
  THEN
    RAISE EXCEPTION 'payments economic columns are immutable'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.provider_event_id IS NOT NULL
     AND NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
  THEN
    RAISE EXCEPTION 'payments.provider_event_id is immutable'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'RECEIVED' AND NEW.status IN ('ALLOCATED', 'REVERSED') THEN
    legal := true;
  ELSIF OLD.status = 'ALLOCATED' AND NEW.status = 'REVERSED' THEN
    legal := true;
  END IF;

  IF NOT legal THEN
    RAISE EXCEPTION 'payments illegal transition % → %', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payments_status_flip
  BEFORE INSERT OR UPDATE ON fin.payments
  FOR EACH ROW EXECUTE FUNCTION fin.trg_payments_status_flip();

CREATE TABLE fin.payment_allocations (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  payment_id UUID NOT NULL REFERENCES fin.payments(id),
  invoice_id UUID REFERENCES fin.invoices(id),
  amount_minor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID
);

COMMENT ON TABLE fin.payment_allocations IS
  'APPEND_ONLY (A §10.10). amount_minor is SIGN-FLEXIBLE (DL-133); negative rows compensate ReversePayment.';
COMMENT ON COLUMN fin.payment_allocations.amount_minor IS
  'SIGN-FLEXIBLE. Negative compensating rows are legal. Do NOT add CHECK amount_minor > 0.';

CREATE INDEX idx_payment_allocations_payment ON fin.payment_allocations (payment_id);
CREATE INDEX idx_payment_allocations_invoice ON fin.payment_allocations (invoice_id);

CREATE TRIGGER trg_payment_allocations_env_tenant
  BEFORE INSERT OR UPDATE ON fin.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE TRIGGER trg_payment_allocations_no_update
  BEFORE UPDATE OR DELETE ON fin.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION fin.trg_invoice_children_append_only();

-- CACHE per (environment, billing_account, currency). Command-owned (DL-134):
-- recordPayment / applyPayment / reversePayment UPDATE this row under FOR UPDATE.
-- No posting trigger — reversals + compensating allocations would double-count.
CREATE TABLE fin.unapplied_cash (
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  currency CHAR(3) NOT NULL,
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  balance_minor BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (environment, billing_account_id, currency)
);

COMMENT ON TABLE fin.unapplied_cash IS
  'CACHE (A §10.11). Command-owned UPDATE in the same tx as payments/allocations (DL-134). FOR UPDATE on the cache row (D row 88). Not a posting trigger — Stage 1 account_balances is posting-driven because postings are the sole writer; here reversals plus sign-flexible allocations would double-count under a naive AFTER INSERT trigger.';

CREATE TRIGGER trg_unapplied_cash_env_tenant
  BEFORE INSERT OR UPDATE ON fin.unapplied_cash
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

ALTER TABLE fin.invoice_payment_allocations
  ADD CONSTRAINT fk_invoice_payment_allocations_payment
  FOREIGN KEY (payment_id) REFERENCES fin.payments(id);

ALTER TABLE fin.payments OWNER TO fin_migrator;
ALTER TABLE fin.payment_allocations OWNER TO fin_migrator;
ALTER TABLE fin.unapplied_cash OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_payments_status_flip() OWNER TO fin_migrator;

ALTER TABLE fin.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.payments FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.payment_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.unapplied_cash ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.unapplied_cash FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.payments
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.payment_allocations
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.unapplied_cash
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.payments
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
CREATE POLICY fin_tenant_isolation ON fin.payment_allocations
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
CREATE POLICY fin_tenant_isolation ON fin.unapplied_cash
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

CREATE POLICY fin_recon_all_read ON fin.payments
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.payment_allocations
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));
CREATE POLICY fin_recon_all_read ON fin.unapplied_cash
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT ON fin.payments TO fin_app_role;
GRANT UPDATE (
  status, reversed_at, reason_code,
  updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.payments TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.payments FROM fin_app_role;

GRANT SELECT, INSERT ON fin.payment_allocations TO fin_app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.payment_allocations FROM fin_app_role;

GRANT SELECT, INSERT ON fin.unapplied_cash TO fin_app_role;
GRANT UPDATE (balance_minor, updated_at) ON fin.unapplied_cash TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.unapplied_cash FROM fin_app_role;

GRANT SELECT ON fin.payments, fin.payment_allocations, fin.unapplied_cash
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_payments_status_flip() TO fin_app_role;
