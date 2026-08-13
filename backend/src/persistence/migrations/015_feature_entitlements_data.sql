-- Add data JSONB column to feature_entitlements so the generic document-style DAL
-- can store and retrieve full records.

ALTER TABLE feature_entitlements
  ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
