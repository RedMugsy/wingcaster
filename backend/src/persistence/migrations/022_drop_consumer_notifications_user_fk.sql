-- Safety migration: remove legacy users FK for runtime writes that use
-- agent-first identity semantics in consumer notifications.

ALTER TABLE IF EXISTS consumer_notifications
  DROP CONSTRAINT IF EXISTS consumer_notifications_user_id_fkey;
