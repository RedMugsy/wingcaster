-- Phase 7c/3 — Credit notes (proration + courtesy credits) + subscription
-- plan-price lock fields for accurate mid-period proration.
--
-- What this migration adds:
--
--   commercial.billing_credit_notes
--     A new append-only ledger of money owed TO or FROM the tenant that
--     is DENOMINATED IN DOLLARS (minor units), separate from the
--     existing quota ledger which tracks feature-unit balances. Every
--     proration on subscription migration writes a row here; Phase 7e
--     will read these when generating invoices.
--
--   commercial.billing_subscriptions.resolved_plan_*
--     Snapshot the plan price + currency + resolution source at
--     subscription creation, so mid-period migration proration uses the
--     price the tenant actually agreed to (protects against tier / override
--     price changes that shouldn't retroactively alter proration math).
--     Separate from the existing price_locked_minor field which locks the
--     CAST value for the metering resolver — different concept.

-- ---------------------------------------------------------------------------
-- Step 1 — subscription plan-price snapshot fields.
-- ---------------------------------------------------------------------------
ALTER TABLE commercial.billing_subscriptions
  ADD COLUMN IF NOT EXISTS resolved_plan_price_minor INTEGER,
  ADD COLUMN IF NOT EXISTS resolved_plan_currency VARCHAR(3),
  ADD COLUMN IF NOT EXISTS resolved_plan_source VARCHAR(40);

-- ---------------------------------------------------------------------------
-- Step 2 — credit-notes table.
--
-- amount_minor is SIGNED:
--   positive → credit owed to the tenant (refund / proration credit)
--   negative → charge owed by the tenant (proration debit for upgrade)
--
-- status:
--   pending  → waiting to be applied (default at create)
--   applied  → consumed against an invoice / payment (Phase 7e territory)
--   expired  → time-limited credit that lapsed
--   voided   → admin cancelled before it could be applied
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commercial.billing_credit_notes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  subscription_id TEXT REFERENCES commercial.billing_subscriptions(id) ON DELETE SET NULL,
  type VARCHAR(40) NOT NULL
    CHECK (type IN ('proration_credit','proration_debit','refund','courtesy','promo','manual_adjustment')),
  amount_minor INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','expired','voided')),
  applied_at TIMESTAMPTZ,
  applied_to_invoice_id TEXT,
  expires_at TIMESTAMPTZ,
  reason TEXT,
  actor_id TEXT,
  actor_type VARCHAR(20)
    CHECK (actor_type IS NULL OR actor_type IN ('tenant','admin','system','api')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_credit_notes_tenant_status
  ON commercial.billing_credit_notes(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_notes_subscription
  ON commercial.billing_credit_notes(subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_notes_pending_by_currency
  ON commercial.billing_credit_notes(tenant_id, currency)
  WHERE status = 'pending';
