-- Phase 7b.1a — Convert commercial.usage_events to LIST-partitioned by
-- territory_id.
--
-- Rationale: usage_events is the highest-volume table in the system
-- (one row per meterable action across every tenant). Partitioning by
-- territory_id gives us:
--   - Per-country partitions with small, hot indexes.
--   - Instant DETACH when we need to move a country's data to a new
--     cell for data residency (Saudi, US, EU cell moves become one
--     ALTER TABLE + one physical file move).
--   - Backup/restore per country.
--   - Blast radius of a bad query is the partition, not the table.
--
-- Partitioning is set up with a DEFAULT partition today. Per-territory
-- partitions are created dynamically at territory creation time from
-- the application layer (backend/src/billing/pricing/territories.js
-- createTerritory + seedPricingHierarchy). Any event whose territory
-- isn't yet materialised as a partition lands in the default partition
-- and can be redistributed later with:
--   ALTER TABLE ... DETACH PARTITION ... FINALIZE;
--   INSERT INTO commercial.usage_events_<code> SELECT ... ;
--
-- IMPORTANT partitioning constraints:
--   - The partition key must be part of every unique constraint,
--     including the PRIMARY KEY. So the PK becomes (id, territory_id).
--   - No other tables reference usage_events.id, so this is safe.
--   - DEFAULT partition accepts NULL territory_id (rate-0 events with
--     no country context, e.g. webhook.received before tenant resolves).

-- ---------------------------------------------------------------------------
-- Step 1 — rename the existing table (and its indexes) out of the way.
-- Renaming a table in Postgres does NOT rename its indexes, so we have to
-- do it explicitly — otherwise the new partitioned table's CREATE INDEX
-- calls fail with "relation ... already exists".
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS commercial.usage_events RENAME TO usage_events_pre_partition;
ALTER INDEX IF EXISTS commercial.idx_usage_events_tenant_period
  RENAME TO idx_usage_events_tenant_period_pre_partition;
ALTER INDEX IF EXISTS commercial.idx_usage_events_action_period
  RENAME TO idx_usage_events_action_period_pre_partition;
ALTER INDEX IF EXISTS commercial.idx_usage_events_occurred
  RENAME TO idx_usage_events_occurred_pre_partition;
ALTER INDEX IF EXISTS commercial.idx_usage_events_listing
  RENAME TO idx_usage_events_listing_pre_partition;
ALTER INDEX IF EXISTS commercial.idx_usage_events_conversation
  RENAME TO idx_usage_events_conversation_pre_partition;

-- ---------------------------------------------------------------------------
-- Step 2 — create the partitioned table with (id, territory_id) as PK.
-- ---------------------------------------------------------------------------
CREATE TABLE commercial.usage_events (
  id TEXT NOT NULL,
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
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, territory_id)
) PARTITION BY LIST (territory_id);

CREATE INDEX idx_usage_events_tenant_period
  ON commercial.usage_events(tenant_id, billing_period, occurred_at DESC);
CREATE INDEX idx_usage_events_action_period
  ON commercial.usage_events(action_key, billing_period);
CREATE INDEX idx_usage_events_occurred
  ON commercial.usage_events(occurred_at DESC);
CREATE INDEX idx_usage_events_listing
  ON commercial.usage_events(listing_id)
  WHERE listing_id IS NOT NULL;
CREATE INDEX idx_usage_events_conversation
  ON commercial.usage_events(conversation_id)
  WHERE conversation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Step 3 — default partition catches events whose territory_id is NULL
-- or hasn't been materialised as a dedicated partition yet.
-- ---------------------------------------------------------------------------
CREATE TABLE commercial.usage_events_default
  PARTITION OF commercial.usage_events DEFAULT;

-- ---------------------------------------------------------------------------
-- Step 4 — copy pre-existing rows into the new partitioned table. All
-- previous rows go into the default partition because per-territory
-- partitions haven't been created yet (application layer creates them
-- at createTerritory() time on the next boot).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'commercial'
               AND table_name = 'usage_events_pre_partition') THEN
    EXECUTE $mig$
      INSERT INTO commercial.usage_events (
        id, tenant_id, subscription_id, action_key, quantity, channel,
        destination_country, whatsapp_category, listing_id,
        conversation_id, distribution_id, casts_charged, price_minor,
        cogs_estimate_minor, rate_card_version, cast_value_minor,
        territory_id, zone_id, metadata, billing_period, occurred_at,
        created_at, updated_at, data
      )
      SELECT
        id, tenant_id, subscription_id, action_key, quantity, channel,
        destination_country, whatsapp_category, listing_id,
        conversation_id, distribution_id, casts_charged, price_minor,
        cogs_estimate_minor, rate_card_version, cast_value_minor,
        territory_id, zone_id, metadata, billing_period, occurred_at,
        created_at, updated_at, data
      FROM commercial.usage_events_pre_partition
    $mig$;
    EXECUTE 'DROP TABLE commercial.usage_events_pre_partition';
  END IF;
END$$;
