ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

UPDATE users u
SET verified = true,
    verified_at = COALESCE(u.verified_at, u.created_at, CURRENT_TIMESTAMP),
    data = jsonb_set(
      jsonb_set(COALESCE(u.data, '{}'::jsonb), '{verified}', 'true'::jsonb, true),
      '{verified_at}',
      to_jsonb(COALESCE(u.verified_at, u.created_at, CURRENT_TIMESTAMP)),
      true
    )
FROM agents a
WHERE a.user_id = u.id
  AND a.verified = true
  AND u.verified = false;

ALTER TABLE otp_verifications
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
