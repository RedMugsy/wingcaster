-- Stage 1 — account_balances CACHE (A §4.5). Writers: posting trigger only.

CREATE TABLE fin.account_balances (
  account_id UUID PRIMARY KEY REFERENCES fin.ledger_accounts(id),
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  balance_units BIGINT NOT NULL,
  last_posting_id UUID NOT NULL REFERENCES fin.ledger_postings(id),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE OR REPLACE FUNCTION fin.trg_apply_posting_to_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fin, public, pg_temp
AS $$
BEGIN
  INSERT INTO fin.account_balances (account_id, environment, balance_units, last_posting_id, updated_at)
  VALUES (NEW.account_id, NEW.environment, NEW.amount_units, NEW.id, NEW.created_at)
  ON CONFLICT (account_id) DO UPDATE
    SET balance_units = fin.account_balances.balance_units + EXCLUDED.balance_units,
        last_posting_id = EXCLUDED.last_posting_id,
        updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ledger_postings_balance
  AFTER INSERT ON fin.ledger_postings
  FOR EACH ROW
  EXECUTE FUNCTION fin.trg_apply_posting_to_balance();
