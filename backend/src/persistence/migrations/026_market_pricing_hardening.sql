-- Market Pricing Intelligence Engine hardening
-- Adds auditable evidence snapshots, safe cache identity, external-comparable
-- integrity, and persistent recalculation jobs.

-- ---------------------------------------------------------------------------
-- Analysis correctness and provenance
-- ---------------------------------------------------------------------------
ALTER TABLE market_pricing.property_price_analyses
  DROP CONSTRAINT IF EXISTS property_price_analyses_lowest_price_property_id_fkey,
  DROP CONSTRAINT IF EXISTS property_price_analyses_highest_price_property_id_fkey,
  DROP CONSTRAINT IF EXISTS property_price_analyses_property_id_match_config_id_key;

ALTER TABLE market_pricing.property_price_analyses
  ADD COLUMN IF NOT EXISTS lowest_price_comparable_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS highest_price_comparable_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS target_price NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS analysis_inputs_hash TEXT,
  ADD COLUMN IF NOT EXISTS rate_source VARCHAR(100),
  ADD COLUMN IF NOT EXISTS rate_effective_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rate_is_stale BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rate_age_hours NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS latest_run_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_property_price_analyses_cache_identity
  ON market_pricing.property_price_analyses(property_id, COALESCE(match_config_id, '__default__'));

ALTER TABLE market_pricing.comparable_reports
  DROP CONSTRAINT IF EXISTS comparable_reports_comparable_type_check;
ALTER TABLE market_pricing.comparable_reports
  ADD CONSTRAINT comparable_reports_comparable_type_check
  CHECK (comparable_type IN ('internal','external','agent_report'));

ALTER TABLE market_pricing.price_trend_snapshots
  ADD COLUMN IF NOT EXISTS change_24_month_percent NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS trend_direction VARCHAR(20),
  ADD COLUMN IF NOT EXISTS volatility_percent NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS confidence VARCHAR(20),
  ADD COLUMN IF NOT EXISTS confidence_reason TEXT;

CREATE TABLE IF NOT EXISTS market_pricing.analysis_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  analysis_id TEXT NOT NULL REFERENCES market_pricing.property_price_analyses(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  match_config_id TEXT REFERENCES market_pricing.pricing_match_configs(id),
  analysis_inputs_hash TEXT NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_analysis
  ON market_pricing.analysis_runs(analysis_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_property
  ON market_pricing.analysis_runs(property_id, calculated_at DESC);

CREATE TABLE IF NOT EXISTS market_pricing.analysis_comparable_evidence (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  analysis_run_id TEXT NOT NULL REFERENCES market_pricing.analysis_runs(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  comparable_type VARCHAR(20) NOT NULL CHECK (comparable_type IN ('internal','external','agent_report')),
  comparable_id TEXT NOT NULL,
  source VARCHAR(100) NOT NULL,
  source_label TEXT,
  original_price NUMERIC(15,2),
  original_currency VARCHAR(10),
  normalized_price NUMERIC(15,2) NOT NULL,
  normalization_rate NUMERIC(15,6),
  rate_source VARCHAR(100),
  rate_effective_at TIMESTAMPTZ,
  rate_is_stale BOOLEAN NOT NULL DEFAULT false,
  similarity_score NUMERIC(10,6),
  time_weight NUMERIC(10,6),
  weight NUMERIC(10,6) NOT NULL,
  listed_at TIMESTAMPTZ,
  area_sqm NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(analysis_run_id, comparable_type, comparable_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_evidence_analysis
  ON market_pricing.analysis_comparable_evidence(analysis_run_id, weight DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_evidence_comparable
  ON market_pricing.analysis_comparable_evidence(comparable_type, comparable_id);

CREATE TABLE IF NOT EXISTS market_pricing.pricing_decisions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  property_id TEXT NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES public.users(id),
  analysis_id TEXT REFERENCES market_pricing.property_price_analyses(id) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('web','whatsapp','api')),
  action VARCHAR(20) NOT NULL CHECK (action IN ('keep_price','adjust_price')),
  old_price NUMERIC(15,2),
  new_price NUMERIC(15,2),
  currency VARCHAR(10),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pricing_decisions_property
  ON market_pricing.pricing_decisions(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_decisions_actor
  ON market_pricing.pricing_decisions(actor_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- External comparable identity and spatial integrity
-- ---------------------------------------------------------------------------
ALTER TABLE market_pricing.external_comparables
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

UPDATE market_pricing.external_comparables
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE geom IS NULL AND longitude IS NOT NULL AND latitude IS NOT NULL;

CREATE OR REPLACE FUNCTION market_pricing.sync_external_comparable_geom()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.geom := CASE
    WHEN NEW.longitude IS NOT NULL AND NEW.latitude IS NOT NULL
      THEN ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)
    ELSE NULL
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_comparable_geom ON market_pricing.external_comparables;
CREATE TRIGGER trg_external_comparable_geom
BEFORE INSERT OR UPDATE OF longitude, latitude
ON market_pricing.external_comparables
FOR EACH ROW EXECUTE FUNCTION market_pricing.sync_external_comparable_geom();

CREATE UNIQUE INDEX IF NOT EXISTS uq_external_comparables_source_external_id
  ON market_pricing.external_comparables(source, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_external_comparables_source_content_hash
  ON market_pricing.external_comparables(source, content_hash)
  WHERE external_id IS NULL AND content_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Persistent, restart-safe recalculation jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_pricing.recalculation_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  requested_by TEXT REFERENCES public.users(id),
  scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('property','area','all')),
  scope_property_id TEXT REFERENCES public.properties(id) ON DELETE SET NULL,
  scope_area_id TEXT REFERENCES area_intelligence.area_profiles(id) ON DELETE SET NULL,
  scope_property_type VARCHAR(100),
  force_recompute BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(30) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','completed_with_errors','failed','cancelled')),
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  succeeded_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS market_pricing.recalculation_job_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_id TEXT NOT NULL REFERENCES market_pricing.recalculation_jobs(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(job_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_recalculation_jobs_runnable
  ON market_pricing.recalculation_jobs(status, next_retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_recalculation_job_items_runnable
  ON market_pricing.recalculation_job_items(job_id, status, next_retry_at, created_at);
