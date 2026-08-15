-- Phase 7c/1 — Product catalog: tiers, per-territory pricing overrides,
-- subscription-history audit trail.
--
-- Migration 029 shipped placeholder billing_products + billing_subscriptions
-- tables; migration 030 moved them to the commercial schema. This migration
-- expands them into a full product-catalog schema so Phase 7c/2's lifecycle
-- engine + 7c/4's admin UI have real tables to write against.
--
-- The high-level model:
--   commercial.billing_products
--                             — a saleable thing. Versioned. Draft → active
--                                → deprecated → retired.
--   commercial.billing_product_tiers
--                             — variants of a product (Basic / Pro / Enterprise).
--                                Each tier has its own quotas + features +
--                                override price. Belongs to (product, version).
--   commercial.billing_product_territory_pricing
--                             — per-territory price override. If a row exists
--                                for (product, tier?, territory), it wins over
--                                the base price on the product/tier.
--   commercial.billing_subscription_history
--                             — append-only audit trail of every subscription
--                                mutation (create, renew, upgrade, cancel …).

-- ---------------------------------------------------------------------------
-- Step 1: expand commercial.billing_products.
--
-- Add product_type ('plan' | 'addon' | 'bundle') so bundles are first-class.
-- Add published_at / deprecated_at / retired_at for the drafted-versus-live
-- audit, and created_by for authorship attribution.
-- ---------------------------------------------------------------------------
ALTER TABLE commercial.billing_products
  ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) NOT NULL DEFAULT 'plan',
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_products_product_type_ck'
  ) THEN
    ALTER TABLE commercial.billing_products
      ADD CONSTRAINT billing_products_product_type_ck
      CHECK (product_type IN ('plan','addon','bundle'));
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- Step 2: commercial.billing_product_tiers.
--
-- A tier is a variant of a specific (product, version). Basic/Pro/Enterprise.
-- Quotas + features are per-tier, so a "Pro" WhatsApp allowance differs
-- from "Basic". Price on the tier overrides the product's base_price_minor
-- when set.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commercial.billing_product_tiers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id TEXT NOT NULL REFERENCES commercial.billing_products(id) ON DELETE CASCADE,
  product_version INTEGER NOT NULL,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  price_minor INTEGER,
  currency VARCHAR(3),
  quotas JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','deprecated','retired')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(product_id, product_version, code)
);

CREATE INDEX IF NOT EXISTS idx_billing_product_tiers_product
  ON commercial.billing_product_tiers(product_id, product_version, status);

CREATE INDEX IF NOT EXISTS idx_billing_product_tiers_status
  ON commercial.billing_product_tiers(status)
  WHERE status IN ('active','draft');

-- ---------------------------------------------------------------------------
-- Step 3: commercial.billing_product_territory_pricing.
--
-- Per-territory override. tier_id NULL → override for the whole product.
-- tier_id set → override for that specific tier. The resolver picks the
-- most-specific match (tier + territory > product + territory > product
-- base_price / tier base_price).
--
-- territory_id references commercial.territories (moved from public in 030).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commercial.billing_product_territory_pricing (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id TEXT NOT NULL REFERENCES commercial.billing_products(id) ON DELETE CASCADE,
  product_version INTEGER NOT NULL,
  tier_id TEXT REFERENCES commercial.billing_product_tiers(id) ON DELETE CASCADE,
  territory_id TEXT NOT NULL REFERENCES commercial.territories(id) ON DELETE CASCADE,
  price_minor INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_territory_pricing_product_wide
  ON commercial.billing_product_territory_pricing(product_id, product_version, territory_id)
  WHERE tier_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_territory_pricing_tier_specific
  ON commercial.billing_product_territory_pricing(product_id, product_version, tier_id, territory_id)
  WHERE tier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_territory_pricing_lookup
  ON commercial.billing_product_territory_pricing(product_id, product_version, territory_id)
  WHERE active = true;

-- ---------------------------------------------------------------------------
-- Step 4: expand commercial.billing_subscriptions with tier_id + lifecycle
-- fields Phase 7c/2 will drive.
--
--   tier_id                     — the specific tier the subscription is bound to
--   grandfathered_at            — when a superseding version shipped and this
--                                  subscriber stayed put
--   eligible_for_migration      — admin flag to prompt this tenant to migrate
--   next_renewal_at             — cached from billing_period_end for the
--                                  renewal-scanner cron in 7c/2
--   auto_renew                  — tenant preference
--   cancel_at_period_end        — grace-period cancel: still active until period ends
--   cancellation_reason         — free text captured at cancel time
-- ---------------------------------------------------------------------------
ALTER TABLE commercial.billing_subscriptions
  ADD COLUMN IF NOT EXISTS tier_id TEXT REFERENCES commercial.billing_product_tiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grandfathered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eligible_for_migration BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_renewal_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_tier
  ON commercial.billing_subscriptions(tier_id);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_next_renewal
  ON commercial.billing_subscriptions(next_renewal_at)
  WHERE status = 'active' AND next_renewal_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Step 5: commercial.billing_subscription_history — append-only audit trail.
--
-- Every mutation to a subscription writes a row here. Never UPDATE this
-- table. from_state / to_state are JSON snapshots of the subscription
-- row before and after. actor_type distinguishes tenant self-serve vs
-- admin intervention vs system automation (renewal, trial-expiry).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commercial.billing_subscription_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  subscription_id TEXT NOT NULL REFERENCES commercial.billing_subscriptions(id) ON DELETE CASCADE,
  event VARCHAR(40) NOT NULL,
  from_state JSONB,
  to_state JSONB,
  reason TEXT,
  actor_id TEXT,
  actor_type VARCHAR(20)
    CHECK (actor_type IS NULL OR actor_type IN ('tenant','admin','system','api')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_subscription_history_subscription
  ON commercial.billing_subscription_history(subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_history_event
  ON commercial.billing_subscription_history(event, created_at DESC);
