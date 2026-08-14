-- Phase 7b.1a — Split billing/commercial concerns out of public.*
--
-- Motivation: public.territories carries listing-disclosure metadata
-- (habitable_area_m² required in LB, RERA_ID required in AE, ...) AND
-- was extended in migration 029 with Phase 7b commercial columns
-- (pricing_multiplier, launch_status, ...). The two concerns share a
-- row today, which was flagged during the Phase 7b audit brief.
--
-- This migration separates them by:
--   1. Creating a `commercial` schema.
--   2. Moving every Phase 7b + Phase 7a billing table into it.
--   3. Creating commercial.territories as a fresh table keyed by the
--      SAME row id as public.territories (so the two remain 1:1 by id).
--   4. Copying the extended columns from public.territories into
--      commercial.territories.
--   5. Dropping the extended columns from public.territories.
--
-- Result:
--   public.territories       → listing/disclosure concern only
--                              (id, code, name, currency)
--   commercial.territories   → billing/pricing concern
--                              (id references public.territories.id,
--                              pricing_multiplier, launch_status, …)
--
-- Existing seed data written by Phase 7b.1's seedPricingHierarchy() is
-- preserved via the INSERT ... SELECT step.

CREATE SCHEMA IF NOT EXISTS commercial;

-- ---------------------------------------------------------------------------
-- Move existing Phase 7a/b tables into the commercial schema
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'pricing_zones') THEN
    EXECUTE 'ALTER TABLE public.pricing_zones SET SCHEMA commercial';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'pricing_cities') THEN
    EXECUTE 'ALTER TABLE public.pricing_cities SET SCHEMA commercial';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'core_rate_cards') THEN
    EXECUTE 'ALTER TABLE public.core_rate_cards SET SCHEMA commercial';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'billing_products') THEN
    EXECUTE 'ALTER TABLE public.billing_products SET SCHEMA commercial';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'billing_subscriptions') THEN
    EXECUTE 'ALTER TABLE public.billing_subscriptions SET SCHEMA commercial';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'usage_events') THEN
    EXECUTE 'ALTER TABLE public.usage_events SET SCHEMA commercial';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ledger_entries') THEN
    EXECUTE 'ALTER TABLE public.ledger_entries SET SCHEMA commercial';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- Create commercial.territories mirroring the billing/pricing columns.
-- Same id as public.territories so joins stay simple. Foreign key back
-- to public keeps referential integrity: you cannot have a commercial
-- territory without a listing-disclosure territory.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commercial.territories (
  id TEXT PRIMARY KEY REFERENCES public.territories(id) ON DELETE CASCADE,
  code VARCHAR(2) NOT NULL UNIQUE,
  pricing_multiplier NUMERIC(6,4) NOT NULL DEFAULT 1.0000,
  launch_status VARCHAR(20) NOT NULL DEFAULT 'planned'
    CHECK (launch_status IN ('launched','planned','blocked','sunset')),
  launch_wave INTEGER,
  data_residency_required BOOLEAN NOT NULL DEFAULT false,
  billing_mode VARCHAR(20) NOT NULL DEFAULT 'card'
    CHECK (billing_mode IN ('card','invoice_only','manual','disabled')),
  vat_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  regulator_id_type VARCHAR(50),
  default_zone_id TEXT,
  payment_gateway_primary VARCHAR(50),
  payment_gateway_secondary VARCHAR(50),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_commercial_territories_launch
  ON commercial.territories(launch_status, launch_wave);

-- Backfill from public.territories where the extended columns exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'territories'
               AND column_name = 'pricing_multiplier') THEN
    EXECUTE $mig$
      INSERT INTO commercial.territories (
        id, code, pricing_multiplier, launch_status, launch_wave,
        data_residency_required, billing_mode, vat_percent,
        regulator_id_type, default_zone_id,
        payment_gateway_primary, payment_gateway_secondary,
        sort_order, active, created_at, updated_at, data
      )
      SELECT id, code,
        COALESCE(pricing_multiplier, 1.0000),
        COALESCE(launch_status, 'planned'),
        launch_wave,
        COALESCE(data_residency_required, false),
        COALESCE(billing_mode, 'card'),
        COALESCE(vat_percent, 0),
        regulator_id_type,
        default_zone_id,
        payment_gateway_primary,
        payment_gateway_secondary,
        COALESCE(sort_order, 0),
        COALESCE(active, true),
        COALESCE(created_at, CURRENT_TIMESTAMP),
        COALESCE(updated_at, CURRENT_TIMESTAMP),
        COALESCE(data, '{}'::jsonb)
      FROM public.territories
      ON CONFLICT (id) DO NOTHING
    $mig$;
  END IF;
END$$;

-- Repoint zone/city/subscription FKs from public.territories to
-- commercial.territories. Same id space so this is safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'pricing_zones_territory_id_fkey') THEN
    EXECUTE 'ALTER TABLE commercial.pricing_zones DROP CONSTRAINT pricing_zones_territory_id_fkey';
  END IF;
  ALTER TABLE commercial.pricing_zones
    ADD CONSTRAINT pricing_zones_territory_id_fkey
    FOREIGN KEY (territory_id) REFERENCES commercial.territories(id) ON DELETE RESTRICT;

  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'pricing_cities_territory_id_fkey') THEN
    EXECUTE 'ALTER TABLE commercial.pricing_cities DROP CONSTRAINT pricing_cities_territory_id_fkey';
  END IF;
  ALTER TABLE commercial.pricing_cities
    ADD CONSTRAINT pricing_cities_territory_id_fkey
    FOREIGN KEY (territory_id) REFERENCES commercial.territories(id) ON DELETE RESTRICT;

  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'billing_subscriptions_territory_id_fkey') THEN
    EXECUTE 'ALTER TABLE commercial.billing_subscriptions DROP CONSTRAINT billing_subscriptions_territory_id_fkey';
  END IF;
  ALTER TABLE commercial.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_territory_id_fkey
    FOREIGN KEY (territory_id) REFERENCES commercial.territories(id);

  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'billing_subscriptions_zone_id_fkey') THEN
    EXECUTE 'ALTER TABLE commercial.billing_subscriptions DROP CONSTRAINT billing_subscriptions_zone_id_fkey';
  END IF;
  ALTER TABLE commercial.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_zone_id_fkey
    FOREIGN KEY (zone_id) REFERENCES commercial.pricing_zones(id);

  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'fk_territories_default_zone') THEN
    EXECUTE 'ALTER TABLE public.territories DROP CONSTRAINT fk_territories_default_zone';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fk_commercial_territories_default_zone') THEN
    ALTER TABLE commercial.territories
      ADD CONSTRAINT fk_commercial_territories_default_zone
      FOREIGN KEY (default_zone_id) REFERENCES commercial.pricing_zones(id) ON DELETE SET NULL;
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- Drop the extended commercial columns from public.territories now that
-- their data lives in commercial.territories.
-- ---------------------------------------------------------------------------
ALTER TABLE public.territories
  DROP COLUMN IF EXISTS pricing_multiplier,
  DROP COLUMN IF EXISTS launch_status,
  DROP COLUMN IF EXISTS launch_wave,
  DROP COLUMN IF EXISTS data_residency_required,
  DROP COLUMN IF EXISTS billing_mode,
  DROP COLUMN IF EXISTS vat_percent,
  DROP COLUMN IF EXISTS regulator_id_type,
  DROP COLUMN IF EXISTS default_zone_id,
  DROP COLUMN IF EXISTS payment_gateway_primary,
  DROP COLUMN IF EXISTS payment_gateway_secondary,
  DROP COLUMN IF EXISTS sort_order,
  DROP COLUMN IF EXISTS active;
-- Keep created_at, updated_at, data on public.territories — they are
-- generic and useful for the listing/disclosure concern too.
