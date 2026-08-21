-- Stage 11 follow-up — add VENDOR_VARIANCE_OVERRIDE to the
-- approval_requests.action_kind CHECK enum. Additive DROP + ADD
-- CONSTRAINT preserving all existing values.
-- DL-160.

ALTER TABLE fin.approval_requests
  DROP CONSTRAINT chk_approval_requests_action_kind;

ALTER TABLE fin.approval_requests
  ADD CONSTRAINT chk_approval_requests_action_kind
  CHECK (action_kind IN (
    'LARGE_GRANT', 'LARGE_REFUND', 'NEGATIVE_ADJUSTMENT', 'FACILITY_OPS',
    'BACKDATED_AMENDMENT', 'INVOICE_VOID', 'WRITE_OFF', 'RECONCILIATION_OVERRIDE',
    'MASS_OPERATION', 'PLATFORM_ADMIN_RECOVERY', 'AUDIT_RETENTION',
    'VENDOR_VARIANCE_OVERRIDE'
  ));
