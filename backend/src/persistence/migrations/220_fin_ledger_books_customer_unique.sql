-- Stage 12 / DL-162 — DL-102 follow-up.
-- Stage 1 already has UNIQUE (environment, billing_account_id, book_type),
-- which implies one CUSTOMER book per (billing_account, environment).
-- This partial unique makes that CUSTOMER invariant explicit.

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_books_customer_account_env
  ON fin.ledger_books (billing_account_id, environment)
  WHERE book_type = 'CUSTOMER';
