-- Stage 11 — additive CHECK extension for PROVIDER_COST_ATTRIBUTED.
-- Does NOT edit 190. Preserves every prior event_kind / source_type value
-- (DL-154). Unique belt for the new kind so FINALIZE retry cannot duplicate.

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'fin.accounting_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%event_kind%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE fin.accounting_events DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE fin.accounting_events
  ADD CONSTRAINT accounting_events_event_kind_check
  CHECK (event_kind IN (
    'DEFERRED_REVENUE_CREATED',
    'REVENUE_RECOGNIZED',
    'RECEIVABLE_CREATED',
    'BREAKAGE_RECOGNIZED',
    'BAD_DEBT_WRITE_OFF',
    'REFUND_REVENUE_REVERSED',
    'TRANSFER_INTERNAL',
    'ADJUSTMENT_REVENUE',
    'FX_REMEASUREMENT',
    'TAX_ACCRUED',
    'CONSIDERATION_ALLOCATED',
    'PROVIDER_COST_ATTRIBUTED'
  ));

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'fin.accounting_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%source_type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE fin.accounting_events DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE fin.accounting_events
  ADD CONSTRAINT accounting_events_source_type_check
  CHECK (source_type IN (
    'PURCHASE_INTENT', 'HOLD', 'FACILITY_RESERVATION',
    'LOT', 'INVOICE', 'RATED_USAGE', 'VENDOR_ACTUAL_COST'
  ));

CREATE UNIQUE INDEX uq_accounting_events_provider_cost
  ON fin.accounting_events (environment, source_type, source_id, event_kind)
  WHERE event_kind = 'PROVIDER_COST_ATTRIBUTED';

COMMENT ON INDEX fin.uq_accounting_events_provider_cost IS
  'One PROVIDER_COST_ATTRIBUTED per vendor_actual_cost (DL-155). FINALIZE retry is a no-op.';
