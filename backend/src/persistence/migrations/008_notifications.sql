-- Notifications / automation domain tables

CREATE TABLE IF NOT EXISTS consumer_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  type TEXT,
  title TEXT,
  body TEXT,
  read BOOLEAN DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS consumer_notification_prefs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  channels JSONB,
  event_toggles JSONB,
  quiet_hours JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS consumer_notification_retries (
  id TEXT PRIMARY KEY,
  notification_id TEXT REFERENCES consumer_notifications(id) ON DELETE SET NULL,
  channel TEXT,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS consumer_automation_checkpoints (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  checkpoint_type TEXT,
  last_evaluated_at TIMESTAMPTZ,
  cursor TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_consumer_notifications_user_id ON consumer_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_consumer_notifications_agent_id ON consumer_notifications(agent_id);
CREATE INDEX IF NOT EXISTS idx_consumer_notification_prefs_user_id ON consumer_notification_prefs(user_id);
CREATE INDEX IF NOT EXISTS idx_consumer_notification_retries_notification_id ON consumer_notification_retries(notification_id);
CREATE INDEX IF NOT EXISTS idx_consumer_automation_checkpoints_agent_id ON consumer_automation_checkpoints(agent_id);
