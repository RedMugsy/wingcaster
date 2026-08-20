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
 * NOT landed (Stage 10 — DL-106 / DL-109): fin.receivables, accounting_events,
 * IssueInvoice, revenue-event at capture. Do not invent those tables.
 */
export { captureFacility, captureFacilityForHold } from './reservations.js'
