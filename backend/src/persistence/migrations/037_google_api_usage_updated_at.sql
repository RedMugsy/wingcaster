-- Phase 7b.1c/18 — Add updated_at to area_intelligence.google_api_usage_log
--
-- The Postgres adapter's `insert` and `update` helpers assume every mapped
-- table has both `created_at` and `updated_at` and will pass NULL for
-- missing timestamp columns via `EXCLUDED.updated_at` on ON-CONFLICT
-- upserts. The original 023 migration only shipped `created_at` for this
-- table; the mapper still lists `updated_at` in the columns list, so
-- inserts that hit the ON CONFLICT path attempted to set a column that
-- doesn't exist, silently masking real writes on retries.
--
-- Also aligns this table with every other in the module (all others
-- ship updated_at) so the observability-consistency reads clean.

ALTER TABLE area_intelligence.google_api_usage_log
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- Backfill NULLs so ORDER BY updated_at is meaningful.
UPDATE area_intelligence.google_api_usage_log
  SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
  WHERE updated_at IS NULL;
