-- The auth/recovery/notification code treats agent IDs as the principal user
-- identifier, but the initial Postgres migrations foreign-keyed these columns
-- to the users table. With SQLite this was a no-op; under Postgres it causes
-- FK violations. Drop the constraints so the app can run while a proper
-- users/agents unification is designed.

ALTER TABLE IF EXISTS auth_recovery_tokens
  DROP CONSTRAINT IF EXISTS auth_recovery_tokens_user_id_fkey;

ALTER TABLE IF EXISTS account_recovery_cases
  DROP CONSTRAINT IF EXISTS account_recovery_cases_user_id_fkey;

ALTER TABLE IF EXISTS consumer_notification_prefs
  DROP CONSTRAINT IF EXISTS consumer_notification_prefs_user_id_fkey;

ALTER TABLE IF EXISTS consumer_automation_checkpoints
  DROP CONSTRAINT IF EXISTS consumer_automation_checkpoints_user_id_fkey;
