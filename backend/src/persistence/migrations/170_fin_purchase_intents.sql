-- Stage 7 — fin.purchase_intents (A §8.1 / B §4). INTENT class.
-- UNIQUE(provider, provider_event_id) WHERE provider_event_id IS NOT NULL
-- is permanent (E §5) — NEVER dropped, NEVER expires.
-- Status-flip trigger is the immutability backstop for PAID rows.
-- DL-091 / DL-092.

CREATE TABLE fin.purchase_intents (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  holder_id UUID NOT NULL REFERENCES fin.holders(id),
  status TEXT NOT NULL CHECK (status IN (
    'CREATED', 'PAYMENT_PENDING', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED'
  )),
  quoted_units BIGINT NOT NULL CHECK (quoted_units > 0),
  quoted_bonus_units BIGINT NOT NULL DEFAULT 0 CHECK (quoted_bonus_units >= 0),
  quoted_minor BIGINT NOT NULL CHECK (quoted_minor > 0),
  currency CHAR(3) NOT NULL,
  price_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider TEXT CHECK (provider IS NULL OR provider IN ('STRIPE', 'MANUAL', 'INVOICE')),
  provider_event_id TEXT,
  reason_code TEXT NOT NULL,
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

COMMENT ON TABLE fin.purchase_intents IS
  'INTENT purchase machine (B §4). UNIQUE(provider, provider_event_id) WHERE provider_event_id IS NOT NULL never expires (E §5 / A §8.1). Do not drop that index.';

COMMENT ON COLUMN fin.purchase_intents.provider_event_id IS
  'PSP event id. Layer-3 uniqueness with provider; NEVER expires. NULL until confirm.';

-- Permanent provider uniqueness (E §5). NEVER dropped.
CREATE UNIQUE INDEX uq_purchase_intents_provider_event
  ON fin.purchase_intents (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

COMMENT ON INDEX fin.uq_purchase_intents_provider_event IS
  'NEVER expires, NEVER dropped. Stripe/PSP retries of the same event id (E §5).';

CREATE INDEX idx_purchase_intents_tenant_status
  ON fin.purchase_intents (tenant_id, status, created_at DESC);
CREATE INDEX idx_purchase_intents_holder
  ON fin.purchase_intents (holder_id, created_at DESC);
CREATE INDEX idx_purchase_intents_billing_account
  ON fin.purchase_intents (billing_account_id, created_at DESC);

CREATE TRIGGER trg_purchase_intents_bump_version
  BEFORE UPDATE ON fin.purchase_intents
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_purchase_intents_env_tenant
  BEFORE INSERT OR UPDATE ON fin.purchase_intents
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE OR REPLACE FUNCTION fin.trg_purchase_intents_status_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'CREATED' THEN
      RAISE EXCEPTION 'purchase_intents insert status must be CREATED, got %', NEW.status
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  -- Frozen economic columns: never mutate after insert (column GRANT also
  -- withholds UPDATE). Trigger is the defence in depth for table-owner paths.
  IF NEW.quoted_units IS DISTINCT FROM OLD.quoted_units
     OR NEW.quoted_bonus_units IS DISTINCT FROM OLD.quoted_bonus_units
     OR NEW.quoted_minor IS DISTINCT FROM OLD.quoted_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id
     OR NEW.holder_id IS DISTINCT FROM OLD.holder_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
  THEN
    RAISE EXCEPTION 'purchase_intents economic columns are immutable'
      USING ERRCODE = '22023';
  END IF;

  -- provider_event_id is set on confirm. Once PAID/CANCELED/REFUNDED it
  -- is frozen (E §5). FAILED→PAYMENT_PENDING may NULL it for a new attempt.
  IF OLD.provider_event_id IS NOT NULL
     AND NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
     AND OLD.status IN ('PAID', 'CANCELED', 'REFUNDED')
  THEN
    RAISE EXCEPTION 'purchase_intents.provider_event_id is immutable after %', OLD.status
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'CREATED' AND NEW.status IN ('PAYMENT_PENDING', 'PAID', 'CANCELED') THEN
    legal := true;
  ELSIF OLD.status = 'PAYMENT_PENDING' AND NEW.status IN ('PAID', 'FAILED', 'CANCELED') THEN
    legal := true;
  ELSIF OLD.status = 'FAILED' AND NEW.status IN ('PAYMENT_PENDING', 'CANCELED') THEN
    legal := true;
  ELSIF OLD.status = 'PAID' AND NEW.status = 'REFUNDED' THEN
    legal := true;
  END IF;

  IF NOT legal THEN
    RAISE EXCEPTION 'purchase_intents illegal transition % → %', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_purchase_intents_status_flip
  BEFORE INSERT OR UPDATE ON fin.purchase_intents
  FOR EACH ROW EXECUTE FUNCTION fin.trg_purchase_intents_status_flip();

ALTER TABLE fin.purchase_intents OWNER TO fin_migrator;
ALTER FUNCTION fin.trg_purchase_intents_status_flip() OWNER TO fin_migrator;

ALTER TABLE fin.purchase_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.purchase_intents FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.purchase_intents
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_tenant_isolation ON fin.purchase_intents
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

CREATE POLICY fin_recon_all_read ON fin.purchase_intents
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

-- INTENT: INSERT + status-flip UPDATE. Frozen economic columns are not
-- in the column GRANT (price_snapshot, quoted_*, currency).
GRANT SELECT, INSERT ON fin.purchase_intents TO fin_app_role;
GRANT UPDATE (
  status, provider, provider_event_id, reason_code,
  paid_at, failed_at, canceled_at, refunded_at,
  updated_at, updated_by_actor_type, updated_by_actor_id
) ON fin.purchase_intents TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.purchase_intents FROM fin_app_role;

GRANT SELECT ON fin.purchase_intents
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;

GRANT EXECUTE ON FUNCTION fin.trg_purchase_intents_status_flip() TO fin_app_role;
