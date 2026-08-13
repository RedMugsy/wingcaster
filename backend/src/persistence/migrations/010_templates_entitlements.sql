-- Message templates, entitlements, and AI credits

CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  owner_type TEXT DEFAULT 'agent',
  owner_id TEXT,
  name TEXT NOT NULL,
  channel TEXT,
  category TEXT,
  subject TEXT,
  body TEXT,
  variables JSONB,
  language TEXT DEFAULT 'en',
  approval_status TEXT DEFAULT 'approved',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS feature_entitlements (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('agent','agency','platform')),
  scope_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  enabled BOOLEAN DEFAULT false,
  config JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope, scope_id, feature)
);

CREATE TABLE IF NOT EXISTS ai_credit_balances (
  scope TEXT NOT NULL CHECK (scope IN ('agent','agency')),
  scope_id TEXT NOT NULL,
  credits_remaining NUMERIC(12,6) DEFAULT 0,
  credits_reserved NUMERIC(12,6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (scope, scope_id)
);

CREATE TABLE IF NOT EXISTS ai_credit_transactions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('agent','agency')),
  scope_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('top_up','consumption','refund','adjustment')),
  amount NUMERIC(12,6),
  description TEXT,
  related_draft_id TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_message_templates_owner ON message_templates(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_is_default ON message_templates(is_default);
CREATE INDEX IF NOT EXISTS idx_feature_entitlements_scope ON feature_entitlements(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_feature_entitlements_feature ON feature_entitlements(feature);
CREATE INDEX IF NOT EXISTS idx_ai_credit_transactions_scope ON ai_credit_transactions(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_ai_credit_transactions_draft ON ai_credit_transactions(related_draft_id);
