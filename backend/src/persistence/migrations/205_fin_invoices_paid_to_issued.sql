-- Stage 10 follow-up — allow invoices PAID → ISSUED on full payment
-- reversal. Migration 201's trigger only allowed PAID → PART_PAID.
-- Full ReversePayment (allocated → 0) legitimately restores ISSUED.
-- CREATE OR REPLACE FUNCTION is additive; no schema change.
-- DL-143.

CREATE OR REPLACE FUNCTION fin.trg_invoices_status_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legal BOOLEAN := false;
  issued_like TEXT[] := ARRAY['ISSUED', 'PART_PAID', 'PAID', 'VOID', 'UNCOLLECTIBLE'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'INVOICE_NOT_DRAFT'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = ANY (issued_like) THEN
    IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
       OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
       OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor
       OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
       OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
       OR NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id
       OR NEW.invoice_sequence_id IS DISTINCT FROM OLD.invoice_sequence_id
       OR NEW.currency IS DISTINCT FROM OLD.currency
    THEN
      RAISE EXCEPTION 'INVOICE_MUTATE_AFTER_ISSUE'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.environment IS DISTINCT FROM OLD.environment
  THEN
    RAISE EXCEPTION 'invoices identity columns are immutable'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status IN ('APPROVED', 'VOID') THEN
    legal := true;
  ELSIF OLD.status = 'APPROVED' AND NEW.status IN ('DRAFT', 'ISSUED') THEN
    legal := true;
  ELSIF OLD.status = 'ISSUED' AND NEW.status IN ('PART_PAID', 'PAID', 'VOID', 'UNCOLLECTIBLE') THEN
    legal := true;
  ELSIF OLD.status = 'PART_PAID' AND NEW.status IN ('PAID', 'VOID', 'UNCOLLECTIBLE', 'ISSUED') THEN
    legal := true;
  ELSIF OLD.status = 'PAID' AND NEW.status = 'PART_PAID' THEN
    legal := true;
  ELSIF OLD.status = 'PAID' AND NEW.status = 'ISSUED' THEN
    legal := true;  -- ReversePayment full-reversal path (DL-143)
  ELSIF OLD.status = 'UNCOLLECTIBLE' AND NEW.status IN ('PAID', 'PART_PAID') THEN
    legal := true;
  END IF;

  IF NOT legal THEN
    RAISE EXCEPTION 'invoices illegal transition % → %', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION fin.trg_invoices_status_flip() OWNER TO fin_migrator;
GRANT EXECUTE ON FUNCTION fin.trg_invoices_status_flip() TO fin_app_role;
