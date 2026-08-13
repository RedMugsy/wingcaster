-- Fallback JSONB bucket for collections not yet promoted to dedicated tables.
-- Used by the table mapper for any collection name without an explicit mapping.

CREATE TABLE IF NOT EXISTS legacy_collections (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS idx_legacy_collections_collection ON legacy_collections(collection);
CREATE INDEX IF NOT EXISTS idx_legacy_collections_collection_created_at ON legacy_collections(collection, created_at);
CREATE INDEX IF NOT EXISTS idx_legacy_collections_collection_updated_at ON legacy_collections(collection, updated_at);
CREATE INDEX IF NOT EXISTS idx_legacy_collections_data_gin ON legacy_collections USING GIN (data);
