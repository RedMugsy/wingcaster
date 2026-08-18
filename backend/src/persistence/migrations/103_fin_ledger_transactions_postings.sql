-- Stage 1 — transactions + postings + I-01 / I-02 / R2-1 / R2-2 (A §4.3–4.4, D §9–10).

CREATE TABLE fin.ledger_transactions (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  book_id UUID NOT NULL REFERENCES fin.ledger_books(id),
  pair_id UUID,
  fx_rate_snapshot_id UUID REFERENCES fin.fx_rate_snapshots(id),
  shape TEXT NOT NULL CHECK (shape IN (
    'FUNDING', 'HOLD', 'VOID', 'CAPTURE', 'DIRECT_SPEND', 'EXPIRY',
    'REFUND', 'ADJUSTMENT', 'TRANSFER', 'GRANT', 'MIGRATE'
  )),
  economic_source_type TEXT NOT NULL,
  economic_source_id UUID NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id UUID,
  reason_code TEXT NOT NULL,
  idempotency_key_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_pair_id_transfer_only CHECK (pair_id IS NULL OR shape = 'TRANSFER')
);

CREATE UNIQUE INDEX uq_ledger_tx_once_per_source_shape
  ON fin.ledger_transactions (environment, economic_source_type, economic_source_id, shape)
  WHERE shape IN (
    'FUNDING', 'HOLD', 'VOID', 'CAPTURE', 'DIRECT_SPEND',
    'EXPIRY', 'GRANT', 'MIGRATE'
  );

CREATE UNIQUE INDEX uq_ledger_tx_transfer_per_book
  ON fin.ledger_transactions (environment, economic_source_id, book_id)
  WHERE shape = 'TRANSFER';

CREATE UNIQUE INDEX uq_ledger_tx_pair_book
  ON fin.ledger_transactions (pair_id, book_id)
  WHERE pair_id IS NOT NULL;

CREATE TABLE fin.ledger_postings (
  id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('LIVE', 'TEST')),
  transaction_id UUID NOT NULL REFERENCES fin.ledger_transactions(id),
  book_id UUID NOT NULL REFERENCES fin.ledger_books(id),
  account_id UUID NOT NULL REFERENCES fin.ledger_accounts(id),
  amount_units BIGINT NOT NULL,
  fx_rate_snapshot_id UUID REFERENCES fin.fx_rate_snapshots(id),
  lot_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_ledger_postings_amount_nonzero CHECK (amount_units <> 0)
);

CREATE INDEX idx_ledger_postings_account_created
  ON fin.ledger_postings (account_id, created_at);
CREATE INDEX idx_ledger_postings_transaction
  ON fin.ledger_postings (transaction_id);

-- I-02 / M8: posting.book_id = tx.book_id AND account.book_id = posting.book_id.
CREATE OR REPLACE FUNCTION fin.trg_posting_book_containment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tx_book UUID;
  acct_book UUID;
BEGIN
  SELECT book_id INTO tx_book
    FROM fin.ledger_transactions WHERE id = NEW.transaction_id;
  SELECT book_id INTO acct_book FROM fin.ledger_accounts WHERE id = NEW.account_id;

  IF NEW.book_id IS DISTINCT FROM tx_book THEN
    RAISE EXCEPTION 'I-02 posting.book_id % <> tx.book_id % (CLEARING is an account_type, not a jumping posting)',
      NEW.book_id, tx_book
      USING ERRCODE = '23514';
  END IF;
  IF acct_book IS DISTINCT FROM NEW.book_id THEN
    RAISE EXCEPTION 'I-02 account.book_id % <> posting.book_id %',
      acct_book, NEW.book_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ledger_postings_book_containment
  BEFORE INSERT OR UPDATE ON fin.ledger_postings
  FOR EACH ROW EXECUTE FUNCTION fin.trg_posting_book_containment();

-- I-01 deferred conservation.
CREATE OR REPLACE FUNCTION fin.assert_tx_conservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tx_id UUID;
  s BIGINT;
BEGIN
  tx_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  SELECT COALESCE(SUM(amount_units), 0) INTO s
    FROM fin.ledger_postings WHERE transaction_id = tx_id;
  IF s <> 0 THEN
    RAISE EXCEPTION 'I-01 transaction conservation violated: tx % sum %', tx_id, s
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_ledger_postings_conservation
  AFTER INSERT OR UPDATE OR DELETE ON fin.ledger_postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fin.assert_tx_conservation();

-- R2-1 / DL-025 / D §9 — exactly two legs per pair_id at COMMIT.
CREATE OR REPLACE FUNCTION fin.assert_transfer_pair_cardinality()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pid UUID;
  n INTEGER;
BEGIN
  pid := COALESCE(NEW.pair_id, OLD.pair_id);
  IF pid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT count(*) INTO n FROM fin.ledger_transactions WHERE pair_id = pid;
  IF n <> 2 THEN
    RAISE EXCEPTION
      'TRANSFER pair_id % must have exactly 2 rows at COMMIT, found %',
      pid, n
      USING ERRCODE = '23514',
            HINT = 'Insert both TRANSFER legs in one transaction';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER trg_ledger_tx_pair_cardinality
  AFTER INSERT OR UPDATE OF pair_id OR DELETE
  ON fin.ledger_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fin.assert_transfer_pair_cardinality();

-- R2-2 / DL-026 / D §10 — FX stamp on cross-currency pair-legs.
CREATE OR REPLACE FUNCTION fin.assert_pair_fx_stamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  this_ccy CHAR(3);
  other_ccy CHAR(3);
  other_fx UUID;
BEGIN
  IF NEW.pair_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.currency INTO this_ccy
    FROM fin.ledger_books b WHERE b.id = NEW.book_id;

  SELECT b.currency, t.fx_rate_snapshot_id
    INTO other_ccy, other_fx
    FROM fin.ledger_transactions t
    JOIN fin.ledger_books b ON b.id = t.book_id
   WHERE t.pair_id = NEW.pair_id
     AND t.id <> NEW.id;

  IF other_ccy IS NULL THEN
    RETURN NEW;
  END IF;

  IF other_ccy <> this_ccy THEN
    IF NEW.fx_rate_snapshot_id IS NULL THEN
      RAISE EXCEPTION
        'cross-currency TRANSFER pair % (book % % vs %) requires fx_rate_snapshot_id',
        NEW.pair_id, NEW.book_id, this_ccy, other_ccy
        USING ERRCODE = '23514';
    END IF;
    IF other_fx IS NOT NULL AND other_fx IS DISTINCT FROM NEW.fx_rate_snapshot_id THEN
      RAISE EXCEPTION
        'TRANSFER pair % legs must share fx_rate_snapshot_id',
        NEW.pair_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_ledger_tx_fx_stamp
  AFTER INSERT OR UPDATE OF pair_id, book_id, fx_rate_snapshot_id
  ON fin.ledger_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fin.assert_pair_fx_stamp();
