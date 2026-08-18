-- Stage 1 — lots, applicability, allocations, holds, limits (A §5).

CREATE TABLE fin.lots (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  book_id UUID NOT NULL REFERENCES fin.ledger_books(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  holder_id UUID NOT NULL REFERENCES fin.holders(id),
  contract_id UUID,
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'PURCHASE', 'SUBSCRIPTION_GRANT', 'PROMOTIONAL_GRANT', 'ROLLOVER',
    'TRANSFER_IN', 'ADJUSTMENT', 'REFUND_REVERSAL', 'FACILITY_DRAW',
    'MIGRATION', 'COMPENSATION'
  )),
  granted_units BIGINT NOT NULL,
  remaining_units BIGINT NOT NULL,
  consideration_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  draw_priority INTEGER NOT NULL,
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'EXPIRED', 'FROZEN')),
  purchase_intent_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  CHECK (remaining_units >= 0 AND remaining_units <= granted_units)
);

CREATE TRIGGER trg_lots_bump_version
  BEFORE UPDATE ON fin.lots
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_lots_env_tenant
  BEFORE INSERT OR UPDATE ON fin.lots
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE INDEX idx_lots_draw_order
  ON fin.lots (holder_id, status, draw_priority, expires_at, issued_at, id);

CREATE TABLE fin.lot_applicability_rules (
  id UUID PRIMARY KEY,
  lot_id UUID NOT NULL REFERENCES fin.lots(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  rule_kind TEXT NOT NULL CHECK (rule_kind IN (
    'ALLOW_METER', 'DENY_METER', 'ALLOW_CATEGORY', 'DENY_CATEGORY',
    'ALLOW_VENDOR', 'DENY_VENDOR', 'ALLOW_ACTION', 'DENY_ACTION'
  )),
  matcher TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_lot_applicability_rules_bump_version
  BEFORE UPDATE ON fin.lot_applicability_rules
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TABLE fin.lot_allocations (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  lot_id UUID NOT NULL REFERENCES fin.lots(id),
  posting_id UUID NOT NULL REFERENCES fin.ledger_postings(id),
  hold_id UUID,
  units BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (posting_id, lot_id)
);

ALTER TABLE fin.ledger_postings
  ADD CONSTRAINT ledger_postings_lot_id_fkey
  FOREIGN KEY (lot_id) REFERENCES fin.lots(id);

CREATE OR REPLACE FUNCTION fin.trg_apply_lot_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fin, public, pg_temp
AS $$
BEGIN
  UPDATE fin.lots
     SET remaining_units = remaining_units + NEW.units,
         updated_at = NEW.created_at
   WHERE id = NEW.lot_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lot_allocations_apply
  AFTER INSERT ON fin.lot_allocations
  FOR EACH ROW
  EXECUTE FUNCTION fin.trg_apply_lot_allocation();

CREATE TABLE fin.holds (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  holder_id UUID NOT NULL REFERENCES fin.holders(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  book_id UUID NOT NULL REFERENCES fin.ledger_books(id),
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  units BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CAPTURED', 'VOIDED', 'EXPIRED')),
  authorize_tx_id UUID REFERENCES fin.ledger_transactions(id),
  capture_tx_id UUID REFERENCES fin.ledger_transactions(id),
  release_tx_id UUID REFERENCES fin.ledger_transactions(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_holds_bump_version
  BEFORE UPDATE ON fin.holds
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_holds_env_tenant
  BEFORE INSERT OR UPDATE ON fin.holds
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE INDEX idx_holds_open_expiry
  ON fin.holds (status, expires_at)
  WHERE status = 'OPEN';

ALTER TABLE fin.lot_allocations
  ADD CONSTRAINT lot_allocations_hold_id_fkey
  FOREIGN KEY (hold_id) REFERENCES fin.holds(id);

CREATE TABLE fin.usage_limits (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  contract_component_id UUID,
  meter_id UUID,
  period_kind TEXT NOT NULL CHECK (period_kind IN (
    'DAY', 'WEEK', 'MONTH', 'ROLLING_30D', 'CONTRACT_TERM'
  )),
  limit_units BIGINT NOT NULL,
  breach_behavior TEXT NOT NULL CHECK (breach_behavior IN ('BLOCK', 'WARN')),
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1
);

CREATE TRIGGER trg_usage_limits_bump_version
  BEFORE UPDATE ON fin.usage_limits
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_usage_limits_env_tenant
  BEFORE INSERT OR UPDATE ON fin.usage_limits
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE TABLE fin.limit_counters (
  id UUID PRIMARY KEY,
  usage_limit_id UUID NOT NULL REFERENCES fin.usage_limits(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  period_key TEXT NOT NULL,
  consumed_units BIGINT NOT NULL,
  UNIQUE (usage_limit_id, period_key)
);
