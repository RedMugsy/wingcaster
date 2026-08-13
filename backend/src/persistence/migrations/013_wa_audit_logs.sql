-- WhatsApp Listings module audit log table (isolated schema)

CREATE TABLE IF NOT EXISTS wa_listings.audit_logs (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  agency_id TEXT,
  action TEXT,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_wa_audit_logs_agent_id ON wa_listings.audit_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_wa_audit_logs_created_at ON wa_listings.audit_logs(created_at);
