-- WhatsApp Listings module isolated schema

CREATE SCHEMA IF NOT EXISTS wa_listings;

CREATE TABLE IF NOT EXISTS wa_listings.sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  agency_id TEXT,
  phone_number TEXT NOT NULL,
  state TEXT DEFAULT 'idle',
  intent TEXT DEFAULT 'create',
  matched_listing_id TEXT,
  messages JSONB,
  media JSONB,
  location_pins JSONB,
  location_source TEXT DEFAULT 'unknown',
  address_description TEXT,
  extracted_property JSONB,
  selected_variant TEXT,
  generated_thumbnails JSONB,
  generated_captions JSONB,
  draft_id TEXT,
  retry_count INTEGER DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS wa_listings.processed_messages (
  id TEXT PRIMARY KEY,
  message_id TEXT UNIQUE NOT NULL,
  from_number TEXT,
  processed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS wa_listings.drafts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  agent_id TEXT,
  agency_id TEXT,
  intent TEXT DEFAULT 'create',
  update_of TEXT,
  extracted_property JSONB,
  change_summary JSONB,
  thumbnails JSONB,
  captions JSONB,
  location_pin_latitude NUMERIC(10,8),
  location_pin_longitude NUMERIC(11,8),
  location_pin_name TEXT,
  location_source TEXT DEFAULT 'unknown',
  address_description TEXT,
  status TEXT DEFAULT 'intake',
  credits_reserved NUMERIC(12,6) DEFAULT 0,
  credit_scope TEXT,
  credit_scope_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS wa_listings.media (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  draft_id TEXT,
  agent_id TEXT,
  url TEXT,
  mime_type TEXT,
  caption TEXT,
  file_size INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS wa_listings.dead_letters (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  draft_id TEXT,
  stage TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS wa_listings.ai_usage_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  draft_id TEXT,
  agent_id TEXT,
  provider TEXT,
  operation TEXT,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost NUMERIC(12,6),
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_wa_sessions_agent_id ON wa_listings.sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_wa_sessions_phone_number ON wa_listings.sessions(phone_number);
CREATE INDEX IF NOT EXISTS idx_wa_processed_messages_message_id ON wa_listings.processed_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_wa_drafts_session_id ON wa_listings.drafts(session_id);
CREATE INDEX IF NOT EXISTS idx_wa_drafts_agent_id ON wa_listings.drafts(agent_id);
CREATE INDEX IF NOT EXISTS idx_wa_media_session_id ON wa_listings.media(session_id);
