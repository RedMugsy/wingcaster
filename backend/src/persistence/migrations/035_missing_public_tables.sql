-- Phase 7b.1c/14 — CREATE TABLE for four public.* tables that the
-- collection→table mapper referenced but no migration had created.
-- Writes to these collections have been silently landing in
-- public.legacy_collections since project inception, invisible to any
-- feature that reads them by structured column.
--
-- Tables added:
--   public.profile_views    — profile page + listing view telemetry
--   public.profile_followers — follow/unfollow state per (follower, entity)
--   public.reviews          — agent reviews (rating + comment)
--   public.transactions     — agent-recorded closed transactions

CREATE TABLE IF NOT EXISTS public.profile_views (
  id TEXT PRIMARY KEY,
  viewer_id TEXT,
  viewed_id TEXT,
  entity_type VARCHAR(40),
  entity_id TEXT,
  channel VARCHAR(60),
  device VARCHAR(60),
  geo_city VARCHAR(120),
  geo_country VARCHAR(120),
  geo_region VARCHAR(120),
  referrer VARCHAR(200),
  viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_profile_views_entity
  ON public.profile_views(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_views_viewed
  ON public.profile_views(viewed_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.profile_followers (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL,
  following_id TEXT,
  entity_type VARCHAR(40),
  entity_id TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'unfollowed', 'blocked')),
  followed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_profile_followers_entity
  ON public.profile_followers(entity_type, entity_id, status);
CREATE INDEX IF NOT EXISTS idx_profile_followers_follower
  ON public.profile_followers(follower_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_followers_edge
  ON public.profile_followers(follower_id, entity_type, entity_id)
  WHERE entity_type IS NOT NULL AND entity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.reviews (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  author_id TEXT,
  rating NUMERIC(3, 2) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  comment TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'hidden', 'flagged', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_reviews_agent
  ON public.reviews(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_status
  ON public.reviews(status);

CREATE TABLE IF NOT EXISTS public.transactions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  property_id TEXT,
  type VARCHAR(30),
  amount NUMERIC(15, 2),
  currency VARCHAR(10),
  status VARCHAR(30) NOT NULL DEFAULT 'closed',
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_transactions_agent
  ON public.transactions(agent_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_property
  ON public.transactions(property_id);
