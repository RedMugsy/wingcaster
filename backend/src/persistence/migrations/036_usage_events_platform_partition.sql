-- Phase 7b.1c/15 — fix usage_events partition key contradiction.
--
-- Migration 031 declared PRIMARY KEY (id, territory_id), which makes
-- territory_id implicitly NOT NULL. It also claimed the DEFAULT
-- partition catches events with NULL territory_id. Both cannot be
-- true. In practice, rate-0 platform-scoped events
-- (webhook.received, ai.description.failed with no country context)
-- fail to insert with 23502 not-null violation.
--
-- This migration adds:
--   * A DEFAULT value of '__platform__' on territory_id so writers
--     that omit the column get a valid value.
--   * A named partition commercial.usage_events_platform bound to
--     '__platform__' so platform-scoped events land in their own
--     partition, cleanly separable from tenant traffic.
--   * A one-time backfill for any pre-existing rows that somehow
--     have territory_id IS NULL (defensive — should be zero rows
--     since NULL insert would have failed already).
--
-- Application-layer counterpart (backend/src/billing/events.js) now
-- writes '__platform__' explicitly when no market context is
-- resolvable. The DEFAULT is belt-and-braces for any future code
-- path that omits the column.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'commercial'
               AND table_name = 'usage_events') THEN
    ALTER TABLE commercial.usage_events
      ALTER COLUMN territory_id SET DEFAULT '__platform__';
  END IF;
END$$;

-- Defensive backfill: any row that lived in the default partition
-- with NULL territory_id (shouldn't exist but proves the point).
UPDATE commercial.usage_events
SET territory_id = '__platform__'
WHERE territory_id IS NULL;

-- Named partition for platform-scoped events. IF NOT EXISTS on
-- partitions is Postgres 15+; use DO block for portability.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'commercial'
                   AND table_name = 'usage_events_platform') THEN
    EXECUTE 'CREATE TABLE commercial.usage_events_platform '
         || 'PARTITION OF commercial.usage_events '
         || 'FOR VALUES IN (''__platform__'')';
  END IF;
END$$;
