/**
 * Advisory-lock class registry (D_CONCURRENCY §7.1).
 * Two-int form: pg_try_advisory_lock(class, key2).
 * Do not reuse 8734281374 (legacy commercial renewal scanner).
 */

export const FIN_CONTRACT_RENEWAL = 1001
export const FIN_HOLD_EXPIRY = 1002
export const FIN_LOT_EXPIRY = 1003
export const FIN_OUTBOX_PUBLISH = 1004
export const FIN_USAGE_DLQ = 1005
export const FIN_DUNNING = 1006
export const FIN_BILLING_CLOSE = 1007
export const FIN_ACCOUNTING_CLOSE = 1008
export const FIN_RECONCILIATION = 1009
export const FIN_AUTO_TOPUP = 1010
export const FIN_PARTITION_DDL = 1011
export const FIN_IDEMPOTENCY_SWEEP = 1012
export const FIN_METERING = 1013
export const FIN_RATING = 1014
/** Per-intent serialization inside transaction(fn). xact-scoped, not session. */
export const FIN_PURCHASE_INTENT = 1015
/** Facility-reservation TTL sweeper. Mirrors FIN_HOLD_EXPIRY = 1002. Do not reuse 1016 (DL-104). */
export const FIN_FACILITY_RESERVATION_EXPIRY = 1017
/** Per-facility header serialization inside transaction(fn). xact-scoped. */
export const FIN_CREDIT_FACILITY = 1018
/** Per-period SoftClose / HardClose / Reopen. xact-scoped (DL-116). Do not reuse 1016. */
export const FIN_ACCOUNTING_PERIOD_CLOSE = 1019
/** Per-period 12-step billing close (B §11 / spec §77). xact-scoped (DL-131). Do not reuse 1016. */
export const FIN_BILLING_PERIOD_CLOSE = 1020
/** Per-statement vendor recon (A §11 / D). xact-scoped (DL-151). */
export const FIN_VENDOR_STATEMENT_RECON = 1021
/** Stage 13b historical backfill mutex. Session-scoped; one batch per source at a time (DL-180). */
export const FIN_CUTOVER_BACKFILL = 1030
/** Stage 13c parity worker mutex. Session-scoped per tick; key2 = hashtext(source) so sources run in parallel (DL-196). */
export const FIN_CUTOVER_PARITY = 1031
/** Stage 13d cutover activate/deactivate mutex. Session-scoped; key2 = hashtext(environment) (DL-206). */
export const FIN_CUTOVER_ACTIVATION = 1032

export const LOCK_CLASSES = {
  FIN_CONTRACT_RENEWAL,
  FIN_HOLD_EXPIRY,
  FIN_LOT_EXPIRY,
  FIN_OUTBOX_PUBLISH,
  FIN_USAGE_DLQ,
  FIN_DUNNING,
  FIN_BILLING_CLOSE,
  FIN_ACCOUNTING_CLOSE,
  FIN_RECONCILIATION,
  FIN_AUTO_TOPUP,
  FIN_PARTITION_DDL,
  FIN_IDEMPOTENCY_SWEEP,
  FIN_METERING,
  FIN_RATING,
  FIN_PURCHASE_INTENT,
  FIN_FACILITY_RESERVATION_EXPIRY,
  FIN_CREDIT_FACILITY,
  FIN_ACCOUNTING_PERIOD_CLOSE,
  FIN_BILLING_PERIOD_CLOSE,
  FIN_VENDOR_STATEMENT_RECON,
  FIN_CUTOVER_BACKFILL,
  FIN_CUTOVER_PARITY,
  FIN_CUTOVER_ACTIVATION,
}
