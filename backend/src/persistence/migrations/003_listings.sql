-- Listings / property domain tables

CREATE TABLE IF NOT EXISTS territories (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  currency TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS territory_disclosure_fields (
  id TEXT PRIMARY KEY,
  territory_id TEXT NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT,
  field_type TEXT,
  required BOOLEAN DEFAULT false,
  unit TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agency_id TEXT REFERENCES agencies(id) ON DELETE SET NULL,
  canonical_id TEXT,
  title TEXT,
  description TEXT,
  status TEXT DEFAULT 'active',
  listing_type TEXT,
  property_type TEXT,
  price NUMERIC,
  price_unit TEXT DEFAULT 'USD',
  bedrooms INTEGER,
  bathrooms NUMERIC,
  area NUMERIC,
  area_unit TEXT,
  city TEXT,
  neighborhood TEXT,
  location TEXT,
  latitude NUMERIC(10,8),
  longitude NUMERIC(11,8),
  territory_id TEXT REFERENCES territories(id) ON DELETE SET NULL,
  marketplace_syndicated BOOLEAN DEFAULT true,
  asset_version INTEGER DEFAULT 1,
  last_asset_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS property_media (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'image',
  url TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  is_hero BOOLEAN DEFAULT false,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS canonical_properties (
  id TEXT PRIMARY KEY,
  primary_listing_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  location TEXT,
  latitude NUMERIC(10,8),
  longitude NUMERIC(11,8),
  city TEXT,
  neighborhood TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  price NUMERIC,
  price_unit TEXT DEFAULT 'USD',
  source TEXT,
  recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS neighborhood_stats (
  id TEXT PRIMARY KEY,
  name TEXT,
  city TEXT,
  metric TEXT,
  value NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  contact_id TEXT,
  name TEXT,
  filters JSONB,
  alert_settings JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_properties_agent_id ON properties(agent_id);
CREATE INDEX IF NOT EXISTS idx_properties_agency_id ON properties(agency_id);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_city ON properties(city);
CREATE INDEX IF NOT EXISTS idx_properties_neighborhood ON properties(neighborhood);
CREATE INDEX IF NOT EXISTS idx_properties_listing_type ON properties(listing_type);
CREATE INDEX IF NOT EXISTS idx_properties_property_type ON properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_canonical_id ON properties(canonical_id);
CREATE INDEX IF NOT EXISTS idx_property_media_property_id ON property_media(property_id);
CREATE INDEX IF NOT EXISTS idx_price_history_property_id ON price_history(property_id);
