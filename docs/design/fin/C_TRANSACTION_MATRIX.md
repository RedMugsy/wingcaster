# Deliverable C — Transaction matrix

**Stage:** 0 (§128)
**Owner:** Agent B
**Date:** 2026-08-18
**Status:** Stage 0 design — not implementation
**Depends on:** `A_ENTITY_MODEL.md` (APPROVED), `B_STATE_MACHINES.md`, `DECISION_LOG.md` DL-000…DL-028 + DL-029…DL-036
**Closes:** A-Q1 (command side — which transitions mint `ledger_transactions`)
**Prepares:** Agent C (`D_CONCURRENCY`, `E_IDEMPOTENCY`) lock order, in-flight keys, and the R2-1 / R2-2 **mechanisms**. This file states the invariants those mechanisms must enforce.
**Does not touch:** `A_ENTITY_MODEL.md` body, D–H, `backend/src/**`, migrations.

`commercial.*` is frozen. Every write listed here is `fin.*`.

---

## 0. How to read a row

A **command** is the only legal writer of `fin.ledger_transactions` + `fin.ledger_postings`. App services request a command; they do not insert postings (spec §2, audit A-4 doctrine).

| Col | Meaning |
|---|---|
| Command | Name used in B triggers and in `backend/src/fin/**` later |
| Precondition read | Rows read (and locked — C names the lock mode) before insert |
| Tables written | `fin.*` only, same DB transaction |
| Tx shape | `ledger_transactions.shape` — one header per book |
| `economic_source_type` / id | A §4.3 vocabulary. Uniqueness: DL-014 |
| Lot draw | §4 pattern, or `—` |
| Hold | Creates / captures / voids / ignores |
| Idempotency subject | Natural key Agent E hashes with the request fingerprint. Not a new column. |
| Outbox | Topics from B §1, same tx |
| Audit | `financial_audit_events.action` |
| Approval | `action_kind` or `—` |

**Always, for every row that inserts a tx:**

1. `SUM(postings.amount_units) = 0` per `ledger_transactions.id` at COMMIT (I-01).
2. `posting.book_id = tx.book_id = account.book_id` (I-02 / DL-012). A posting that names another book is `TRANSFER_CROSS_POSTING`, not a feature.
3. `actor_type` + `actor_id` + `reason_code` on the tx (I-15).
4. `idempotency_keys` row `IN_FLIGHT`→`COMPLETED` in the same tx (B §7).
5. `environment` matches every FK target (DL-005).
6. `accounting_periods` for `effective_at` is not `HARD_CLOSED` (B §20).

Money and units are `BIGINT`. Conversion uses `fx_rate_snapshots.rate_bps_num / rate_bps_den` (DL-002, DL-015). No `Number()`, no `NUMERIC` on the value path.

---

## 1. Cross-book TRANSFER (DL-012) — paired txs, one book each

Cross-book value movement is **two** `ledger_transactions` rows that share `pair_id`.

```
Book A (source)                         Book B (destination)
tx_1  shape=TRANSFER  pair_id=P         tx_2  shape=TRANSFER  pair_id=P
  AVAILABLE     −N                        CLEARING     −N′
  CLEARING      +N                        AVAILABLE    +N′
                                          ADJUSTMENT   +(N′−N″)   only if FX residual
```

Rules:

1. **One tx per book.** `UNIQUE (environment, economic_source_id, book_id) WHERE shape='TRANSFER'` (A §4.3). A second TRANSFER on the same book for the same source is a replay or a bug.
2. **`CLEARING` is an `account_type`**, the seventh, inside each book. It is not a posting that references the other book. The prior “except CLEARING legs” clause stays deleted (DL-012).
3. **No jumping postings.** `posting.book_id ≠ tx.book_id` is `TRANSFER_CROSS_POSTING` regardless of `account_type`.
4. **Same `economic_source_type='TRANSFER_INTENT'`** and the same `economic_source_id` on both legs. That id is a command-minted UUID (B §26 — no `fin.transfer_intents` table).
5. **`fin.transfer.posted` fires once per pair** (`dedupe_key=pair:{pair_id}`), not once per leg.
6. Same-book transfer (holder-to-holder inside one book) is still `shape=TRANSFER` but **`pair_id` is NULL**. It is one tx: AVAILABLE −N on source holder lots, AVAILABLE +N on dest lots. CLEARING is not used. DL-025: `pair_id IS NULL OR shape='TRANSFER'` — pair_id stays null here.

Intra-book vs cross-book is decided by `source_book_id = dest_book_id`. Agent C locks `book_id ASC` when two books (A-Q2).

### 1.1 R2-1 — pair integrity (state / command side)

Agent C owns: `CHECK (pair_id IS NULL OR shape='TRANSFER')`, `UNIQUE (pair_id, book_id) WHERE pair_id IS NOT NULL`, and the deferred **exactly-two** COMMIT assertion (DL-025).

This matrix owns the writer behaviour:

| Situation | Command behaviour | Code |
|---|---|---|
| Fresh `pair_id` | Insert **exactly two** TRANSFER txs in one DB transaction, then COMMIT | — |
| `COUNT(*) WHERE pair_id=P` is already 2 | Insert **zero** rows. Treat as complete. If this is a new command (not an idempotent replay), reject | `TRANSFER_PAIR_COMPLETE` |
| Insert would make N=3 | **Forbidden.** No compensating “third clearing” tx. No FX residual as a third TRANSFER | `TRANSFER_PAIR_COMPLETE` |
| First leg inserted, second insert fails | **Rollback the DB transaction.** Do not commit a 1-leg pair. There is no `CompleteTransferPair` command | `TRANSFER_PAIR_INCOMPLETE` |
| Worker finds a committed 1-leg pair | That is a conservation incident. Recon R00x (F). Do **not** mint the missing leg as a repair | `TRANSFER_PAIR_INCOMPLETE` |

`pair_id` is minted by the command (`gen_random_uuid()`). Callers do not supply it. Idempotent replay of `TransferCredits` returns the original pair (two tx ids) from `idempotency_keys.response_body`.

---

## 2. FX (DL-015) — stamp both legs; residual is a posting, not a third tx

When `source_book.currency ≠ dest_book.currency`:

1. Resolve `fin.fx_rate_snapshots` (`snapshot_kind` is G: default `TRANSACTION` at `BusinessClock.now()`, else `DAILY_ECB`). Missing snapshot → `FX_SNAPSHOT_REQUIRED`.
2. Stamp `fx_rate_snapshot_id` on **both** TRANSFER txs and on **every posting** of both legs (A §4.3 / §4.4).
3. Convert with integer rational arithmetic: `N′ = N * rate_bps_num / rate_bps_den` (trunc toward zero, documented). Both N and N′ are `BIGINT`.
4. If `N′ * rate_bps_den != N * rate_bps_num`, the destination tx takes an `ADJUSTMENT` **account** posting with `reason_code='FX_ROUNDING'` so that dest postings still sum to 0. This is **not** `shape='ADJUSTMENT'` and **not** a third `pair_id` leg.
5. Same-currency pairs: `fx_rate_snapshot_id` is NULL. Agent C's trigger (DL-026) rejects the inverse (cross-currency + NULL snapshot). This file states the behaviour; C names the trigger.

Presentation-currency consolidation uses `MONTH_AVG` snapshots and **does not rewrite books**.

---

## 3. Uniqueness reminder (DL-014 — do not add a column)

| shape | unique on | source type used here |
|---|---|---|
| FUNDING | `(env, source_type, source_id, shape)` | `PURCHASE_INTENT` |
| HOLD / VOID / CAPTURE | same | `HOLD` |
| DIRECT_SPEND | same | `RATED_USAGE` |
| EXPIRY / MIGRATE | same | `LOT` |
| GRANT | same | `APPROVAL_REQUEST` (DL-034) |
| TRANSFER | `(env, economic_source_id, book_id)` | `TRANSFER_INTENT` |
| REFUND | **not** unique on source — `idempotency_keys` only | `REFUND` |
| ADJUSTMENT | **not** unique on source — `idempotency_keys` only | `MANUAL` / `RECONCILIATION` / `INVOICE` |

Replay of a unique shape is the idempotency key **or** the unique index (`23505` → return the existing tx). Agent E specifies which the API surfaces.

---

## 4. Lot draw pattern (spec §39 / §58)

**Order (deterministic, no JS sort drift):**  
`draw_priority ASC, expires_at ASC NULLS LAST, issued_at ASC, id ASC`  
Index already reserved (A §13).

**Eligibility:** `status='ACTIVE'`, applicability rules allow the meter/action, `account_controls` allow the class, lot currency/book match.

**Hybrid shortfall (spec §58):**

1. Eligible prepaid lots (consideration > 0, applicability allow)
2. Committed / included-allowance lots
3. Other purchased lots
4. Facility for the remainder (`ReserveFacility` / hold + reservation)

Paid vs bonus are **separate lots** (`consideration_minor=0` ⇒ bonus, spec §51). Draw still follows §39; bonus lots typically have higher `draw_priority` (consumed first) — G owns the number, not this file.

Allocations store **negative** units on draw, **positive** on restore. `UNIQUE(posting_id, lot_id)`. `remaining_units` is maintained by trigger; tests recompute `granted_units + SUM(units)` (A §5.3).

---

## 5. Commands that insert `ledger_transactions`

### 5.0 Index

| # | Command | Shape | Source | Stage |
|---|---|---|---|---|
| 1 | `FundPurchase` | FUNDING (+ GRANT if bonus) | PURCHASE_INTENT | 7 |
| 2 | `AuthorizeHold` | HOLD | HOLD | 6 |
| 3 | `CaptureHold` | CAPTURE | HOLD | 6 |
| 4 | `VoidHold` | VOID | HOLD | 6 |
| 5 | `ExpireHold` | VOID (via `release_tx_id`; not a second shape) | HOLD | 6 |
| 6 | `DirectSpend` | DIRECT_SPEND | RATED_USAGE | 6 |
| 7 | `DirectSpendPostpaid` | DIRECT_SPEND | RATED_USAGE | 8 |
| 8 | `ExpireLot` | EXPIRY | LOT | 1/6 |
| 9 | `GrantCredits` | GRANT | APPROVAL_REQUEST | 7 |
| 10 | `TransferCredits` | TRANSFER × {1 or 2} | TRANSFER_INTENT | 7 |
| 11 | `RefundPurchase` | REFUND | REFUND | 7/10 |
| 12 | `ManualAdjust` | ADJUSTMENT | MANUAL | 1/7 |
| 13 | `ReconcileAdjust` | ADJUSTMENT | RECONCILIATION | 1+ |
| 14 | `WriteOffInvoice` | ADJUSTMENT (iff exposure remains) | INVOICE | 10 |
| 15 | `MigrateLot` | MIGRATE | LOT | 4/7 |
| 16 | `CaptureFacility` | CAPTURE or DIRECT_SPEND | FACILITY / HOLD | 8 |
| 17 | `IssueCreditNote` | REFUND and/or ADJUSTMENT | REFUND / INVOICE | 10 |
| 18 | `IssueDebitNote` | ADJUSTMENT | INVOICE | 10 |
| 19 | `ReversePayment` (dispute LOST / cash reverse) | REFUND | REFUND | 10 |

`ExpireHold` uses shape `VOID` because DL-014 allows one VOID per hold. Expiry and user-void are mutually exclusive (B §3). `release_tx_id` points at that VOID tx in both cases; distinguish via `reason_code` (`HOLD_TTL` vs `HOLD_VOID`).

---

### 5.1 `FundPurchase`

| | |
|---|---|
| **Precondition read** | `purchase_intents` (FOR UPDATE, status in {CREATED, PAYMENT_PENDING}); `account_controls.allow_purchases`; dest `ledger_books` CUSTOMER; `fx` n/a (lot currency = book currency) |
| **Tables written** | `purchase_intents`→PAID; `ledger_transactions` FUNDING; postings; `lots` PURCHASE ACTIVE; `lot_allocations` (issue = +granted via the ISSUANCE/AVAILABLE pair — allocation sign: issue is the inverse of draw, recorded as +remaining maintenance); optional second tx GRANT + lot `PROMOTIONAL_GRANT`; `account_balances` via trigger; `idempotency_keys`; `outbox_events`; `financial_audit_events`; `accounting_events` DEFERRED_REVENUE_CREATED (G) |
| **Tx shape** | FUNDING. Postings: `ISSUANCE −quoted_units`, `AVAILABLE +quoted_units` |
| **Source** | `PURCHASE_INTENT` / `purchase_intents.id` |
| **Lot draw** | Issue only. Paid lot `source_kind=PURCHASE`, `consideration_minor=quoted_minor`. Bonus (if any): separate GRANT tx, `source_kind=PROMOTIONAL_GRANT`, `consideration_minor=0`, same `purchase_intent_id`, `economic_source_type=PURCHASE_INTENT` would collide GRANT uniqueness with a later grant — **bonus GRANT uses `APPROVAL_REQUEST`** of the SYSTEM AUTO approval minted for the bonus line (DL-034), or, if no bonus approval is desired, bonus units ride **inside the FUNDING tx** as a second lot with a second AVAILABLE/ISSUANCE pair (still I-01). **Pick: bonus rides inside FUNDING** so we do not burn a GRANT unique slot on a purchase. Two lots, one FUNDING tx, four postings that still sum to 0: ISSUANCE −(paid+bonus), AVAILABLE +(paid+bonus), split across two `lot_id`s. |
| **Hold** | — |
| **Idempotency** | `FUND:{purchase_intent_id}` plus PSP `provider_event_id` (permanent unique on the intent) |
| **Outbox** | `fin.ledger.posted`, `fin.lot.issued` (dedupe per lot), `fin.purchase.status`, `notification.lifecycle`, `webhook.stripe` if PSP |
| **Audit** | `PURCHASE_FUNDED` |
| **Approval** | — (money already captured). Manual/invoice path still reason-coded |

Guard: `ConfirmPurchase` machine (B §4). Second FUNDING for the same intent → unique index / replay.

---

### 5.2 `AuthorizeHold`

| | |
|---|---|
| **Precondition read** | `rated_usage` (or subject); `account_controls`; `usage_limits` + `limit_counters`; lots per §4 (FOR UPDATE in draw order — C); optional `credit_facilities` + open reservations SUM; `ledger_books` |
| **Tables written** | `holds` OPEN; tx HOLD; postings AVAILABLE→HELD on each drawn lot; `lot_allocations` negative; `limit_counters` +; optional `facility_reservations` OPEN; `authorization_attempts` AUTHORIZED or DENIED; idempotency; outbox; audit |
| **Tx shape** | HOLD. Per lot: `AVAILABLE −u`, `HELD +u`. Multiple lots = multiple posting pairs, one tx, one book. |
| **Source** | `HOLD` / `holds.id` |
| **Lot draw** | §4. Shortfall → facility reservation (no ISSUANCE of prepaid). Denied: **no** hold row, **yes** `authorization_attempts` DENIED |
| **Hold** | creates OPEN |
| **Idempotency** | `AUTH:{subject_type}:{subject_id}:{rated_usage_id}` |
| **Outbox** | `fin.hold.authorized`, `fin.ledger.posted`, `fin.facility.reservation` if any |
| **Audit** | `HOLD_AUTHORIZED` or `HOLD_DENIED` |
| **Approval** | — |

This is the Stage 6 replacement for the A/B-1 split: the Stage 2 usage insert (facts only) and this command share one `transaction()` when the product path is “metered action that must be authorized.” Usage ingest alone (telemetry, rate-0) does not call this command.

---

### 5.3 `CaptureHold`

| | |
|---|---|
| **Precondition read** | `holds` FOR UPDATE, status OPEN, `expires_at > now`; its `lot_allocations`; optional reservation |
| **Tables written** | `holds`→CAPTURED + `capture_tx_id`; tx CAPTURE; postings HELD→CONSUMED (same units/lots); lots EXHAUSTED if remaining 0; reservation CAPTURED; if facility: `lots` FACILITY_DRAW granted **and** remaining 0 in the same tx; `accounting_events` REVENUE_RECOGNIZED / RECEIVABLE_CREATED (G); idempotency; outbox; audit |
| **Tx shape** | CAPTURE. `HELD −u`, `CONSUMED +u`. Facility add-on: `ISSUANCE −u_fac`, `CONSUMED +u_fac` (never AVAILABLE — postpaid captured lots remain zero, Stage 8 test) |
| **Source** | `HOLD` / `holds.id` |
| **Lot draw** | No new draw. Uses authorize allocations. Missing → `HOLD_ALLOCATION_MISSING` |
| **Hold** | OPEN→CAPTURED |
| **Idempotency** | `CAPTURE:{hold_id}` |
| **Outbox** | `fin.hold.captured`, `fin.ledger.posted`, `fin.lot.exhausted`?, `fin.facility.reservation`? |
| **Audit** | `HOLD_CAPTURED` |
| **Approval** | — |

---

### 5.4 `VoidHold`

| | |
|---|---|
| **Precondition read** | `holds` FOR UPDATE OPEN |
| **Tables written** | `holds`→VOIDED + `release_tx_id`; tx VOID; postings HELD→AVAILABLE; `lot_allocations` positive restore (same lot ids, opposite sign); reservation RELEASED; lots EXHAUSTED→ACTIVE if remaining > 0; idempotency; outbox; audit |
| **Tx shape** | VOID. `HELD −u`, `AVAILABLE +u` |
| **Source** | `HOLD` / `holds.id` |
| **Lot draw** | Restore exact set (spec §43) |
| **Hold** | OPEN→VOIDED |
| **Idempotency** | `VOID:{hold_id}` |
| **Outbox** | `fin.hold.voided`, `fin.ledger.posted` |
| **Audit** | `HOLD_VOIDED` |
| **Approval** | — |

---

### 5.5 `ExpireHold`

Identical posting shape to `VoidHold`. Differences: actor `WORKER`, reason `HOLD_TTL`, hold status `EXPIRED`, idempotency `EXPIRE_HOLD:{hold_id}`, outbox `fin.hold.expired`. Shape remains `VOID` (one release tx per hold). Worker uses `FOR UPDATE SKIP LOCKED` on `holds (status, expires_at) WHERE status='OPEN'` (A §13, C).

---

### 5.6 `DirectSpend` (prepaid, no hold)

| | |
|---|---|
| **Precondition read** | `rated_usage` unused for DIRECT_SPEND (unique); lots §4; controls; limits |
| **Tables written** | tx DIRECT_SPEND; AVAILABLE→CONSUMED; allocations; lot status; `authorization_attempts`; idempotency; outbox; audit |
| **Tx shape** | DIRECT_SPEND. `AVAILABLE −u`, `CONSUMED +u` |
| **Source** | `RATED_USAGE` / `rated_usage.id` |
| **Lot draw** | §4. Facility shortfall is **not** allowed on this command — use `DirectSpendPostpaid` |
| **Hold** | — |
| **Idempotency** | `SPEND:{rated_usage_id}` |
| **Outbox** | `fin.ledger.posted`, `fin.lot.exhausted`? |
| **Audit** | `DIRECT_SPEND` |
| **Approval** | — |

---

### 5.7 `DirectSpendPostpaid`

Same as 5.6 plus: `ReserveFacility`+`CAPTURE` in one tx (or reservation OPEN then CAPTURED in-tx), FACILITY_DRAW lot remaining 0, source still `RATED_USAGE` (one DIRECT_SPEND per rated_usage — DL-014). Facility accounting events (G). Outbox adds `fin.facility.reservation`. Guard `allow_postpaid_usage` + facility ACTIVE.

---

### 5.8 `ExpireLot`

| | |
|---|---|
| **Precondition read** | `lots` FOR UPDATE ACTIVE or FROZEN, `expires_at <= now`, `remaining_units > 0`; no OPEN hold allocations on this lot (expire those holds first, or this command fails `LOT_HAS_OPEN_HOLD`) |
| **Tables written** | `lots`→EXPIRED; tx EXPIRY; AVAILABLE→EXPIRED (remaining only); allocation; `accounting_events` BREAKAGE_RECOGNIZED (G); idempotency; outbox; audit |
| **Tx shape** | EXPIRY. `AVAILABLE −remaining`, `EXPIRED +remaining` |
| **Source** | `LOT` / `lots.id` |
| **Lot draw** | The lot itself, remaining only |
| **Hold** | must be none OPEN |
| **Idempotency** | `EXPIRE_LOT:{lot_id}` |
| **Outbox** | `fin.lot.expired`, `fin.ledger.posted` |
| **Audit** | `LOT_EXPIRED` |
| **Approval** | — |

---

### 5.9 `GrantCredits`

| | |
|---|---|
| **Precondition read** | `approval_requests` APPROVED (or SYSTEM AUTO EXECUTED, DL-034); `account_controls.allow_grants`; dest book |
| **Tables written** | approval → EXECUTED; tx GRANT; ISSUANCE→AVAILABLE; lot `PROMOTIONAL_GRANT` or `COMPENSATION` / `SUBSCRIPTION_GRANT` as payload says; idempotency; outbox; audit |
| **Tx shape** | GRANT. `ISSUANCE −u`, `AVAILABLE +u` |
| **Source** | `APPROVAL_REQUEST` / `approval_requests.id` |
| **Lot draw** | Issue |
| **Hold** | — |
| **Idempotency** | `GRANT:{approval_request_id}` |
| **Outbox** | `fin.ledger.posted`, `fin.lot.issued`, `fin.approval.decided` |
| **Audit** | `CREDITS_GRANTED` |
| **Approval** | `LARGE_GRANT` (always a row; AUTO below threshold) |

MASS grant (N holders) is N commands under one `MASS_OPERATION` approval, each with its own GRANT tx and own approval child or a payload listing ids — Agent E. Do not one-tx N books without C's lock order.

---

### 5.10 `TransferCredits`

| | |
|---|---|
| **Precondition read** | source lots §4; `account_controls.allow_transfers` on **both** holders; both books; FX snapshot if currencies differ; `COUNT(*)` for a caller-supplied pair_id is **not** consulted — the command mints pair_id |
| **Tables written** | two txs (cross-book) or one (same book) — §1; postings per §1 / §2; source allocations negative; dest lot `TRANSFER_IN` ACTIVE; `lot_allocations`; source EXHAUSTED?; idempotency; outbox; audit |
| **Tx shape** | TRANSFER. Cross-book: pair, one tx per book, CLEARING both sides, FX_ROUNDING on dest if needed. Same-book: `pair_id` NULL, AVAILABLE −N / AVAILABLE +N via two lot_ids in one book |
| **Source** | `TRANSFER_INTENT` / minted UUID (stored on both txs) |
| **Lot draw** | §4 on source. Dest is issue (`TRANSFER_IN`) |
| **Hold** | OPEN holds are not transferable. Guard `LOT_HAS_OPEN_HOLD` |
| **Idempotency** | `XFER:{request_key}` — response body includes `{pair_id, tx_ids[]}` |
| **Outbox** | `fin.transfer.posted` **once**, `fin.ledger.posted` per tx, `fin.lot.issued` dest, `fin.lot.exhausted`? |
| **Audit** | `CREDITS_TRANSFERRED` (one audit row naming `pair_id`) |
| **Approval** | — unless G marks large transfers as `MASS_OPERATION` |

**Third-leg ban:** see §1.1. FX residual is an ADJUSTMENT **account posting** on tx_2, not `shape=ADJUSTMENT`, not a third pair member.

---

### 5.11 `RefundPurchase`

| | |
|---|---|
| **Precondition read** | `purchase_intents` PAID; cumulative `fin.refunds` (T4, when built) + this amount ≤ `quoted_minor`; `allow_refunds`; lots issued from that intent (FOR UPDATE) |
| **Tables written** | `fin.refunds` row (Stage 10; until then the REFUND tx **is** the commercial record — OPEN if T4 columns needed earlier); tx REFUND; if units still ACTIVE: AVAILABLE→ISSUANCE (or CONSUMED path: compensation lot `REFUND_REVERSAL` + ISSUANCE); purchase → REFUNDED iff full; PSP outbox; idempotency; audit |
| **Tx shape** | REFUND. Preferred: `AVAILABLE −u`, `ISSUANCE +u` for unspent. Spent units: do not pull from CONSUMED; issue `REFUND_REVERSAL` lot or cash-only (G). Partial refunds = multiple REFUND txs (DL-014) |
| **Source** | `REFUND` / refund id (T4) or minted UUID until T4 exists. **<!-- OPEN: A reserved `fin.refunds` at Stage 10 (T4). Until that table is filled, `economic_source_id` is the command UUID stored on the audit row. Do not reuse `purchase_intents.id` (not unique for partials). -->** |
| **Lot draw** | Reverse unspent first (LIFO of remaining on lots with `purchase_intent_id`), then G |
| **Hold** | OPEN holds on those lots must be voided first |
| **Idempotency** | `REFUND:{purchase_intent_id}:{idem_suffix}` |
| **Outbox** | `fin.ledger.posted`, `fin.purchase.status`, `notification.lifecycle`, `webhook.stripe` |
| **Audit** | `PURCHASE_REFUNDED` |
| **Approval** | `LARGE_REFUND` |

---

### 5.12 `ManualAdjust`

| | |
|---|---|
| **Precondition read** | dest book; `allow_grants` if net increase, `allow_refunds` or ops capability if decrease (H); approval if negative |
| **Tables written** | tx ADJUSTMENT; ADJUSTMENT account ±u vs AVAILABLE ∓u; optional lot `ADJUSTMENT`; idempotency; outbox; audit |
| **Tx shape** | ADJUSTMENT. Increase: `ADJUSTMENT −u`, `AVAILABLE +u`. Decrease: `AVAILABLE −u`, `ADJUSTMENT +u` |
| **Source** | `MANUAL` / minted UUID (multiple allowed) |
| **Lot draw** | Decrease draws §4. Increase issues `source_kind=ADJUSTMENT` |
| **Hold** | — |
| **Idempotency** | `ADJ:{idempotency_key}` only |
| **Outbox** | `fin.ledger.posted`, `fin.lot.issued`? |
| **Audit** | `MANUAL_ADJUSTMENT` |
| **Approval** | `NEGATIVE_ADJUSTMENT` when net AVAILABLE decreases |

`reason_code` is mandatory and from a closed enum (spec §64). Agent G publishes the enum; this file requires it non-empty. `FX_ROUNDING` is **reserved** and illegal here (only dest TRANSFER postings).

---

### 5.13 `ReconcileAdjust`

Same posting shape as `ManualAdjust`. Differences: `economic_source_type=RECONCILIATION`, actor `RECONCILIATION` or USER with `RECONCILIATION_OVERRIDE` EXECUTED, reason includes `check_code`, source id = `reconciliation_resolution.id` (APPLIED in the same tx). Outbox `fin.reconciliation.resolution`. Does **not** silently “fix” a 1-leg TRANSFER pair (B §0.4).

---

### 5.14 `WriteOffInvoice`

| | |
|---|---|
| **Precondition read** | invoice ISSUED/PART_PAID; facility reservations / unbilled captures for that invoice; `WRITE_OFF` approval |
| **Tables written** | invoice → UNCOLLECTIBLE; dunning → WRITTEN_OFF; `accounting_events` BAD_DEBT_WRITE_OFF (G); **tx ADJUSTMENT only if** a facility exposure or prepaid claw must move books; idempotency; outbox; audit |
| **Tx shape** | ADJUSTMENT when needed. Facility: reverse uncaptured OPEN reservations (RELEASED, no tx) or, if already CAPTURED, ADJUSTMENT vs CONSUMED per G — default: **do not reverse CONSUMED** (credit-loss ≠ revenue reversal, spec §73). Then this command often writes **zero** ledger txs and only accounting events. |
| **Source** | `INVOICE` / `invoices.id` (multiple ADJUSTMENT allowed) |
| **Lot draw** | — default |
| **Hold** | OPEN holds for the invoice subject are VOIDED first (separate commands in the same tx) |
| **Idempotency** | `WOFF:{invoice_id}` |
| **Outbox** | `fin.invoice.status`, `fin.dunning.step`, `fin.ledger.posted` if a tx exists |
| **Audit** | `INVOICE_UNCOLLECTIBLE` |
| **Approval** | `WRITE_OFF` |

If G chooses zero ledger movement, the command still appears here because it **may** write a tx; tests assert both branches.

---

### 5.15 `MigrateLot`

| | |
|---|---|
| **Precondition read** | source lot ACTIVE; dest book **same book** (cross-book is `TransferCredits`); no OPEN hold |
| **Tables written** | source EXHAUSTED or remaining 0; dest lot `MIGRATION` ACTIVE; tx MIGRATE; AVAILABLE −u (source lot) / AVAILABLE +u (dest lot); allocations both; idempotency; outbox; audit |
| **Tx shape** | MIGRATE. One book. `AVAILABLE −u` (lot A) + `AVAILABLE +u` (lot B) — two postings, same account_type, different `lot_id`, still I-01 |
| **Source** | `LOT` / **source** `lots.id` (one MIGRATE per source lot — DL-014) |
| **Lot draw** | Full remaining of source |
| **Hold** | none OPEN |
| **Idempotency** | `MIGRATE:{lot_id}` |
| **Outbox** | `fin.ledger.posted`, `fin.lot.issued`, `fin.lot.exhausted` |
| **Audit** | `LOT_MIGRATED` |
| **Approval** | `BACKDATED_AMENDMENT` if contract-driven and backdated; `MASS_OPERATION` if bulk |

---

### 5.16 `CaptureFacility`

Used when a reservation exists **without** a prepaid hold (pure postpaid), or as the facility half of hybrid capture already described in 5.3.

| | |
|---|---|
| **Precondition read** | `facility_reservations` OPEN; facility ACTIVE or G; book |
| **Tables written** | reservation CAPTURED; tx DIRECT_SPEND or CAPTURE (if a hold_id is set, **must** be `CaptureHold` instead — do not double-shape); FACILITY_DRAW lot remaining 0; CONSUMED; accounting receivable/revenue; idempotency; outbox; audit |
| **Tx shape** | If `hold_id` set: **illegal here** (`FACILITY_USE_CAPTURE_HOLD`). Else DIRECT_SPEND: `ISSUANCE −u`, `CONSUMED +u` with `economic_source_type=FACILITY` — **wait:** DIRECT_SPEND unique is per `RATED_USAGE`. Pure facility capture without rated_usage uses `economic_source_type=FACILITY` and shape **CAPTURE** (unique per source) with `economic_source_id=facility_reservations.id`. Postings: `ISSUANCE −u`, `CONSUMED +u`. |
| **Source** | `FACILITY` / `facility_reservations.id` |
| **Lot draw** | Issue+consume in one tx |
| **Hold** | none (else 5.3) |
| **Idempotency** | `CAPFAC:{reservation_id}` |
| **Outbox** | `fin.facility.reservation`, `fin.ledger.posted` |
| **Audit** | `FACILITY_CAPTURED` |
| **Approval** | — |

<!-- OPEN: A lists CAPTURE unique on source type HOLD. Using shape CAPTURE with source FACILITY is allowed by the partial unique (it keys on source_type+id+shape) and does not collide with holds. DL-014 does not need a new column. Agent C: do not add a uniqueness column. -->

---

### 5.17 `IssueCreditNote`

| | |
|---|---|
| **Precondition read** | note APPROVED; parent invoice; allocations / lots if prepaid claw |
| **Tables written** | note → ISSUED + sequence; `invoice_adjustments`; invoice may PART_PAID; if prepaid claw: REFUND tx as 5.11; if AR-only: **no** ledger tx (G receivable reverse); tax snapshot; idempotency; outbox; audit |
| **Tx shape** | REFUND when lots/cash move; else none |
| **Source** | `REFUND` or `INVOICE` |
| **Lot draw** | Unspent lots tied to the invoice's rated_usage / purchase, §4 reverse |
| **Hold** | void OPEN first |
| **Idempotency** | `CN:{credit_note_id}` |
| **Outbox** | `fin.credit_note.status`, `fin.invoice.status`, `fin.ledger.posted`? |
| **Audit** | `CREDIT_NOTE_ISSUED` |
| **Approval** | `LARGE_REFUND` if cash/lots out |

---

### 5.18 `IssueDebitNote`

AR increase / under-bill correction. Sequence `DEBIT_NOTE`. Ledger tx only if we must issue extra CONSUMED/AVAILABLE (rare prepaid under-grant): ADJUSTMENT, source `INVOICE`. Default: accounting + invoice_adjustments only. Idempotency `DN:{debit_note_id}`. Outbox `fin.debit_note.status`. Approval `—` unless G says negative-to-platform.

---

### 5.19 `ReversePayment` / dispute `LOST`

| | |
|---|---|
| **Precondition read** | `payments` ALLOCATED or RECEIVED; dispute LOST or USER reverse; allocations |
| **Tables written** | payment → REVERSED; reverse `invoice_payment_allocations` (append compensating allocation rows — APPEND_ONLY, so a negative `amount_minor` allocation or a new row that nets — **<!-- OPEN: A `invoice_payment_allocations.amount_minor` has no sign check. Allow negative compensating rows. Do not UPDATE issued allocations. -->**); invoice PART_PAID/ISSUED; `unapplied_cash`; if the payment funded a `purchase_intents` PAID, call `RefundPurchase` in the same tx; idempotency; outbox; audit |
| **Tx shape** | REFUND iff lots were funded; else none |
| **Source** | `REFUND` / minted or T4 |
| **Lot draw** | via `RefundPurchase` |
| **Hold** | — |
| **Idempotency** | `PAYREV:{payment_id}` |
| **Outbox** | `fin.payment.status`, `fin.invoice.status`, `fin.dispute.status`?, `fin.ledger.posted`? |
| **Audit** | `PAYMENT_REVERSED` |
| **Approval** | `LARGE_REFUND` if cash/lots out |

---

## 6. Commands that do **not** insert `ledger_transactions`

Listed so Agent D/G do not assume a missing row is a gap, and so nobody quietly adds a tx.

| Command | Why no tx | Still writes |
|---|---|---|
| `CreatePurchaseIntent` / `SubmitPurchasePayment` / `FailPurchase` / `CancelPurchase` | no value movement yet / failed | intent, outbox |
| `DraftInvoice` / `ApproveInvoice` / `IssueInvoice` | invoice is a tax/AR document; prepaid already FUNDED; postpaid receivable booked at capture | invoices, sequences, tax_snapshots, zatca/render outbox |
| `ApplyPayment` | cash vs AR; `unapplied_cash` + allocations. Funds lots only by calling `FundPurchase` when `purchase_intents.provider='INVOICE'` | payments, allocations, invoice status |
| `Open/Advance/CureDunning` | controls + steps | dunning, account_controls |
| Contract / version / facility header (except capture) | commercial life | headers, audit, outbox |
| `StartReconRun` / `FinishReconRun` | measurements | runs, checks, drift, OPEN resolutions |
| `SoftCloseAccountingPeriod` / `HardCloseAccountingPeriod` | gates | period status |
| `FinalizeVendorStatement` | vendor AR, not customer books | statement |
| `PublishOutbox` | delivery | outbox status |
| Usage ingest / meter / rate | facts (DL-007) | usage / metered / rated |

`IssueInvoice` **must not** mint an ISSUANCE posting. That was the `emitUsageEvent` fusion this rebuild deletes.

---

## 7. Hold interaction summary

| Command | Hold |
|---|---|
| `AuthorizeHold` | create OPEN |
| `CaptureHold` | OPEN→CAPTURED |
| `VoidHold` / `ExpireHold` | OPEN→VOIDED/EXPIRED + restore |
| `DirectSpend*` | none |
| `FundPurchase` / `GrantCredits` | none |
| `TransferCredits` / `ExpireLot` / `MigrateLot` / `RefundPurchase` | refuse if OPEN hold on drawn lots |
| `CaptureFacility` | refuse if `hold_id` set (use `CaptureHold`) |
| `WriteOffInvoice` | VOID OPEN holds on the invoice subject in the same tx (nested commands) |

---

## 8. Ground for Agent C (concurrency) — do not invent columns

Lock order (A-Q2, start here; C may refine, not reverse):

1. `idempotency_keys` row (`environment, tenant_id, key`) — first, so IN_FLIGHT is visible
2. `ledger_books.id` **ASC** (both books of a pair)
3. `credit_facilities.id` if touched
4. `lots.id` in **draw order** (§4), never in UUID order
5. `holds.id` / `facility_reservations.id` / `purchase_intents.id` / `invoices.id` as the command requires
6. `approval_requests.id` last among intents (EXECUTED stamp)

Pair_id: lock both books by `book_id ASC` **before** inserting either TRANSFER tx. Do not lock “the pair_id” as a third book.

R2-1 mechanism (C): deferred constraint or `AFTER INSERT` assertion `COUNT(*) = 2` for non-null `pair_id` at COMMIT. This file forbids a writer that would need N=3.

R2-2 mechanism (C, DL-026): trigger  
`fx_rate_snapshot_id IS NOT NULL OR pair_id IS NULL OR counterpart_book.currency = this.book.currency`.  
Behaviour tests are §Acceptance C10 / A §18 #10.

Do not add a uniqueness column (DL-014).

---

## 9. Live P0s — scoped, not remediated

| Finding | Command that replaces the surface | Stage |
|---|---|---|
| A/B-1 split insert / consumption | `AuthorizeHold` / `DirectSpend` in one tx with Stage 2 ingest | 2+6 |
| A-2 swallow | `authorization_attempts` + outbox DEAD; no command returns null on DB error | 2+6 |
| A-4 second ledger | wa_listings consume → `AuthorizeHold` against `fin.lots` | 6/7+13 |
| C-2 lost update | OCC on every precondition UPDATE | 1 |
| B-8 lost notify | outbox columns above | 1 |
| E-3 mutable audit | `financial_audit_events` INSERT per command | 1+H |

No `backend/src/billing/events.js` patch in Stage 0.

---

## 10. Acceptance — real Postgres, same PR as the writer

A §18 posture: **if the file name is not in the CI `postgres` job summary, it did not run.** No mocked-DB conservation tests.

| # | File that must appear in the postgres job | Asserts |
|---|---|---|
| C01 | `backend/src/fin/ledger/conservation.test.js` | every command in §5: committed postings per tx sum to 0; failure mid-command leaves **zero** txs (A §18 #2) |
| C02 | `backend/src/fin/ledger/book-containment.test.js` | posting.book_id ≠ tx.book_id rejected even when account_type=CLEARING (A §18 #3, DL-012) |
| C03 | `backend/src/fin/ledger/transfer-pair.test.js` | happy pair N=2; replay does not insert a third (`TRANSFER_PAIR_COMPLETE`); aborted second insert rolls back first; `pair_id` only on TRANSFER; same-book transfer has `pair_id` NULL; `fin.transfer.posted` count = 1 per pair |
| C04 | `backend/src/fin/ledger/fx-pair.test.js` | cross-currency without snapshot rejected (A §18 #10); both legs + all postings carry the same `fx_rate_snapshot_id`; residual posting is ADJUSTMENT account + `FX_ROUNDING` on dest tx; dest still zeros; **no third tx** |
| C05 | `backend/src/fin/ledger/fund-purchase.test.js` | paid + bonus = two lots, one FUNDING tx; bonus `consideration_minor=0`; unique FUNDING per intent; PSP event reuse |
| C06 | `backend/src/fin/ledger/hold-cycle.test.js` | authorize/capture/void/expire posting shapes; void exact-lot restore; capture+void unique conflict; facility hybrid: FACILITY_DRAW remaining 0 after capture |
| C07 | `backend/src/fin/ledger/direct-spend.test.js` | one DIRECT_SPEND per `rated_usage`; second is replay; facility path uses 5.7 not 5.6 |
| C08 | `backend/src/fin/ledger/grant-expiry-migrate.test.js` | GRANT source is `APPROVAL_REQUEST`; EXPIRY unique per lot; MIGRATE same-book only; cross-book migrate rejected (`USE_TRANSFER`) |
| C09 | `backend/src/fin/ledger/refund-adjust.test.js` | two partial REFUNDs allowed; ManualAdjust negative requires approval; `FX_ROUNDING` as ManualAdjust reason rejected; ReconcileAdjust does not complete a 1-leg pair |
| C10 | `backend/src/fin/ledger/writeoff-notes-payment.test.js` | IssueInvoice inserts 0 txs; ApplyPayment inserts 0 txs unless it calls FundPurchase; WriteOffInvoice accounting-only vs ADJUSTMENT branch; credit note prepaid claw vs AR-only |
| C11 | `backend/src/fin/ledger/lot-draw-order.test.js` | 1000 randomized lot sets: draw order matches §4 SQL; applicability deny skipped; frozen skipped |
| C12 | `backend/src/fin/ledger/idempotency-replay.test.js` | COMPLETED replay of each unique shape inserts 0 new txs; fingerprint conflict; expired key does not fund |
| C13 | `backend/src/fin/ledger/outbox-same-tx.test.js` | crash after posting insert and before outbox insert is impossible (one tx); query committed txs always have the topics in §5 |
| C14 | `backend/src/fin/ledger/append-only.test.js` | app-role UPDATE/DELETE on `ledger_transactions` / `ledger_postings` / `lot_allocations` denied (A §18 #4) |

Stage mapping: C01–C04 C12–C14 with Stage 1 `ledger/transactions.js`; C06 C07 C08 C11 with Stage 6; C05 C09 with Stage 7; C10 with Stage 10. A command that lands without its file in the postgres summary is not done.

---

## 11. A-Q1 (command side) — closed

B closed the status matrices. This file closes “which of those transitions mint a `ledger_transactions` row, with what shape and source.” Agent C starts from §8. Agent D maps R001–R023 onto C01–C04. Agent G owns whether invoice/payment/write-off add accounting events; they do not add ledger shapes.
