-- Phase 7b — Commercial pricing hierarchy + Phase 7a tables that were
-- shipped in code but never migrated. Everything is runtime-editable so
-- Territory / Zone / City / CoreRateCard can be added, removed, and
-- re-priced without redeploying.
--
-- Model:
--   core_rate_cards.rates  = per-action cast quantity (the "Core Rate Card")
--   core_rate_cards.cast_value_minor = base $/cast
--   territories.pricing_multiplier   = % markup off Core Rate Card at
--                                      country level (0.4 = 40% of base)
--   pricing_zones.pricing_multiplier = % markup at sub-country level
--                                      (Beirut 2.0, rural 0.5, ...)
--
-- Effective cast_value_minor for a (territory, zone) tenant =
--   core_rate_cards.cast_value_minor
--     × territories.pricing_multiplier
--     × pricing_zones.pricing_multiplier

-- ---------------------------------------------------------------------------
-- Extend existing public.territories (currently: id, code, name, currency)
-- ---------------------------------------------------------------------------
ALTER TABLE public.territories
  ADD COLUMN IF NOT EXISTS pricing_multiplier NUMERIC(6,4) NOT NULL DEFAULT 1.0000,
  ADD COLUMN IF NOT EXISTS launch_status VARCHAR(20) NOT NULL DEFAULT 'planned'
    CHECK (launch_status IN ('launched','planned','blocked','sunset')),
  ADD COLUMN IF NOT EXISTS launch_wave INTEGER,
  ADD COLUMN IF NOT EXISTS data_residency_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_mode VARCHAR(20) NOT NULL DEFAULT 'card'
    CHECK (billing_mode IN ('card','invoice_only','manual','disabled')),
  ADD COLUMN IF NOT EXISTS vat_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS regulator_id_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS default_zone_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_gateway_primary VARCHAR(50),
  ADD COLUMN IF NOT EXISTS payment_gateway_secondary VARCHAR(50),
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Unique code, active-only can share names within a code
CREATE UNIQUE INDEX IF NOT EXISTS uq_territories_code ON public.territories(code);
CREATE INDEX IF NOT EXISTS idx_territories_launch ON public.territories(launch_status, launch_wave);

-- ---------------------------------------------------------------------------
-- Pricing zones — sub-country geographic slice with its own multiplier
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pricing_zones (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  territory_id TEXT NOT NULL REFERENCES public.territories(id) ON DELETE RESTRICT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),
  pricing_multiplier NUMERIC(6,4) NOT NULL DEFAULT 1.0000,
  is_default BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(territory_id, code)
);

CREATE INDEX IF NOT EXISTS idx_pricing_zones_territory
  ON public.pricing_zones(territory_id, active);

-- Only one default zone per territory (enforced by partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_zones_one_default
  ON public.pricing_zones(territory_id)
  WHERE is_default = true;

-- Now we can add the FK from territories.default_zone_id → pricing_zones.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_territories_default_zone'
  ) THEN
    ALTER TABLE public.territories
      ADD CONSTRAINT fk_territories_default_zone
      FOREIGN KEY (default_zone_id) REFERENCES public.pricing_zones(id) ON DELETE SET NULL;
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- Pricing cities — free-text city names bound to a zone. Used for signup
-- resolution when the tenant picks a city rather than typing a zone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pricing_cities (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  territory_id TEXT NOT NULL REFERENCES public.territories(id) ON DELETE RESTRICT,
  zone_id TEXT REFERENCES public.pricing_zones(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),
  name_norm VARCHAR(255) NOT NULL,
  latitude NUMERIC(10,8),
  longitude NUMERIC(11,8),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(territory_id, name_norm)
);

CREATE INDEX IF NOT EXISTS idx_pricing_cities_zone
  ON public.pricing_cities(zone_id);
CREATE INDEX IF NOT EXISTS idx_pricing_cities_lookup
  ON public.pricing_cities(territory_id, name_norm);

-- ---------------------------------------------------------------------------
-- Core rate cards — versioned. Exactly one row may be is_active = true.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.core_rate_cards (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  version INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  cast_value_minor INTEGER NOT NULL DEFAULT 10,      -- $0.10 as of 14 Aug 2026
  rates JSONB NOT NULL DEFAULT '{}'::jsonb,          -- { action_key: casts_int }
  is_active BOOLEAN NOT NULL DEFAULT false,
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_core_rate_cards_one_active
  ON public.core_rate_cards(is_active)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Phase 7a tables that were shipped in code but never migrated. Creating
-- them here so events + ledger writes stop landing in legacy_collections.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usage_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  subscription_id TEXT,
  action_key VARCHAR(100) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  channel VARCHAR(50),
  destination_country VARCHAR(3),
  whatsapp_category VARCHAR(30),
  listing_id TEXT,
  conversation_id TEXT,
  distribution_id TEXT,
  casts_charged INTEGER NOT NULL DEFAULT 0,
  price_minor INTEGER NOT NULL DEFAULT 0,
  cogs_estimate_minor INTEGER NOT NULL DEFAULT 0,
  rate_card_version INTEGER,
  cast_value_minor INTEGER,
  territory_id TEXT,
  zone_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  billing_period VARCHAR(10),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_period
  ON public.usage_events(tenant_id, billing_period, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_action_period
  ON public.usage_events(action_key, billing_period);
CREATE INDEX IF NOT EXISTS idx_usage_events_occurred
  ON public.usage_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_listing
  ON public.usage_events(listing_id)
  WHERE listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_events_conversation
  ON public.usage_events(conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  subscription_id TEXT,
  billing_period VARCHAR(10) NOT NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN
    ('allowance_grant','consumption','overage','topup','adjustment')),
  quota_key VARCHAR(80) NOT NULL,
  amount NUMERIC(15,4) NOT NULL,
  source_event_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_tenant_quota_period
  ON public.ledger_entries(tenant_id, quota_key, billing_period);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_period
  ON public.ledger_entries(billing_period);

-- Placeholder subscription + product tables so Phase 7c can wire in
-- without a schema jump. Kept intentionally minimal.
CREATE TABLE IF NOT EXISTS public.billing_products (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code VARCHAR(80) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  billing_cadence VARCHAR(20) NOT NULL DEFAULT 'monthly'
    CHECK (billing_cadence IN ('monthly','annual','one_off','90_days','custom')),
  base_price_minor INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  entitlements JSONB NOT NULL DEFAULT '[]'::jsonb,
  bundle_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','deprecated','retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(code, version)
);

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  product_id TEXT REFERENCES public.billing_products(id),
  product_version INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing','active','past_due','cancelled','expired','paused')),
  territory_id TEXT REFERENCES public.territories(id),
  zone_id TEXT REFERENCES public.pricing_zones(id),
  rate_card_version INTEGER,
  cast_value_minor INTEGER,
  price_locked_minor INTEGER,
  billing_period_start TIMESTAMPTZ,
  billing_period_end TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_tenant
  ON public.billing_subscriptions(tenant_id, status);
