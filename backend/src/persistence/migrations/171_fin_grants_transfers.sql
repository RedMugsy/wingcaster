-- Stage 7 — credit product catalog + auto-topup policy.
-- Filename is historical (plan §Stage 7). fin.grants / fin.transfers are
-- NOT created: DL-034 forbids fin.grants; TransferCredits uses a minted
-- TRANSFER_INTENT UUID (B §26). Auto-topup config is the companion A omitted
-- for spec §52 (DL-096).

CREATE TABLE fin.credit_products (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  units BIGINT NOT NULL CHECK (units > 0),
  bonus_units BIGINT NOT NULL DEFAULT 0 CHECK (bonus_units >= 0),
  price_minor BIGINT NOT NULL CHECK (price_minor > 0),
  currency CHAR(3) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, code),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TRIGGER trg_credit_products_bump_version
  BEFORE UPDATE ON fin.credit_products
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE INDEX idx_credit_products_env_active
  ON fin.credit_products (environment, active, currency, effective_from);

-- Auto-topup policy per billing account ("wallet"). Worker (class 1010)
-- selects due rows; cooldown / caps / suspension live here so the
-- spend/capture tx that trips the threshold never charges inline (DL-094).
CREATE TABLE fin.auto_topup_policies (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  holder_id UUID NOT NULL REFERENCES fin.holders(id),
  product_id UUID NOT NULL REFERENCES fin.credit_products(id),
  enabled BOOLEAN NOT NULL DEFAULT true,
  threshold_units BIGINT NOT NULL CHECK (threshold_units >= 0),
  cooldown_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (cooldown_seconds >= 0),
  cooldown_until TIMESTAMPTZ,
  daily_cap INTEGER NOT NULL DEFAULT 1 CHECK (daily_cap >= 0),
  monthly_cap INTEGER NOT NULL DEFAULT 10 CHECK (monthly_cap >= 0),
  daily_count INTEGER NOT NULL DEFAULT 0 CHECK (daily_count >= 0),
  monthly_count INTEGER NOT NULL DEFAULT 0 CHECK (monthly_count >= 0),
  daily_period_key TEXT,
  monthly_period_key TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  failure_threshold INTEGER NOT NULL DEFAULT 3 CHECK (failure_threshold >= 1),
  auto_topup_suspended BOOLEAN NOT NULL DEFAULT false,
  streak_count INTEGER NOT NULL DEFAULT 0 CHECK (streak_count >= 0),
  last_intent_id UUID REFERENCES fin.purchase_intents(id),
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, billing_account_id)
);

CREATE TRIGGER trg_auto_topup_policies_bump_version
  BEFORE UPDATE ON fin.auto_topup_policies
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_auto_topup_policies_env_tenant
  BEFORE INSERT OR UPDATE ON fin.auto_topup_policies
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE INDEX idx_auto_topup_due
  ON fin.auto_topup_policies (billing_account_id, id)
  WHERE enabled AND NOT auto_topup_suspended;

-- ---------------------------------------------------------------------------
-- RLS: credit_products is catalog-style (no tenant grain), like fin.prices.
-- auto_topup_policies is tenant-scoped.
-- ---------------------------------------------------------------------------
ALTER TABLE fin.credit_products OWNER TO fin_migrator;
ALTER TABLE fin.auto_topup_policies OWNER TO fin_migrator;

ALTER TABLE fin.credit_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.credit_products FORCE ROW LEVEL SECURITY;
ALTER TABLE fin.auto_topup_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.auto_topup_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY fin_migrator_all ON fin.credit_products
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);
CREATE POLICY fin_migrator_all ON fin.auto_topup_policies
  FOR ALL TO fin_migrator USING (true) WITH CHECK (true);

CREATE POLICY fin_catalog_app ON fin.credit_products
  FOR ALL TO fin_app_role USING (true) WITH CHECK (true);
CREATE POLICY fin_catalog_read ON fin.credit_products
  FOR SELECT TO fin_finance_role, fin_auditor_role, fin_recon_role USING (true);

CREATE POLICY fin_tenant_isolation ON fin.auto_topup_policies
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

CREATE POLICY fin_recon_all_read ON fin.auto_topup_policies
  FOR SELECT TO fin_recon_role
  USING (environment = current_setting('fin.environment', true));

GRANT SELECT, INSERT, UPDATE ON fin.credit_products TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.credit_products FROM fin_app_role;

GRANT SELECT, INSERT, UPDATE ON fin.auto_topup_policies TO fin_app_role;
REVOKE DELETE, TRUNCATE ON fin.auto_topup_policies FROM fin_app_role;

GRANT SELECT ON fin.credit_products, fin.auto_topup_policies
  TO fin_recon_role, fin_finance_role, fin_auditor_role, fin_migrate_role;
