-- Market Pricing Intelligence Engine
-- Depends on Area Intelligence (area_profiles) and public.properties.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS market_pricing;

-- ---------------------------------------------------------------------------
-- Comparable match configuration (admin-editable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing.pricing_match_configs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name VARCHAR(255) NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Data source configuration (internal, external, government)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing.pricing_sources (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source VARCHAR(100) NOT NULL UNIQUE,
  provider VARCHAR(100) NOT NULL DEFAULT 'skeleton',
  label VARCHAR(255) NOT NULL,
  enabled BOOLEAN DEFAULT false,
  is_internal BOOLEAN DEFAULT false,
  requires_disclaimer BOOLEAN DEFAULT false,
  disclaimer TEXT,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Normalization rules (payment method, condition, furnished, view)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing.pricing_normalization_rules (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN ('payment_method','condition','furnished','view')),
  value VARCHAR(100) NOT NULL,
  adjustment_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(rule_type, value)
);

-- ---------------------------------------------------------------------------
-- Cached price analysis per property
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing.property_price_analyses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id TEXT NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  match_config_id TEXT REFERENCES market_pricing.pricing_match_configs(id),

  comparable_count INTEGER NOT NULL DEFAULT 0,
  lowest_price NUMERIC(15,2),
  lowest_price_property_id TEXT REFERENCES public.properties(id),
  highest_price NUMERIC(15,2),
  highest_price_property_id TEXT REFERENCES public.properties(id),
  median_price NUMERIC(15,2),
  mean_price NUMERIC(15,2),
  percentile_25 NUMERIC(15,2),
  percentile_75 NUMERIC(15,2),

  target_percentile NUMERIC(5,2),
  target_vs_median VARCHAR(20),
  target_vs_median_percent NUMERIC(5,2),

  confidence VARCHAR(20),
  confidence_reason TEXT,
  market_context_sentence TEXT,

  currency_normalized VARCHAR(10) DEFAULT 'USD',
  parallel_rate_used NUMERIC(10,2),

  calculated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,

  UNIQUE(property_id, match_config_id)
);

-- ---------------------------------------------------------------------------
-- External comparables (scraped or manually entered)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing.external_comparables (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source VARCHAR(100) NOT NULL,
  source_url TEXT,
  external_id VARCHAR(255),

  title TEXT,
  price NUMERIC(15,2),
  currency VARCHAR(10),
  price_normalized_usd NUMERIC(15,2),
  property_type VARCHAR(100),
  bedrooms INTEGER,
  bathrooms INTEGER,
  area_sqm NUMERIC(10,2),
  building_age_years INTEGER,
  condition VARCHAR(50) DEFAULT 'unknown',
  furnished VARCHAR(50) DEFAULT 'unknown',
  view_type VARCHAR(50) DEFAULT 'unknown',
  payment_method VARCHAR(50) DEFAULT 'unknown',
  location_text TEXT,
  latitude NUMERIC(10,8),
  longitude NUMERIC(11,8),
  geom GEOMETRY(Point, 4326),
  area_id TEXT REFERENCES area_intelligence.area_profiles(id),

  scraped_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active','removed','sold','expired')),

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Quarterly price trend snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing.price_trend_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  area_id TEXT NOT NULL REFERENCES area_intelligence.area_profiles(id),
  property_type VARCHAR(100) NOT NULL,
  year INTEGER NOT NULL,
  quarter INTEGER NOT NULL CHECK (quarter IN (1,2,3,4)),

  median_price NUMERIC(15,2),
  median_price_per_sqm NUMERIC(10,2),
  mean_price NUMERIC(15,2),
  mean_price_per_sqm NUMERIC(10,2),
  properties_count INTEGER,
  new_listings_count INTEGER,

  change_from_prev_quarter_percent NUMERIC(5,2),
  change_from_prev_year_percent NUMERIC(5,2),

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,

  UNIQUE(area_id, property_type, year, quarter)
);

-- ---------------------------------------------------------------------------
-- Currency / parallel market rates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing.currency_rates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  from_currency VARCHAR(10) NOT NULL,
  to_currency VARCHAR(10) NOT NULL,
  rate NUMERIC(15,6) NOT NULL,
  source VARCHAR(100),
  source_config JSONB DEFAULT '{}'::jsonb,
  effective_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Agent/user reports on inaccurate comparables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing.comparable_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reporter_id TEXT REFERENCES public.users(id),
  comparable_id TEXT NOT NULL,
  comparable_type VARCHAR(20) CHECK (comparable_type IN ('internal','external')),
  reason VARCHAR(100) NOT NULL,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed','actioned')),
  reviewed_by TEXT REFERENCES public.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Spatial + lookup indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_external_comparables_geom
  ON market_pricing.external_comparables USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_external_comparables_area
  ON market_pricing.external_comparables(area_id);
CREATE INDEX IF NOT EXISTS idx_external_comparables_source
  ON market_pricing.external_comparables(source);

CREATE INDEX IF NOT EXISTS idx_price_trend_snapshots_lookup
  ON market_pricing.price_trend_snapshots(area_id, property_type, year, quarter);

CREATE INDEX IF NOT EXISTS idx_property_price_analyses_property
  ON market_pricing.property_price_analyses(property_id);
CREATE INDEX IF NOT EXISTS idx_property_price_analyses_calculated
  ON market_pricing.property_price_analyses(calculated_at);

CREATE INDEX IF NOT EXISTS idx_currency_rates_lookup
  ON market_pricing.currency_rates(from_currency, to_currency, effective_at DESC);

CREATE INDEX IF NOT EXISTS idx_comparable_reports_status
  ON market_pricing.comparable_reports(status);

-- ---------------------------------------------------------------------------
-- Add generated PostGIS point to properties for fast radius queries.
-- This requires PostGIS to be enabled on the cluster before migration runs.
-- ---------------------------------------------------------------------------
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS geom GEOMETRY(Point, 4326)
  GENERATED ALWAYS AS (
    CASE
      WHEN longitude IS NOT NULL AND latitude IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
      ELSE NULL
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_properties_geom ON public.properties USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_properties_area_type_status
  ON public.properties(city, neighborhood, property_type, status);
