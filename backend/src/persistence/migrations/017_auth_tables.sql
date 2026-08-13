-- Auth / recovery / OTP tables

CREATE TABLE IF NOT EXISTS auth_recovery_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  type TEXT,
  token_hash TEXT,
  status TEXT DEFAULT 'pending',
  case_id TEXT,
  expires_at TIMESTAMPTZ,
  attempts INTEGER DEFAULT 0,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_auth_recovery_tokens_user_id ON auth_recovery_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_recovery_tokens_case_id ON auth_recovery_tokens(case_id);
CREATE INDEX IF NOT EXISTS idx_auth_recovery_tokens_email ON auth_recovery_tokens(email);

CREATE TABLE IF NOT EXISTS account_recovery_cases (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  status TEXT DEFAULT 'pending',
  requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_account_recovery_cases_user_id ON account_recovery_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_account_recovery_cases_email ON account_recovery_cases(email);

CREATE TABLE IF NOT EXISTS otp_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  channel TEXT,
  value_hash TEXT,
  code_hash TEXT,
  expires_at TIMESTAMPTZ,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_otp_verifications_user_id ON otp_verifications(user_id);
