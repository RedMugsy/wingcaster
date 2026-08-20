/**
 * Postpaid capture (C §5.16 / C §5.3 facility add-on).
 *
 * Ledger-touching steps only (DL-106):
 *   lock OPEN reservation → facility ACTIVE|PAUSED → OPEN→CAPTURED
 *   mint FACILITY_DRAW (granted = captured, remaining = 0)
 *   ISSUANCE→AVAILABLE then AVAILABLE→CONSUMED via write.js insertPostingPair
 *   (net ISSUANCE −u / CONSUMED +u; draw allocation on the AVAILABLE debit)
 *   audit + outbox fin.facility.reservation
 *
 * Stage 9 (DL-120): after FACILITY_DRAW mint + consume, reservations.js
 * inserts REVENUE_RECOGNIZED + RECEIVABLE_CREATED in the same tx.
 * Invoice ISSUE / tax-at-issue remain Stage 10.
 */
export { captureFacility, captureFacilityForHold } from './reservations.js'
