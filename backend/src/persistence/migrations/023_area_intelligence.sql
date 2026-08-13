-- Area Intelligence Engine (Souq Scores) module tables
-- Isolated under the area_intelligence schema for microservice portability.

CREATE SCHEMA IF NOT EXISTS area_intelligence;

-- Geographic regions
CREATE TABLE IF NOT EXISTS area_intelligence.area_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('city','village','neighborhood','territory')),
  parent_id TEXT REFERENCES area_intelligence.area_profiles(id) ON DELETE SET NULL,
  center_latitude NUMERIC(10,8) NOT NULL,
  center_longitude NUMERIC(11,8) NOT NULL,
  boundary_geojson JSONB,
  proximity_radii_json JSONB DEFAULT '{"local":3000,"secondary":5000,"macro":10000}'::jsonb,
  summary TEXT,
  summary_ar TEXT NOT NULL,
  lifestyle_profile TEXT,
  investment_outlook TEXT,
  activity_score NUMERIC(3,2),
  activity_trend TEXT CHECK (activity_trend IN ('rising','stable','declining')),
  family_profile_skew TEXT CHECK (family_profile_skew IN ('young_professionals','young_families','established_families','mixed','retiree_heavy')),
  estimated_population_density TEXT CHECK (estimated_population_density IN ('sparse','low','medium','high','dense')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','under_review','scoring_enabled','archived')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Configurable score dimensions
CREATE TABLE IF NOT EXISTS area_intelligence.score_dimensions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  description TEXT,
  slug TEXT UNIQUE NOT NULL,
  display_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  scoring_logic_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  composite_weight NUMERIC(4,3) DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Source type definitions
CREATE TABLE IF NOT EXISTS area_intelligence.source_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  archetype TEXT NOT NULL CHECK (archetype IN ('official_government','grassroots_community','commercial_business','news_media','cultural_organization','field_inspection','google_places')),
  platform TEXT,
  input_method TEXT NOT NULL,
  extraction_config JSONB DEFAULT '{}'::jsonb,
  default_reliability NUMERIC(3,2) DEFAULT 0.5,
  default_decay_days INTEGER DEFAULT 90,
  default_ai_prompt_template TEXT,
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Source instances per area
CREATE TABLE IF NOT EXISTS area_intelligence.area_sources (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES area_intelligence.area_profiles(id) ON DELETE CASCADE,
  source_type_id TEXT NOT NULL REFERENCES area_intelligence.source_types(id),
  name TEXT,
  handle TEXT,
  url TEXT,
  api_endpoint TEXT,
  feed_url TEXT,
  reliability_override NUMERIC(3,2),
  decay_days_override INTEGER,
  is_monitored BOOLEAN DEFAULT true,
  last_fetched_at TIMESTAMPTZ,
  auth_config JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Raw signals
CREATE TABLE IF NOT EXISTS area_intelligence.area_signals (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES area_intelligence.area_profiles(id) ON DELETE CASCADE,
  area_source_id TEXT REFERENCES area_intelligence.area_sources(id),
  source_type_id TEXT NOT NULL REFERENCES area_intelligence.source_types(id),
  signal_type TEXT NOT NULL,
  raw_content TEXT,
  raw_url TEXT,
  raw_media_urls JSONB,
  extracted_features JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'pending_extraction' CHECK (status IN ('pending_extraction','extracted','verified','rejected')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Score calculation audit trail
CREATE TABLE IF NOT EXISTS area_intelligence.area_score_calculations (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES area_intelligence.area_profiles(id) ON DELETE CASCADE,
  dimension_id TEXT NOT NULL REFERENCES area_intelligence.score_dimensions(id),
  calculation_method TEXT NOT NULL,
  input_signals JSONB,
  input_formula JSONB,
  score_value NUMERIC(5,2),
  score_rationale TEXT,
  confidence NUMERIC(3,2),
  is_manual_override BOOLEAN DEFAULT false,
  overridden_by TEXT,
  override_reason TEXT,
  calculated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- AI prompt configurations
CREATE TABLE IF NOT EXISTS area_intelligence.ai_scoring_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  temperature NUMERIC(3,2) DEFAULT 0.3,
  max_tokens INTEGER DEFAULT 2048,
  system_prompt TEXT NOT NULL,
  scoring_prompt_template TEXT NOT NULL,
  output_schema JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Raw Google data cache
CREATE TABLE IF NOT EXISTS area_intelligence.area_google_scores (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES area_intelligence.area_profiles(id) ON DELETE CASCADE,
  source_type_id TEXT NOT NULL REFERENCES area_intelligence.source_types(id),
  query_radius_meters INTEGER,
  query_category TEXT,
  results_count INTEGER,
  results_json JSONB,
  avg_rating NUMERIC(2,1),
  total_user_ratings INTEGER,
  nearest_distance_meters INTEGER,
  fetched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Inspector assignments (reuses agent role)
CREATE TABLE IF NOT EXISTS area_intelligence.inspector_assignments (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  area_id TEXT NOT NULL REFERENCES area_intelligence.area_profiles(id) ON DELETE CASCADE,
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(agent_id, area_id)
);

-- Inspection submissions
CREATE TABLE IF NOT EXISTS area_intelligence.inspection_submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES area_intelligence.inspector_assignments(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  area_id TEXT NOT NULL REFERENCES area_intelligence.area_profiles(id) ON DELETE CASCADE,
  gps_latitude NUMERIC(10,8) NOT NULL,
  gps_longitude NUMERIC(11,8) NOT NULL,
  photo_urls JSONB,
  dimension_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  status TEXT DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','rejected')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Google API usage/cost log
CREATE TABLE IF NOT EXISTS area_intelligence.google_api_usage_log (
  id TEXT PRIMARY KEY,
  area_id TEXT REFERENCES area_intelligence.area_profiles(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  endpoint TEXT,
  request_count INTEGER DEFAULT 1,
  cost_estimate_usd NUMERIC(10,6),
  response_status TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_area_profiles_level ON area_intelligence.area_profiles(level);
CREATE INDEX IF NOT EXISTS idx_area_profiles_parent ON area_intelligence.area_profiles(parent_id);
CREATE INDEX IF NOT EXISTS idx_area_profiles_slug ON area_intelligence.area_profiles(slug);
CREATE INDEX IF NOT EXISTS idx_area_profiles_status ON area_intelligence.area_profiles(status);
CREATE INDEX IF NOT EXISTS idx_score_dimensions_slug ON area_intelligence.score_dimensions(slug);
CREATE INDEX IF NOT EXISTS idx_score_dimensions_active ON area_intelligence.score_dimensions(is_active);
CREATE INDEX IF NOT EXISTS idx_source_types_slug ON area_intelligence.source_types(slug);
CREATE INDEX IF NOT EXISTS idx_source_types_active ON area_intelligence.source_types(is_active);
CREATE INDEX IF NOT EXISTS idx_area_sources_area ON area_intelligence.area_sources(area_id);
CREATE INDEX IF NOT EXISTS idx_area_signals_area ON area_intelligence.area_signals(area_id);
CREATE INDEX IF NOT EXISTS idx_area_signals_status ON area_intelligence.area_signals(status);
CREATE INDEX IF NOT EXISTS idx_area_score_area_dimension ON area_intelligence.area_score_calculations(area_id, dimension_id);
CREATE INDEX IF NOT EXISTS idx_area_score_calculated ON area_intelligence.area_score_calculations(calculated_at);
CREATE INDEX IF NOT EXISTS idx_area_google_scores_area ON area_intelligence.area_google_scores(area_id);
CREATE INDEX IF NOT EXISTS idx_area_google_scores_type ON area_intelligence.area_google_scores(source_type_id);
CREATE INDEX IF NOT EXISTS idx_inspector_assignments_agent ON area_intelligence.inspector_assignments(agent_id);
CREATE INDEX IF NOT EXISTS idx_inspector_assignments_area ON area_intelligence.inspector_assignments(area_id);
CREATE INDEX IF NOT EXISTS idx_inspection_submissions_area ON area_intelligence.inspection_submissions(area_id);
CREATE INDEX IF NOT EXISTS idx_google_api_usage_area ON area_intelligence.google_api_usage_log(area_id);
CREATE INDEX IF NOT EXISTS idx_google_api_usage_created ON area_intelligence.google_api_usage_log(created_at);
