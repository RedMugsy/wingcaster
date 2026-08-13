-- Canonical user principals and notification preference compaction.
--
-- Existing JWT subject IDs are preserved by using a shared primary-key model:
-- users.id = agents.id and agents.user_id = users.id. This lets users become
-- authoritative for authentication while agent-owned domain records retain
-- their stable IDs.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM agents a
    JOIN users u ON lower(u.email) = lower(a.email)
    WHERE u.id <> a.id
  ) THEN
    RAISE EXCEPTION 'Cannot canonicalize users: an agent email belongs to a different user id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM agents
    WHERE user_id IS NOT NULL AND user_id <> id
  ) THEN
    RAISE EXCEPTION 'Cannot canonicalize users: agents.user_id differs from the shared principal id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM agency_members
    WHERE user_id IS NOT NULL
      AND agent_id IS NOT NULL
      AND user_id <> agent_id
  ) THEN
    RAISE EXCEPTION 'Cannot canonicalize users: agency membership has mismatched user and agent owners';
  END IF;
END
$$;

INSERT INTO users (
  id,
  email,
  phone,
  name,
  password_hash,
  role,
  created_at,
  updated_at,
  data
)
SELECT
  a.id,
  a.email,
  a.phone,
  a.name,
  a.data->>'password_hash',
  COALESCE(a.role, a.data->>'role', 'agent'),
  COALESCE(a.created_at, CURRENT_TIMESTAMP),
  COALESCE(a.updated_at, a.created_at, CURRENT_TIMESTAMP),
  jsonb_strip_nulls(jsonb_build_object(
    'id', a.id,
    'email', a.email,
    'phone', a.phone,
    'name', a.name,
    'password_hash', a.data->>'password_hash',
    'role', COALESCE(a.role, a.data->>'role', 'agent'),
    'token_version', COALESCE(a.data->'token_version', '0'::jsonb),
    'password_changed_at', a.data->'password_changed_at',
    'compromised_session_reset_at', a.data->'compromised_session_reset_at',
    'created_at', to_jsonb(COALESCE(a.created_at, CURRENT_TIMESTAMP)),
    'updated_at', to_jsonb(COALESCE(a.updated_at, a.created_at, CURRENT_TIMESTAMP))
  ))
FROM agents a
ON CONFLICT (id) DO UPDATE SET
  phone = COALESCE(users.phone, EXCLUDED.phone),
  name = COALESCE(users.name, EXCLUDED.name),
  -- Before this cutover the running application authenticated and authorized
  -- from agents, so the agent copy is authoritative for credential/session
  -- state. Existing users metadata remains authoritative for non-auth fields.
  password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
  role = EXCLUDED.role,
  updated_at = GREATEST(users.updated_at, EXCLUDED.updated_at),
  data = (EXCLUDED.data || users.data) || jsonb_strip_nulls(jsonb_build_object(
    'password_hash', COALESCE(EXCLUDED.password_hash, users.password_hash),
    'role', EXCLUDED.role,
    'token_version', COALESCE(EXCLUDED.data->'token_version', users.data->'token_version', '0'::jsonb),
    'password_changed_at', COALESCE(EXCLUDED.data->'password_changed_at', users.data->'password_changed_at'),
    'compromised_session_reset_at', COALESCE(
      EXCLUDED.data->'compromised_session_reset_at',
      users.data->'compromised_session_reset_at'
    )
  ));

UPDATE agents
SET
  user_id = id,
  data = COALESCE(data, '{}'::jsonb)
    - 'password_hash'
    - 'token_version'
    - 'password_changed_at'
    - 'compromised_session_reset_at'
WHERE user_id IS DISTINCT FROM id;

-- Remove duplicated credential/session fields even from profiles that were
-- already linked before this migration.
UPDATE agents
SET data = COALESCE(data, '{}'::jsonb)
  - 'password_hash'
  - 'token_version'
  - 'password_changed_at'
  - 'compromised_session_reset_at'
WHERE data ?| ARRAY[
  'password_hash',
  'token_version',
  'password_changed_at',
  'compromised_session_reset_at'
];

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM agents WHERE user_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot canonicalize users: agent has no linked user principal';
  END IF;
END
$$;

UPDATE agency_members
SET
  user_id = agent_id,
  data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('user_id', agent_id)
WHERE user_id IS NULL
  AND agent_id IS NOT NULL;

ALTER TABLE agents
  ALTER COLUMN user_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_user_id
  ON agents(user_id);

-- Restore foreign keys that were temporarily removed while the application was
-- agent-first. All referenced IDs are now backed by canonical users.
ALTER TABLE agents
  DROP CONSTRAINT IF EXISTS agents_user_id_fkey;
ALTER TABLE agents
  ADD CONSTRAINT agents_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE agencies
  DROP CONSTRAINT IF EXISTS agencies_owner_id_fkey;
ALTER TABLE agencies
  ADD CONSTRAINT agencies_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE agency_members
  DROP CONSTRAINT IF EXISTS agency_members_user_id_fkey;
ALTER TABLE agency_members
  ADD CONSTRAINT agency_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE auth_recovery_tokens
  DROP CONSTRAINT IF EXISTS auth_recovery_tokens_user_id_fkey;
ALTER TABLE auth_recovery_tokens
  ADD CONSTRAINT auth_recovery_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE account_recovery_cases
  DROP CONSTRAINT IF EXISTS account_recovery_cases_user_id_fkey;
ALTER TABLE account_recovery_cases
  ADD CONSTRAINT account_recovery_cases_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE consumer_notifications
  DROP CONSTRAINT IF EXISTS consumer_notifications_user_id_fkey;
ALTER TABLE consumer_notifications
  ADD CONSTRAINT consumer_notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE consumer_automation_checkpoints
  DROP CONSTRAINT IF EXISTS consumer_automation_checkpoints_user_id_fkey;
ALTER TABLE consumer_automation_checkpoints
  ADD CONSTRAINT consumer_automation_checkpoints_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE otp_verifications
  DROP CONSTRAINT IF EXISTS otp_verifications_user_id_fkey;
ALTER TABLE otp_verifications
  ADD CONSTRAINT otp_verifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Refuse lossy preference cleanup. The production audit found no conflicts,
-- but this guard keeps every future environment fail-closed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM consumer_notification_prefs
    WHERE user_id IS NULL AND agent_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot compact notification preferences: row has no owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM consumer_notification_prefs
    WHERE user_id IS NOT NULL
      AND agent_id IS NOT NULL
      AND user_id <> agent_id
  ) THEN
    RAISE EXCEPTION 'Cannot compact notification preferences: row has mismatched user and agent owners';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM consumer_notification_prefs
    WHERE data ? 'events'
      AND event_toggles IS NOT NULL
      AND data->'events' IS DISTINCT FROM event_toggles
  ) THEN
    RAISE EXCEPTION 'Cannot compact notification preferences: legacy and typed event settings conflict';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM consumer_notification_prefs p
    LEFT JOIN users u ON u.id = COALESCE(p.user_id, p.agent_id)
    WHERE u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot compact notification preferences: owner has no canonical user';
  END IF;

  IF EXISTS (
    SELECT COALESCE(user_id, agent_id) AS owner_id
    FROM consumer_notification_prefs
    GROUP BY COALESCE(user_id, agent_id)
    HAVING count(DISTINCT jsonb_build_array(
      COALESCE(channels, '{}'::jsonb),
      COALESCE(data->'events', event_toggles, '{}'::jsonb),
      COALESCE(quiet_hours, '{}'::jsonb)
    )) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot compact notification preferences: owner has conflicting payloads';
  END IF;
END
$$;

-- Keep an API-authored user row when one exists; otherwise keep the oldest
-- identical seed row. The conflict guard above guarantees this is lossless.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY COALESCE(user_id, agent_id)
      ORDER BY (user_id IS NOT NULL) DESC, created_at ASC NULLS LAST, id ASC
    ) AS owner_rank
  FROM consumer_notification_prefs
)
DELETE FROM consumer_notification_prefs p
USING ranked r
WHERE p.id = r.id
  AND r.owner_rank > 1;

UPDATE consumer_notification_prefs
SET
  user_id = COALESCE(user_id, agent_id),
  agent_id = NULL,
  event_toggles = COALESCE(data->'events', event_toggles, '{}'::jsonb),
  data = jsonb_set(
    (COALESCE(data, '{}'::jsonb) - 'agent_id')
      || jsonb_build_object('user_id', COALESCE(user_id, agent_id)),
    '{events}',
    COALESCE(data->'events', event_toggles, '{}'::jsonb),
    true
  ),
  updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP);

ALTER TABLE consumer_notification_prefs
  DROP CONSTRAINT IF EXISTS consumer_notification_prefs_user_id_fkey;
ALTER TABLE consumer_notification_prefs
  ADD CONSTRAINT consumer_notification_prefs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_consumer_notification_prefs_user_id
  ON consumer_notification_prefs(user_id)
  WHERE user_id IS NOT NULL;
