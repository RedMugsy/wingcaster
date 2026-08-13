-- Safety migration: ensure legacy user_id FK does not block runtime writes
-- when automation checkpoints are authored with agent-first identity.

ALTER TABLE IF EXISTS consumer_automation_checkpoints
  DROP CONSTRAINT IF EXISTS consumer_automation_checkpoints_user_id_fkey;
