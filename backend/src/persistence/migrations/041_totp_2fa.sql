-- Phase 7f/1 — TOTP + step-up authentication.
--
-- Adds authenticator-app (TOTP) enrolment to `users`, a single-use backup-code
-- table for the lost-phone path, and a challenge table backing both the
-- sign-in second factor and the step-up (re-authentication) flow.
--
-- Design notes that are NOT obvious from the DDL:
--
--   * `totp_secret_encrypted` holds an AES-256-GCM ciphertext produced by
--     lib/credentials.js (format `v1:<iv>:<tag>:<ct>`), never a raw base32
--     secret. The plaintext secret leaves the server exactly once, in the
--     enrolment `setup` response, and is never readable again afterwards.
--
--   * `totp_last_time_step` is RFC 6238 replay protection. otplib returns the
--     matched time step on every successful verification; we persist it and
--     refuse any later token whose step is <= the stored value. Without this a
--     shoulder-surfed code stays usable for the rest of its window plus the
--     drift tolerance.
--
--   * `auth_challenges` is deliberately separate from `otp_verifications`.
--     That table means "prove you own this email address" (signup) and its
--     `code_hash` is always populated. A TOTP challenge has no server-side
--     code at all — the code lives in the user's phone — so `code_hash` here
--     is nullable, and conflating the two would make both tables' invariants
--     unreadable.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS totp_last_time_step BIGINT,
  ADD COLUMN IF NOT EXISTS preferred_2fa TEXT NOT NULL DEFAULT 'email';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_preferred_2fa_check;
ALTER TABLE users
  ADD CONSTRAINT users_preferred_2fa_check CHECK (preferred_2fa IN ('email', 'totp'));

-- Mirror the new typed columns into the `data` JSONB document so rows written
-- before this migration hydrate consistently through the DAL (fromRow spreads
-- `data` first, then typed columns, so this is belt-and-braces for any code
-- path reading straight out of the document).
UPDATE users
SET data = jsonb_set(
             jsonb_set(COALESCE(data, '{}'::jsonb), '{totp_enabled}', 'false'::jsonb, true),
             '{preferred_2fa}', '"email"'::jsonb, true
           )
WHERE NOT (data ? 'totp_enabled') OR NOT (data ? 'preferred_2fa');

-- ---------------------------------------------------------------------------
-- Backup codes — single-use recovery when the authenticator device is lost.
-- ---------------------------------------------------------------------------
-- Ten codes are minted at enrolment and shown to the user exactly once. Only
-- bcrypt hashes are stored, so redemption compares the submitted code against
-- every *unused* code for that user. Codes carry ~50 bits of entropy, which is
-- what makes that scan safe: there is no plaintext lookup key to index on, and
-- adding one would leak part of the secret at rest.
CREATE TABLE IF NOT EXISTS user_backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_user_backup_codes_user_id ON user_backup_codes(user_id);
-- Redemption only ever scans unused codes; keep that scan off the used ones.
CREATE INDEX IF NOT EXISTS idx_user_backup_codes_unused
  ON user_backup_codes(user_id) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- Challenges — pending second factor for sign-in, and for step-up elevation.
-- ---------------------------------------------------------------------------
-- purpose: 'signin' issues a session JWT on success; 'stepup' issues a
--          short-lived elevation token and leaves the session untouched.
-- method:  'totp'        — verified against the user's stored secret, code_hash NULL
--          'email'       — verified against code_hash (server-generated OTP)
--          'backup_code' — recorded when a signin challenge is redeemed with a
--                          backup code rather than the expected TOTP token
CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  method TEXT NOT NULL,
  code_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  created_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE auth_challenges
  DROP CONSTRAINT IF EXISTS auth_challenges_purpose_check;
ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_purpose_check CHECK (purpose IN ('signin', 'stepup'));

ALTER TABLE auth_challenges
  DROP CONSTRAINT IF EXISTS auth_challenges_method_check;
ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_method_check CHECK (method IN ('totp', 'email', 'backup_code'));

-- An email challenge without a code is unverifiable; a TOTP challenge with one
-- implies a server-side secret that should not exist. Enforce both in the DB
-- rather than trusting every future write path to get it right.
ALTER TABLE auth_challenges
  DROP CONSTRAINT IF EXISTS auth_challenges_code_hash_check;
ALTER TABLE auth_challenges
  ADD CONSTRAINT auth_challenges_code_hash_check CHECK (
    (method = 'email' AND code_hash IS NOT NULL)
    OR (method <> 'email' AND code_hash IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_auth_challenges_user_id ON auth_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires_at ON auth_challenges(expires_at);
