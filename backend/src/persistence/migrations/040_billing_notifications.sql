-- Phase 7c/6a — Billing notification engine schema.
--
-- Three tables:
--
--   commercial.notification_events
--     Immutable log of every notification-worthy business event that
--     fires (e.g. a subscription cancels, a trial is ending). One row
--     per event, regardless of how many channels the tenant is opted
--     into. The dispatcher writes this before attempting delivery.
--
--   commercial.notification_deliveries
--     Per-event, per-channel delivery attempt. One row per (event,
--     channel) — success, failure, or skipped-by-preference. The
--     admin observability view + retry surface both read from here.
--
--   commercial.notification_preferences
--     Per-tenant opt-in/out per (event_kind, channel). Absent rows
--     mean opted IN (opt-out model — the default is to notify).
--
-- All three tables are append-only from the outside. Deliveries can
-- transition status once (pending -> sent | failed | skipped) via
-- the deliveries module; nothing else touches them.

-- ---------------------------------------------------------------------------
-- notification_events — the canonical event log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commercial.notification_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_kind VARCHAR(80) NOT NULL,
  tenant_id TEXT NOT NULL,
  subscription_id TEXT REFERENCES commercial.billing_subscriptions(id) ON DELETE SET NULL,
  subject TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_notification_events_tenant
  ON commercial.notification_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_events_kind_created
  ON commercial.notification_events(event_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_events_subscription
  ON commercial.notification_events(subscription_id, created_at DESC)
  WHERE subscription_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- notification_deliveries — per-event, per-channel attempt log.
--
-- status transitions: pending -> (sent | failed | skipped)
--
-- 'skipped' captures the "tenant opted out" case so we retain a
-- complete audit that the event fired even when no message went out.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commercial.notification_deliveries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id TEXT NOT NULL REFERENCES commercial.notification_events(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL
    CHECK (channel IN ('email','sms','whatsapp','in_app')),
  destination TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','skipped')),
  skip_reason TEXT,
  provider TEXT,
  provider_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  attempted_at TIMESTAMPTZ,
  succeeded_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_event
  ON commercial.notification_deliveries(event_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status
  ON commercial.notification_deliveries(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_channel_status
  ON commercial.notification_deliveries(channel, status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- notification_preferences — per-tenant opt-out.
--
-- Absent row = opted IN (default is to notify). Insert a row with
-- enabled=false to opt out. This shape lets us add new event kinds
-- without a migration and without silently muting existing tenants.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commercial.notification_preferences (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  event_kind VARCHAR(80) NOT NULL,
  channel VARCHAR(20) NOT NULL
    CHECK (channel IN ('email','sms','whatsapp','in_app')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(tenant_id, event_kind, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_prefs_tenant
  ON commercial.notification_preferences(tenant_id);
