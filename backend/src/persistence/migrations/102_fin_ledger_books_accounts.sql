-- Stage 1 — ledger books + 7 account types (A §4.1–4.2).

CREATE TABLE fin.ledger_books (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  tenant_id UUID NOT NULL REFERENCES fin.tenants(id),
  billing_account_id UUID NOT NULL REFERENCES fin.billing_accounts(id),
  book_type TEXT NOT NULL CHECK (book_type IN (
    'CUSTOMER', 'RESELLER', 'PLATFORM', 'CLEARING', 'PROMOTIONAL'
  )),
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (environment, billing_account_id, book_type)
);

CREATE TRIGGER trg_ledger_books_bump_version
  BEFORE UPDATE ON fin.ledger_books
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

CREATE TRIGGER trg_ledger_books_env_tenant
  BEFORE INSERT OR UPDATE ON fin.ledger_books
  FOR EACH ROW EXECUTE FUNCTION fin.trg_env_matches_tenant();

CREATE TABLE fin.ledger_accounts (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  book_id UUID NOT NULL REFERENCES fin.ledger_books(id),
  account_type TEXT NOT NULL CHECK (account_type IN (
    'AVAILABLE', 'HELD', 'ISSUANCE', 'CONSUMED', 'EXPIRED', 'ADJUSTMENT', 'CLEARING'
  )),
  created_at TIMESTAMPTZ NOT NULL,
  created_by_actor_type TEXT,
  created_by_actor_id UUID,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by_actor_type TEXT,
  updated_by_actor_id UUID,
  version BIGINT NOT NULL DEFAULT 1,
  UNIQUE (book_id, account_type)
);

CREATE TRIGGER trg_ledger_accounts_bump_version
  BEFORE UPDATE ON fin.ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION fin.trg_bump_version();

-- FX snapshots live here so 103 can FK them (M3 / D-T4). Full Stage 9
-- accounting uses the same table.
CREATE TABLE fin.fx_rate_snapshots (
  id UUID PRIMARY KEY,
  base_currency CHAR(3) NOT NULL,
  quote_currency CHAR(3) NOT NULL,
  rate_bps_num BIGINT NOT NULL,
  rate_bps_den BIGINT NOT NULL CHECK (rate_bps_den > 0),
  source TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  snapshot_kind TEXT NOT NULL CHECK (snapshot_kind IN ('DAILY_ECB', 'TRANSACTION', 'MONTH_AVG')),
  UNIQUE (base_currency, quote_currency, snapshot_kind, effective_at)
);
