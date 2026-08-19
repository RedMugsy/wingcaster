# Deliverable F — Reconciliation matrix

**Stage:** 0 (§128)
**Owner:** Agent D (this file). Sits on A + DL-000…DL-028. B/C had not landed at write time; transition names follow A. If B renames a status, append a Decision Log row — do not silently rename here.
**Date:** 2026-08-18
**Status:** Stage 0 design. Closes **A-Q4**.
**Locks:** table names and PK types in `A_ENTITY_MODEL.md`. Columns reserved here are DL-045 / DL-046 only.
**Does not:** write `backend/src/**`, invent parallel tables, or silently remediate live P0s in `commercial.*`.

Vocabulary reminder (A §1): quantities are `BIGINT` atomic units (`UNIT_SCALE = 1_000_000`); money is `BIGINT` `*_minor`. Every comparison is integer subtraction. `expected_delta_units = 0` unless the check is an allowed inequality (those use `expected_delta_units <= 0` and store the signed slack).

---

## 0. What this file is

Every mandatory check **R001–R092** (spec §96, plan Stage 1 / 2 / 5 / 8 / 9 / 10 / 11 / 13) is a pair of SQL statements against `fin.*`. A run inserts one `fin.reconciliation_checks` row per pair and zero or more `fin.reconciliation_drift` rows when `source − comparison ≠ expected_delta_units`.

The runner never “fixes” money. Drift takes the **resolution ladder** in §2 (A §12.6 / spec §97). Compensating writes are ordinary economic commands (`ADJUSTMENT` / `CORRECTION` usage / credit note) under `idempotency_keys` and, where required, `approval_requests.action_kind = 'RECONCILIATION_OVERRIDE'`.

CI lesson (`docs/HANDOVER_2026-08-16.md` §3.1; audit cross-cut): a check that is not named in the **postgres** job summary did not run. Counts in this file are not evidence.

---

## 1. Reserved columns (do not invent tables)

A §12.6 reserved four tables. Two column packs are missing for scheduling and for the pair contract. Binding via DL-045 / DL-046:

**`fin.reconciliation_runs` (INTENT)** — A: `id`, `+env`, `started_at`, `finished_at`, `scope`, `status`, `+occ`. Added:

| Column | Type | Notes |
|---|---|---|
| schedule_kind | TEXT NOT NULL | `DAILY` / `PER_CLOSE` / `ON_DEMAND` |
| advisory_lock_key | TEXT NOT NULL | stable string; hashed to `pg_advisory_lock` (see §3) |
| triggered_by_actor_type / triggered_by_actor_id | TEXT / UUID | I-15 |
| legal_entity_id | UUID → platform_legal_entities | nullable = platform-wide |
| billing_period_id | UUID → billing_periods | set on `PER_CLOSE` of a billing period |
| accounting_period_id | UUID → accounting_periods | set on `PER_CLOSE` of a legal-entity close |
| source_system | TEXT | `recon_v1` for scheduled; `backfill_v1` for historical one-shots (§15) |

**`fin.reconciliation_checks` (APPEND_ONLY)** — A: `run_id`, `check_code`, `severity`, `result`, `source_query_ref`, `comparison_query_ref`. Added:

| Column | Type | Notes |
|---|---|---|
| expected_delta_units | BIGINT NOT NULL | usually 0 |
| observed_delta_units | BIGINT | `source − comparison` (NULL on `ERROR`) |
| drift_action | TEXT | ladder value applied when `result = DRIFT` |
| advisory_lock_key | TEXT NOT NULL | per-check key from §3 |

`fin.reconciliation_drift` and `fin.reconciliation_resolution` stay as A specified.

<!-- OPEN: `vendor_reported_usage`, `vendor_cost_estimates`, `vendor_actual_costs` column lists in A §11.5/§11.6 are stubs. R080–R085 assume `vendor_id`, `period_key`, `quantity_units`, `amount_minor`, `currency`, `vendor_usage_event_id`. Agent A fills the stubs; do not invent a parallel vendor table. -->

---

## 2. Drift resolution ladder (A §12.6)

Actions are **escalating and sticky**. A greener later run does not auto-clear a block; a human (or two-admin, §H) writes `reconciliation_resolution` and, if the action froze issuance or close, an `approval_requests` row.

| Rank | `action` | What the control plane does | Typical severity |
|---|---|---|---|
| 1 | `WARN` | Insert drift + exception queue. Issuance, capture, invoice, close continue. | `LOW` |
| 2 | `BLOCK_NEW_ISSUANCE` | `account_controls.allow_grants = false` and `allow_purchases = false` on the affected **tenant** (subject_type `TENANT`). Existing OPEN holds may still capture/void. | `MEDIUM` |
| 3 | `BLOCK_AFFECTED_HOLDER` | Same flags plus `allow_prepaid_usage = false` / `allow_postpaid_usage = false` on the **holder**. Authorize returns `CONTROL_DENY`. | `HIGH` |
| 4 | `BLOCK_AFFECTED_BOOK` | Freeze the book: no new `ledger_transactions` except `ADJUSTMENT` with `economic_source_type = 'RECONCILIATION'` and an approved override. | `HIGH` / `CRITICAL` |
| 5 | `BLOCK_BILLING_CLOSE` | `billing_periods` cannot leave `RATING_CLOSED`; `accounting_periods` cannot enter `SOFT_CLOSED` or `HARD_CLOSED`. Highest halt. | `CRITICAL` |

Ladder rules:

1. A check declares its **ceiling**. The runner applies that action on `DRIFT`; it never skips a rank.
2. Multiple drifts on the same subject take the **max** rank still in force.
3. `ERROR` (query failed) is `WARN` plus page-on-call; it is not a silent green. Swallowing is banned (audit A-2 class).
4. `LIVE` and `TEST` never share a run (`scope` includes `environment`). A TEST drift cannot block a LIVE book.
5. Clearing a rank ≥ 3 requires `approval_requests.action_kind = 'RECONCILIATION_OVERRIDE'` (A §9.0 / §12.1).

`account_controls.reason_code` values reserved for the runner: `RECON_R00x_<check_code>`.

---

## 3. Scheduling and advisory locks

### 3.1 Schedules

| `schedule_kind` | When | Check set | Scope |
|---|---|---|---|
| `DAILY` | 02:00 in each `platform_legal_entities` billing timezone (BusinessClock). Platform-wide sweep at 00:30 UTC. | All implemented codes for the current stage (R001–R023 from Stage 1; later stages append their range). | `environment` + optional `legal_entity_id` |
| `PER_CLOSE` | Same DB transaction as the close command **after** the status write, before COMMIT, as a deferred assertion **or** immediately after COMMIT via outbox topic `recon.per_close` (Agent C owns the outbox drain). | Close-gated subset: R001–R007, R016, R040–R044, R060–R073. | `billing_period_id` and/or `accounting_period_id` |
| `ON_DEMAND` | Admin / worker. `requireElevated` at the HTTP edge (H §5). | Any listed code, optionally filtered. | caller-supplied |

Historical reconstructions (§15) are `ON_DEMAND` with `source_system = 'backfill_v1'`. They are not on the daily schedule.

### 3.2 Advisory-lock key

One lock per **(check_code, environment, scope-id)**. Two-int `pg_advisory_lock` (same shape as `renewal-scanner.js`):

```
lock_key = 'fin.recon.' || check_code || '.' || environment || '.' || coalesce(scope_id::text, 'platform')
pg_advisory_lock( hashtext('fin.recon.' || check_code), hashtext(environment || ':' || coalesce(scope_id::text, 'platform')) )
```

`scope_id` is `legal_entity_id` (daily / accounting close), `billing_period_id` (billing close), or `book_id` when a check is book-scoped. The runner holds the lock for the duration of that check only — not the whole suite — so R001 on book A cannot stall R070 on another legal entity.

A second runner that cannot take the lock records `result = 'ERROR'`, `last_error_code = 'RECON_LOCK_HELD'`, and exits that check. It does not skip the rest of the suite.

### 3.3 Runner contract

`fin.reconciliation/runner` (Stage 1 module name in the plan) is the only writer of `reconciliation_*`. App role grants: see H §2. Each check:

1. `pg_advisory_lock` on its key.
2. Run `source_query` and `comparison_query` inside **one** read-only transaction (`default_transaction_read_only = on` or a role that cannot INSERT economic tables).
3. `observed_delta_units = source − comparison` (both coerced to `BIGINT`; a NULL side is `ERROR`, not 0).
4. Insert `reconciliation_checks`. On mismatch, insert `reconciliation_drift` per entity and apply `drift_action`.
5. Unlock.

Metric: `wingcaster_recon_check_total{check_code,result}`. Alarm on `ERROR` or `DRIFT` with severity ≥ `HIGH` (handover §3.1: if the metric is not scraped, the check is theatre).

---

## 4. Invariants the suite is required to prove

These are the plan / user invariants. Each maps to one or more codes.

| Invariant | Codes | Statement against A columns |
|---|---|---|
| I-01 conservation | R001 | `SUM(ledger_postings.amount_units) = 0` per `transaction_id` |
| I-02 book containment | R002 | `posting.book_id = tx.book_id AND account.book_id = posting.book_id` |
| I-03 book conservation | R003 | `SUM(account_balances.balance_units) = 0` per `book_id` |
| Balance cache | R004, R005 | `SUM(postings.amount_units) = account_balances.balance_units`; `last_posting_id` is the latest posting |
| Lot remaining | R006, R007 | `lots.remaining_units = lots.granted_units + SUM(lot_allocations.units)` (draws stored negative, A §5.3) |
| Payment cap | R071, R072 | `SUM(payment_allocations.amount_minor) ≤ invoices.total_minor` (and the 10.7 twin) |
| Tax freeze | R073 | `tax_snapshots` frozen ≡ `invoice_tax_lines` after ISSUE |
| Accounting vs ledger | R060, R061 | `SUM(accounting_events.amount_minor)` by `accounting_period_id` ≡ period-stamped economic sources (see R060) |

---

## 5. Check-pair contract

Every row below is executable against the Stage-N schema. `source_query` is the **derived / cache / claimed** side. `comparison_query` is the **append-only reconstruction**. `expected_delta_units` is `source − comparison`.

Predicates common to every query (omitted from the SQL for space, **required in the implementation**):

```sql
AND x.environment = :environment
-- and, when the table has tenant_id / legal_entity_id and the run is scoped:
AND x.tenant_id = :tenant_id          -- if scoped
AND le.id = :legal_entity_id          -- if scoped
```

`ERROR` if the check's tables are not yet migrated (stages 2–13). Daily runner skips unborn codes with `result = 'ERROR'`, `error_code = 'CHECK_NOT_INSTALLED'` — not green.

---

## 6. R001–R023 — Stage 1 foundation (ledger, lots, holds, isolation)

Owning implementation: Stage 1 (`reconciliation/checks/R001_transaction_conservation.js` and siblings). Holds that need `fin.holds` (migration 105 + Stage 6 columns) are specified now; Stage 1 ships R001–R019; R020–R023 go green in Stage 6 (plan).

### R001 — I-01 transaction conservation

| Field | Value |
|---|---|
| check_code | `R001` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT t.id AS entity_id, 0::bigint AS qty FROM fin.ledger_transactions t` |
| comparison_query | `SELECT p.transaction_id AS entity_id, SUM(p.amount_units)::bigint AS qty FROM fin.ledger_postings p GROUP BY p.transaction_id` |

Drift row per `transaction_id` where comparison ≠ 0. A transaction with zero postings is also drift (empty is not conserved).

### R002 — I-02 book containment

| Field | Value |
|---|---|
| check_code | `R002` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_BOOK` |
| source_query | `SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p` |
| comparison_query | `SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p JOIN fin.ledger_transactions t ON t.id = p.transaction_id JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE p.book_id = t.book_id AND a.book_id = p.book_id` |

`source − comparison` = count of illegal postings. DL-012: a `CLEARING` account does **not** exempt a second book.

### R003 — I-03 book conservation

| Field | Value |
|---|---|
| check_code | `R003` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_BOOK` |
| source_query | `SELECT b.id AS entity_id, 0::bigint AS qty FROM fin.ledger_books b` |
| comparison_query | `SELECT a.book_id AS entity_id, SUM(ab.balance_units)::bigint AS qty FROM fin.ledger_accounts a JOIN fin.account_balances ab ON ab.account_id = a.id GROUP BY a.book_id` |

### R004 — Balance cache ≡ SUM(postings)

| Field | Value |
|---|---|
| check_code | `R004` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_BOOK` |
| source_query | `SELECT ab.account_id AS entity_id, ab.balance_units AS qty FROM fin.account_balances ab` |
| comparison_query | `SELECT p.account_id AS entity_id, SUM(p.amount_units)::bigint AS qty FROM fin.ledger_postings p GROUP BY p.account_id` |

Missing cache row for an account that has postings is drift (LEFT-join in the runner; treat missing source as 0 only after inserting a drift of type `CACHE_MISSING`).

### R005 — `last_posting_id` is the latest posting

| Field | Value |
|---|---|
| check_code | `R005` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_NEW_ISSUANCE` |
| source_query | `SELECT ab.account_id AS entity_id, 1::bigint AS qty FROM fin.account_balances ab` |
| comparison_query | `SELECT ab.account_id AS entity_id, 1::bigint AS qty FROM fin.account_balances ab JOIN fin.ledger_postings p ON p.id = ab.last_posting_id AND p.account_id = ab.account_id WHERE p.created_at = (SELECT MAX(p2.created_at) FROM fin.ledger_postings p2 WHERE p2.account_id = ab.account_id)` |

### R006 — Lot remaining ≡ granted + SUM(allocations)

| Field | Value |
|---|---|
| check_code | `R006` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT l.id AS entity_id, l.remaining_units AS qty FROM fin.lots l` |
| comparison_query | `SELECT l.id AS entity_id, (l.granted_units + COALESCE((SELECT SUM(a.units) FROM fin.lot_allocations a WHERE a.lot_id = l.id), 0))::bigint AS qty FROM fin.lots l` |

A §5.3: draws are negative `units`. This is the named lot invariant.

### R007 — Lot remaining in `[0, granted_units]`

| Field | Value |
|---|---|
| check_code | `R007` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT l.id AS entity_id, 1::bigint AS qty FROM fin.lots l` |
| comparison_query | `SELECT l.id AS entity_id, 1::bigint AS qty FROM fin.lots l WHERE l.remaining_units >= 0 AND l.remaining_units <= l.granted_units` |

### R008 — Every allocation points at a real posting on the same lot's book

| Field | Value |
|---|---|
| check_code | `R008` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_BOOK` |
| source_query | `SELECT a.id AS entity_id, 1::bigint AS qty FROM fin.lot_allocations a` |
| comparison_query | `SELECT a.id AS entity_id, 1::bigint AS qty FROM fin.lot_allocations a JOIN fin.ledger_postings p ON p.id = a.posting_id JOIN fin.lots l ON l.id = a.lot_id WHERE p.lot_id = a.lot_id AND p.book_id = l.book_id` |

### R009 — Allocation units match the posting amount when `posting.lot_id` is set

| Field | Value |
|---|---|
| check_code | `R009` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_BOOK` |
| source_query | `SELECT p.id AS entity_id, p.amount_units AS qty FROM fin.ledger_postings p WHERE p.lot_id IS NOT NULL` |
| comparison_query | `SELECT a.posting_id AS entity_id, a.units AS qty FROM fin.lot_allocations a` |

Sign convention: the allocation `units` equal the lot-touching posting's `amount_units` (UNIQUE `(posting_id, lot_id)`).

### R010 — OPEN hold has `authorize_tx_id`

| Field | Value |
|---|---|
| check_code | `R010` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h WHERE h.status = 'OPEN'` |
| comparison_query | `SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h WHERE h.status = 'OPEN' AND h.authorize_tx_id IS NOT NULL` |

### R011 — CAPTURED hold has `capture_tx_id`; VOIDED/EXPIRED has `release_tx_id`

| Field | Value |
|---|---|
| check_code | `R011` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h WHERE h.status IN ('CAPTURED','VOIDED','EXPIRED')` |
| comparison_query | `SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h WHERE (h.status = 'CAPTURED' AND h.capture_tx_id IS NOT NULL) OR (h.status IN ('VOIDED','EXPIRED') AND h.release_tx_id IS NOT NULL)` |

### R012 — HOLD-shape uniqueness (DL-014)

| Field | Value |
|---|---|
| check_code | `R012` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_BOOK` |
| source_query | `SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h WHERE h.authorize_tx_id IS NOT NULL` |
| comparison_query | `SELECT h.id AS entity_id, 1::bigint AS qty FROM fin.holds h JOIN fin.ledger_transactions t ON t.id = h.authorize_tx_id AND t.shape = 'HOLD' AND t.economic_source_type = 'HOLD' AND t.economic_source_id = h.id` |

### R013 — Pair integrity (DL-025): exactly two TRANSFER txs per `pair_id`

| Field | Value |
|---|---|
| check_code | `R013` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_BOOK` |
| source_query | `SELECT t.pair_id AS entity_id, 2::bigint AS qty FROM fin.ledger_transactions t WHERE t.pair_id IS NOT NULL GROUP BY t.pair_id` |
| comparison_query | `SELECT t.pair_id AS entity_id, COUNT(*)::bigint AS qty FROM fin.ledger_transactions t WHERE t.pair_id IS NOT NULL GROUP BY t.pair_id` |

### R014 — `pair_id` only on `shape = TRANSFER`

| Field | Value |
|---|---|
| check_code | `R014` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_BOOK` |
| source_query | `SELECT t.id AS entity_id, 1::bigint AS qty FROM fin.ledger_transactions t WHERE t.pair_id IS NOT NULL` |
| comparison_query | `SELECT t.id AS entity_id, 1::bigint AS qty FROM fin.ledger_transactions t WHERE t.pair_id IS NOT NULL AND t.shape = 'TRANSFER'` |

### R015 — Cross-currency pair-leg stamps `fx_rate_snapshot_id` (DL-015 / DL-026)

| Field | Value |
|---|---|
| check_code | `R015` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_BOOK` |
| source_query | `SELECT t.id AS entity_id, 1::bigint AS qty FROM fin.ledger_transactions t WHERE t.pair_id IS NOT NULL` |
| comparison_query | `SELECT t.id AS entity_id, 1::bigint AS qty FROM fin.ledger_transactions t JOIN fin.ledger_books b ON b.id = t.book_id JOIN fin.ledger_transactions t2 ON t2.pair_id = t.pair_id AND t2.id <> t.id JOIN fin.ledger_books b2 ON b2.id = t2.book_id WHERE t.fx_rate_snapshot_id IS NOT NULL OR b.currency = b2.currency` |

### R016 — Environment isolation on postings (I-17)

| Field | Value |
|---|---|
| check_code | `R016` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p` |
| comparison_query | `SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p JOIN fin.ledger_transactions t ON t.id = p.transaction_id JOIN fin.ledger_books b ON b.id = p.book_id JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE p.environment = t.environment AND p.environment = b.environment AND p.environment = a.environment` |

### R017 — TEST row cannot belong to a LIVE book (and the reverse)

| Field | Value |
|---|---|
| check_code | `R017` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT l.id AS entity_id, 1::bigint AS qty FROM fin.lots l` |
| comparison_query | `SELECT l.id AS entity_id, 1::bigint AS qty FROM fin.lots l JOIN fin.ledger_books b ON b.id = l.book_id WHERE l.environment = b.environment AND l.tenant_id = b.tenant_id` |

### R018 — Seven account types per book, no eighth

| Field | Value |
|---|---|
| check_code | `R018` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT b.id AS entity_id, 7::bigint AS qty FROM fin.ledger_books b` |
| comparison_query | `SELECT a.book_id AS entity_id, COUNT(*)::bigint AS qty FROM fin.ledger_accounts a GROUP BY a.book_id` |

### R019 — FX rounding residual is an ADJUSTMENT on the destination tx

| Field | Value |
|---|---|
| check_code | `R019` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE a.account_type = 'ADJUSTMENT' AND p.fx_rate_snapshot_id IS NOT NULL` |
| comparison_query | `SELECT p.id AS entity_id, 1::bigint AS qty FROM fin.ledger_postings p JOIN fin.ledger_transactions t ON t.id = p.transaction_id JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE a.account_type = 'ADJUSTMENT' AND t.reason_code = 'FX_ROUNDING'` |

### R020 — OPEN hold units ≡ net HELD postings of `authorize_tx_id`

| Field | Value |
|---|---|
| check_code | `R020` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT h.id AS entity_id, h.units AS qty FROM fin.holds h WHERE h.status = 'OPEN'` |
| comparison_query | `SELECT h.id AS entity_id, SUM(p.amount_units) FILTER (WHERE a.account_type = 'HELD')::bigint AS qty FROM fin.holds h JOIN fin.ledger_postings p ON p.transaction_id = h.authorize_tx_id JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE h.status = 'OPEN' GROUP BY h.id` |

Stage 6 exit.

### R021 — CAPTURE does not exceed the authorized hold

| Field | Value |
|---|---|
| check_code | `R021` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT h.id AS entity_id, h.units AS qty FROM fin.holds h WHERE h.status = 'CAPTURED'` |
| comparison_query | `SELECT h.id AS entity_id, ABS(SUM(p.amount_units)) FILTER (WHERE a.account_type = 'CONSUMED')::bigint AS qty FROM fin.holds h JOIN fin.ledger_postings p ON p.transaction_id = h.capture_tx_id JOIN fin.ledger_accounts a ON a.id = p.account_id WHERE h.status = 'CAPTURED' GROUP BY h.id` |

Comparison must be `<=` source. Runner treats `observed_delta_units < 0` (capture > hold) as drift; `> 0` is a partial capture and is green iff Agent B allows partials — <!-- OPEN: Agent B must confirm whether CAPTURE may be partial. Until then this check requires equality. -->

### R022 — `limit_counters.consumed_units` ≡ SUM of in-period authorized/captured units for that limit

| Field | Value |
|---|---|
| check_code | `R022` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_NEW_ISSUANCE` |
| source_query | `SELECT c.id AS entity_id, c.consumed_units AS qty FROM fin.limit_counters c` |
| comparison_query | `SELECT c.id AS entity_id, COALESCE(SUM(h.units),0)::bigint AS qty FROM fin.limit_counters c JOIN fin.usage_limits ul ON ul.id = c.usage_limit_id JOIN fin.holds h ON h.billing_account_id IN (SELECT ba.id FROM fin.billing_accounts ba JOIN fin.contract_components cc ON cc.id = ul.contract_component_id /* holder walk owned by Stage 6 */) AND h.status IN ('OPEN','CAPTURED') AND h.created_at IS NOT NULL GROUP BY c.id` |

<!-- OPEN: A does not put `usage_limit_id` on holds. Stage 6 must either stamp it or derive via contract_component → meter → rated_usage. Do not invent `holds.usage_limit_id` until that stage appends a DL row. -->

### R023 — AVAILABLE cache is non-negative unless an OPEN facility reservation covers the deficit

| Field | Value |
|---|---|
| check_code | `R023` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT ab.account_id AS entity_id, ab.balance_units AS qty FROM fin.account_balances ab JOIN fin.ledger_accounts a ON a.id = ab.account_id WHERE a.account_type = 'AVAILABLE'` |
| comparison_query | `SELECT ab.account_id AS entity_id, GREATEST(ab.balance_units, 0)::bigint + COALESCE((SELECT SUM(fr.reserved_minor) FROM fin.facility_reservations fr JOIN fin.credit_facilities cf ON cf.id = fr.facility_id JOIN fin.ledger_books b ON b.billing_account_id = cf.billing_account_id AND b.id = a.book_id WHERE fr.status = 'OPEN' AND cf.status = 'ACTIVE'), 0) AS qty FROM fin.account_balances ab JOIN fin.ledger_accounts a ON a.id = ab.account_id WHERE a.account_type = 'AVAILABLE'` |

I-08. Facility cover is money (`*_minor`); lot books are units. Runner applies this check only to books whose `book_type IN ('CUSTOMER','RESELLER')` and whose currency matches the facility. <!-- OPEN: unit/money join across AVAILABLE (units) and `reserved_minor` (money) is Stage 8. Until then R023 flags `balance_units < 0` with no facility as drift and skips the money addend. -->

---

## 7. R024–R029 — Foundation extensions (Stage 1, same PR as R001–R019)

### R024 — ISSUANCE + CONSUMED + EXPIRED + ADJUSTMENT + CLEARING + AVAILABLE + HELD = 0 (restates R003 per account_type)

| Field | Value |
|---|---|
| check_code | `R024` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_BOOK` |
| source_query | `SELECT a.book_id AS entity_id, 0::bigint AS qty FROM fin.ledger_accounts a GROUP BY a.book_id` |
| comparison_query | `SELECT a.book_id AS entity_id, SUM(ab.balance_units)::bigint AS qty FROM fin.ledger_accounts a JOIN fin.account_balances ab ON ab.account_id = a.id GROUP BY a.book_id` |

### R025 — EXPIRY tx exists for every `lots.status = 'EXPIRED'` with `remaining_units` moved to EXPIRED

| Field | Value |
|---|---|
| check_code | `R025` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT l.id AS entity_id, 1::bigint AS qty FROM fin.lots l WHERE l.status = 'EXPIRED'` |
| comparison_query | `SELECT l.id AS entity_id, 1::bigint AS qty FROM fin.lots l JOIN fin.ledger_transactions t ON t.economic_source_type = 'LOT' AND t.economic_source_id = l.id AND t.shape = 'EXPIRY' WHERE l.status = 'EXPIRED'` |

### R026 — EXHAUSTED lot has `remaining_units = 0`

| Field | Value |
|---|---|
| check_code | `R026` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT l.id AS entity_id, l.remaining_units AS qty FROM fin.lots l WHERE l.status = 'EXHAUSTED'` |
| comparison_query | `SELECT l.id AS entity_id, 0::bigint AS qty FROM fin.lots l WHERE l.status = 'EXHAUSTED'` |

### R027 — UNIQUE FUNDING/GRANT/MIGRATE per source (DL-014)

| Field | Value |
|---|---|
| check_code | `R027` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_NEW_ISSUANCE` |
| source_query | `SELECT t.economic_source_id AS entity_id, 1::bigint AS qty FROM fin.ledger_transactions t WHERE t.shape IN ('FUNDING','GRANT','MIGRATE','DIRECT_SPEND','EXPIRY','HOLD','VOID','CAPTURE') GROUP BY t.environment, t.economic_source_type, t.economic_source_id, t.shape` |
| comparison_query | `SELECT t.economic_source_id AS entity_id, COUNT(*)::bigint AS qty FROM fin.ledger_transactions t WHERE t.shape IN ('FUNDING','GRANT','MIGRATE','DIRECT_SPEND','EXPIRY','HOLD','VOID','CAPTURE') GROUP BY t.environment, t.economic_source_type, t.economic_source_id, t.shape` |

### R028 — `funding_relationships` endpoints share environment + tenant

| Field | Value |
|---|---|
| check_code | `R028` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT f.id AS entity_id, 1::bigint AS qty FROM fin.funding_relationships f` |
| comparison_query | `SELECT f.id AS entity_id, 1::bigint AS qty FROM fin.funding_relationships f JOIN fin.holders hf ON hf.id = f.from_holder_id JOIN fin.holders ht ON ht.id = f.to_holder_id WHERE hf.environment = f.environment AND ht.environment = f.environment AND hf.tenant_id = f.tenant_id AND ht.tenant_id = f.tenant_id` |

### R029 — `account_controls` unique per `(environment, subject_type, subject_id)` and reason non-empty

| Field | Value |
|---|---|
| check_code | `R029` |
| severity | `LOW` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT c.id AS entity_id, 1::bigint AS qty FROM fin.account_controls c` |
| comparison_query | `SELECT c.id AS entity_id, 1::bigint AS qty FROM fin.account_controls c WHERE c.reason_code <> ''` |

---

## 8. R030–R039 — Usage + metering (Stages 2–3)

Plan names R030–R033 as Stage 2 exit. R034–R039 close metering provenance (I-09 / I-10 / DL-009 / DL-021).

### R030 — Permanent source dedup (I-10 / DL-009)

| Field | Value |
|---|---|
| check_code | `R030` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT MIN(u.id::text)::uuid AS entity_id, 1::bigint AS qty FROM fin.usage_events u GROUP BY u.environment, u.source_system, u.source_event_id, u.residency_key` |
| comparison_query | `SELECT MIN(u.id::text)::uuid AS entity_id, COUNT(*)::bigint AS qty FROM fin.usage_events u GROUP BY u.environment, u.source_system, u.source_event_id, u.residency_key` |

### R031 — Correction/cancellation rows have composite FK to the original

| Field | Value |
|---|---|
| check_code | `R031` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_NEW_ISSUANCE` |
| source_query | `SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u WHERE u.event_kind <> 'ORIGINAL'` |
| comparison_query | `SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u JOIN fin.usage_events o ON o.id = u.corrects_event_id AND o.residency_key = u.corrects_residency_key WHERE u.event_kind <> 'ORIGINAL'` |

### R032 — `usage_events` facts have no price columns (DL-007) — schema probe

| Field | Value |
|---|---|
| check_code | `R032` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT 1 AS entity_id, 0::bigint AS qty` |
| comparison_query | `SELECT 1 AS entity_id, COUNT(*)::bigint AS qty FROM information_schema.columns WHERE table_schema = 'fin' AND table_name = 'usage_events' AND column_name IN ('price_minor','casts_charged','rate_card_version')` |

A column appearing is drift. This is how the emitUsageEvent fusion is kept dead.

### R033 — DLQ rows are either retried or dead-lettered (audit A-2)

| Field | Value |
|---|---|
| check_code | `R033` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT d.id AS entity_id, 1::bigint AS qty FROM fin.usage_events_dlq d WHERE d.dead_lettered_at IS NULL AND d.next_retry_at < :now` |
| comparison_query | `SELECT d.id AS entity_id, 0::bigint AS qty FROM fin.usage_events_dlq d WHERE d.dead_lettered_at IS NULL AND d.next_retry_at < :now` |

Any overdue open DLQ row is drift (source 1 vs comparison 0). Alarm companion: `wingcaster_usage_event_emit_total{result="drop"}`.

### R034 — `metered_usage_sources` composite FK (DL-021 / M1)

| Field | Value |
|---|---|
| check_code | `R034` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_NEW_ISSUANCE` |
| source_query | `SELECT s.usage_event_id AS entity_id, s.contribution_units AS qty FROM fin.metered_usage_sources s` |
| comparison_query | `SELECT s.usage_event_id AS entity_id, s.contribution_units AS qty FROM fin.metered_usage_sources s JOIN fin.usage_events u ON u.id = s.usage_event_id AND u.residency_key = s.residency_key` |

### R035 — SUM(source contributions) ≡ `metered_usage.quantity_units` for ACTIVE rows

| Field | Value |
|---|---|
| check_code | `R035` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_NEW_ISSUANCE` |
| source_query | `SELECT m.id AS entity_id, m.quantity_units AS qty FROM fin.metered_usage m WHERE m.status = 'ACTIVE'` |
| comparison_query | `SELECT s.metered_usage_id AS entity_id, SUM(s.contribution_units)::bigint AS qty FROM fin.metered_usage_sources s JOIN fin.metered_usage m ON m.id = s.metered_usage_id WHERE m.status = 'ACTIVE' GROUP BY s.metered_usage_id` |

ACTIVE-only join is required so SUPERSEDED provenance does not false-DRIFT (DL-067). R036 covers the chain.

### R036 — SUPERSEDED metered row has `supersedes` chain and a successor

| Field | Value |
|---|---|
| check_code | `R036` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT m.id AS entity_id, 1::bigint AS qty FROM fin.metered_usage m WHERE m.status = 'SUPERSEDED'` |
| comparison_query | `SELECT m.id AS entity_id, 1::bigint AS qty FROM fin.metered_usage m JOIN fin.metered_usage n ON n.supersedes_id = m.id WHERE m.status = 'SUPERSEDED'` |

### R037 — Meter version overlap is empty (DL-023)

| Field | Value |
|---|---|
| check_code | `R037` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_NEW_ISSUANCE` |
| source_query | `SELECT v.id AS entity_id, 0::bigint AS qty FROM fin.meter_versions v` |
| comparison_query | `SELECT v.id AS entity_id, COUNT(v2.id)::bigint AS qty FROM fin.meter_versions v JOIN fin.meter_versions v2 ON v2.meter_id = v.meter_id AND v2.id <> v.id AND tstzrange(v.effective_from, COALESCE(v.effective_to, 'infinity'::timestamptz)) && tstzrange(v2.effective_from, COALESCE(v2.effective_to, 'infinity'::timestamptz)) GROUP BY v.id` |

Empty join ⇒ comparison 0.

### R038 — `residency_key` is a live `platform_legal_entities.residency_key` or `__platform__` (DL-013)

| Field | Value |
|---|---|
| check_code | `R038` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_NEW_ISSUANCE` |
| source_query | `SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u` |
| comparison_query | `SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u WHERE u.residency_key = '__platform__' OR EXISTS (SELECT 1 FROM fin.platform_legal_entities le WHERE le.residency_key = u.residency_key)` |

### R039 — Correction cannot cross residency cells

| Field | Value |
|---|---|
| check_code | `R039` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_NEW_ISSUANCE` |
| source_query | `SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u WHERE u.event_kind <> 'ORIGINAL'` |
| comparison_query | `SELECT u.id AS entity_id, 1::bigint AS qty FROM fin.usage_events u WHERE u.event_kind <> 'ORIGINAL' AND u.residency_key = u.corrects_residency_key` |

---

## 9. R040–R049 — Rating (Stage 5)

### R040 — `rated_usage.amount_minor` reconstructs from billable units (determinism probe)

| Field | Value |
|---|---|
| check_code | `R040` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT r.id AS entity_id, r.amount_minor AS qty FROM fin.rated_usage r` |
| comparison_query | `SELECT r.id AS entity_id, r.amount_minor AS qty FROM fin.rated_usage r WHERE r.rating_hash = encode(sha256(convert_to(r.explanation::text \|\| r.price_version_id::text \|\| r.measured_units::text \|\| r.included_units::text \|\| r.billable_units::text \|\| r.amount_minor::text, 'UTF8')), 'hex')` |

<!-- OPEN: exact `rating_hash` preimage is Stage 5. Until the hasher ships, comparison is `r.rating_hash <> ''` (non-empty) and this check is WARN. Do not invent a hash column. -->

### R041 — Re-rate is a new row (`adjustment_of_id`), never an UPDATE

| Field | Value |
|---|---|
| check_code | `R041` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r WHERE r.adjustment_of_id IS NOT NULL` |
| comparison_query | `SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r JOIN fin.rated_usage o ON o.id = r.adjustment_of_id WHERE r.adjustment_of_id IS NOT NULL` |

### R042 — `late_class` matches the period state at `rated_at` (A §6.7)

| Field | Value |
|---|---|
| check_code | `R042` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r` |
| comparison_query | `SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r LEFT JOIN fin.billing_periods bp ON bp.id = r.billing_period_id LEFT JOIN fin.accounting_periods ap ON ap.id = r.accounting_period_id WHERE (r.late_class = 'OPEN_PERIOD' AND (bp.status IS NULL OR bp.status IN ('OPEN','USAGE_CLOSING'))) OR (r.late_class = 'PRE_INVOICE' AND bp.status IN ('USAGE_CLOSED','RATING_CLOSED','INVOICE_DRAFTED')) OR (r.late_class = 'POST_INVOICE' AND bp.status IN ('INVOICED','FINAL')) OR (r.late_class = 'CLOSED_ACCOUNTING' AND ap.status IN ('SOFT_CLOSED','HARD_CLOSED'))` |

G owns the booking of CLOSED_ACCOUNTING into the **open** period. This check only asserts the stamp is consistent with the period row.

### R043 — No `rated_usage` with `late_class = 'CLOSED_ACCOUNTING'` and `accounting_period.status = 'HARD_CLOSED'` as the **effective** period (must be the open successor)

| Field | Value |
|---|---|
| check_code | `R043` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r WHERE r.late_class = 'CLOSED_ACCOUNTING'` |
| comparison_query | `SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r JOIN fin.accounting_periods ap ON ap.id = r.accounting_period_id WHERE r.late_class = 'CLOSED_ACCOUNTING' AND ap.status IN ('OPEN','SOFT_CLOSED')` |

HARD_CLOSED as the stamped period is illegal (A §9.0 / G).

### R044 — Invoice line `RATED_USAGE` sources exist

| Field | Value |
|---|---|
| check_code | `R044` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT il.id AS entity_id, il.amount_minor AS qty FROM fin.invoice_lines il WHERE il.source_type = 'RATED_USAGE'` |
| comparison_query | `SELECT il.id AS entity_id, r.amount_minor AS qty FROM fin.invoice_lines il JOIN fin.rated_usage r ON r.id = il.source_id WHERE il.source_type = 'RATED_USAGE'` |

### R045 — `billable_units = measured_units − included_units` (floored at 0)

| Field | Value |
|---|---|
| check_code | `R045` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT r.id AS entity_id, r.billable_units AS qty FROM fin.rated_usage r` |
| comparison_query | `SELECT r.id AS entity_id, GREATEST(r.measured_units - r.included_units, 0)::bigint AS qty FROM fin.rated_usage r` |

### R046 — Rated currency matches the contract billing currency

| Field | Value |
|---|---|
| check_code | `R046` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r` |
| comparison_query | `SELECT r.id AS entity_id, 1::bigint AS qty FROM fin.rated_usage r JOIN fin.contract_versions cv ON cv.id = r.contract_version_id JOIN fin.contracts c ON c.id = cv.contract_id WHERE r.currency = c.billing_currency` |

<!-- OPEN: `contract_versions` does not repeat `billing_currency`; join via `contracts` is the A shape. -->

### R047 — Price-version overlap empty (DL-023)

Same shape as R037 on `fin.price_versions` (`price_id` parent). `severity HIGH`, `BLOCK_NEW_ISSUANCE`.

### R048 — Contract-version overlap empty (DL-023)

Same shape as R037 on `fin.contract_versions` (`contract_id` parent). `severity HIGH`, `BLOCK_NEW_ISSUANCE`.

### R049 — Every ACTIVE `metered_usage` in a `RATING_CLOSED`+ period has a `rated_usage` row

| Field | Value |
|---|---|
| check_code | `R049` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT m.id AS entity_id, 1::bigint AS qty FROM fin.metered_usage m JOIN fin.rated_usage r_probe ON r_probe.metered_usage_id = m.id JOIN fin.billing_periods bp ON bp.id = r_probe.billing_period_id WHERE m.status = 'ACTIVE' AND bp.status IN ('RATING_CLOSED','INVOICE_DRAFTED','INVOICED','FINAL')` |
| comparison_query | `SELECT m.id AS entity_id, 1::bigint AS qty FROM fin.metered_usage m JOIN fin.rated_usage r ON r.metered_usage_id = m.id WHERE m.status = 'ACTIVE'` |

Unrated ACTIVE usage in a closed rating window is drift (anti-join in the runner).

---

## 10. R050–R059 — Postpaid / facilities / dunning (Stage 8)

### R050 — OPEN facility reservations ≤ facility `limit_minor`

| Field | Value |
|---|---|
| check_code | `R050` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT cf.id AS entity_id, cf.limit_minor AS qty FROM fin.credit_facilities cf WHERE cf.status = 'ACTIVE'` |
| comparison_query | `SELECT fr.facility_id AS entity_id, COALESCE(SUM(fr.reserved_minor),0)::bigint AS qty FROM fin.facility_reservations fr WHERE fr.status = 'OPEN' GROUP BY fr.facility_id` |

`observed_delta_units < 0` (reserved > limit) is drift. Slack (`> 0`) is green.

### R051 — Reservation has a hold when `hold_id` is set

| Field | Value |
|---|---|
| check_code | `R051` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT fr.id AS entity_id, 1::bigint AS qty FROM fin.facility_reservations fr WHERE fr.hold_id IS NOT NULL` |
| comparison_query | `SELECT fr.id AS entity_id, 1::bigint AS qty FROM fin.facility_reservations fr JOIN fin.holds h ON h.id = fr.hold_id WHERE fr.hold_id IS NOT NULL` |

### R052 — RECEIVABLE_CREATED events exist for ISSUED invoices that used the facility

| Field | Value |
|---|---|
| check_code | `R052` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT i.id AS entity_id, i.total_minor AS qty FROM fin.invoices i WHERE i.status IN ('ISSUED','PART_PAID','PAID','UNCOLLECTIBLE')` |
| comparison_query | `SELECT ae.source_id AS entity_id, ae.amount_minor AS qty FROM fin.accounting_events ae WHERE ae.event_type = 'RECEIVABLE_CREATED' AND ae.source_type = 'INVOICE'` |

Stage 9/10; green only after both land. See G for the policy input.

### R053 — Dunning case for every ISSUED invoice past `due_at` with `status <> 'PAID'`

| Field | Value |
|---|---|
| check_code | `R053` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT i.id AS entity_id, 1::bigint AS qty FROM fin.invoices i WHERE i.status IN ('ISSUED','PART_PAID') AND i.due_at < :now` |
| comparison_query | `SELECT i.id AS entity_id, 1::bigint AS qty FROM fin.invoices i JOIN fin.dunning_cases d ON d.invoice_id = i.id WHERE i.status IN ('ISSUED','PART_PAID') AND i.due_at < :now` |

### R054 — CLOSED facility has no OPEN reservations

| Field | Value |
|---|---|
| check_code | `R054` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT cf.id AS entity_id, 0::bigint AS qty FROM fin.credit_facilities cf WHERE cf.status = 'CLOSED'` |
| comparison_query | `SELECT fr.facility_id AS entity_id, COUNT(*)::bigint AS qty FROM fin.facility_reservations fr JOIN fin.credit_facilities cf ON cf.id = fr.facility_id WHERE cf.status = 'CLOSED' AND fr.status = 'OPEN' GROUP BY fr.facility_id` |

### R055 — Dispute amount ≤ payment amount

| Field | Value |
|---|---|
| check_code | `R055` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT d.id AS entity_id, d.amount_minor AS qty FROM fin.disputes d` |
| comparison_query | `SELECT d.id AS entity_id, p.amount_minor AS qty FROM fin.disputes d JOIN fin.payments p ON p.id = d.payment_id` |

Drift when source > comparison.

### R056 — LOST dispute has a REVERSED payment or an ADJUSTMENT tx

| Field | Value |
|---|---|
| check_code | `R056` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_BOOK` |
| source_query | `SELECT d.id AS entity_id, 1::bigint AS qty FROM fin.disputes d WHERE d.status = 'LOST'` |
| comparison_query | `SELECT d.id AS entity_id, 1::bigint AS qty FROM fin.disputes d JOIN fin.payments p ON p.id = d.payment_id WHERE d.status = 'LOST' AND (p.status = 'REVERSED' OR EXISTS (SELECT 1 FROM fin.ledger_transactions t WHERE t.economic_source_type = 'INVOICE' AND t.shape = 'ADJUSTMENT' AND t.economic_source_id = d.invoice_id))` |

### R057 — Purchase intent PAID has a FUNDING tx

| Field | Value |
|---|---|
| check_code | `R057` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_NEW_ISSUANCE` |
| source_query | `SELECT pi.id AS entity_id, 1::bigint AS qty FROM fin.purchase_intents pi WHERE pi.status = 'PAID'` |
| comparison_query | `SELECT pi.id AS entity_id, 1::bigint AS qty FROM fin.purchase_intents pi JOIN fin.ledger_transactions t ON t.economic_source_type = 'PURCHASE_INTENT' AND t.economic_source_id = pi.id AND t.shape = 'FUNDING' WHERE pi.status = 'PAID'` |

### R058 — Bonus lots have `consideration_minor = 0` (A §5.1)

| Field | Value |
|---|---|
| check_code | `R058` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT l.id AS entity_id, l.consideration_minor AS qty FROM fin.lots l WHERE l.source_kind IN ('PROMOTIONAL_GRANT','COMPENSATION')` |
| comparison_query | `SELECT l.id AS entity_id, 0::bigint AS qty FROM fin.lots l WHERE l.source_kind IN ('PROMOTIONAL_GRANT','COMPENSATION')` |

### R059 — `unapplied_cash.amount_minor` ≡ payments − allocations (A §10.11)

| Field | Value |
|---|---|
| check_code | `R059` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT u.billing_account_id AS entity_id, u.amount_minor AS qty FROM fin.unapplied_cash u` |
| comparison_query | `SELECT p.billing_account_id AS entity_id, (COALESCE(SUM(p.amount_minor) FILTER (WHERE p.status IN ('RECEIVED','ALLOCATED')),0) - COALESCE((SELECT SUM(pa.amount_minor) FROM fin.payment_allocations pa JOIN fin.payments p2 ON p2.id = pa.payment_id WHERE p2.billing_account_id = p.billing_account_id),0))::bigint AS qty FROM fin.payments p GROUP BY p.billing_account_id` |

---

## 11. R060–R069 — Accounting (Stage 9). Closes the “events ≡ postings by period” invariant.

Monetary events (`*_minor`) are **not** the same integer space as lot `amount_units`. R060 states the accepted equivalence: **by `accounting_period_id` + `currency` + `legal_entity_id`**, the signed sum of `accounting_events.amount_minor` equals the signed sum of the **economic sources those events cite**, not a raw SUM of `ledger_postings.amount_units` (those are units, often a different currency book).

### R060 — Accounting events sum by period ≡ cited source amounts by period

| Field | Value |
|---|---|
| check_code | `R060` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT ae.accounting_period_id AS entity_id, SUM(ae.amount_minor)::bigint AS qty FROM fin.accounting_events ae GROUP BY ae.accounting_period_id, ae.currency, ae.legal_entity_id` |
| comparison_query | See box below |

Comparison is the union of source reconstructions (same grouping):

```sql
-- invoices (RECEIVABLE_CREATED / TAX_ACCRUED / CONSIDERATION_ALLOCATED cite INVOICE)
SELECT i.legal_entity_id, /* period from ae join */ SUM(i.total_minor)
-- rated_usage (REVENUE_RECOGNIZED cites RATED_USAGE)
SELECT r.accounting_period_id, SUM(r.amount_minor)
-- lots EXPIRY (BREAKAGE_RECOGNIZED cites LOT)
SELECT l.id, l.consideration_minor * remaining_at_expiry / NULLIF(l.granted_units,0)
```

The runner implements the union in `R060_period_equivalence.js`. A period with events and no sources (or the reverse) is drift.

### R061 — No `accounting_events` row on a HARD_CLOSED period (A §9.0 / DL-016)

| Field | Value |
|---|---|
| check_code | `R061` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT ae.id AS entity_id, 1::bigint AS qty FROM fin.accounting_events ae` |
| comparison_query | `SELECT ae.id AS entity_id, 1::bigint AS qty FROM fin.accounting_events ae JOIN fin.accounting_periods ap ON ap.id = ae.accounting_period_id WHERE ap.status IN ('OPEN','SOFT_CLOSED')` |

A HARD_CLOSED insert is a trigger reject at write time (G §4); this check is the detective control if the trigger is dropped.

### R062 — `effective_at` falls inside the period window

| Field | Value |
|---|---|
| check_code | `R062` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT ae.id AS entity_id, 1::bigint AS qty FROM fin.accounting_events ae` |
| comparison_query | `SELECT ae.id AS entity_id, 1::bigint AS qty FROM fin.accounting_events ae JOIN fin.accounting_periods ap ON ap.id = ae.accounting_period_id WHERE ae.effective_at >= ap.starts_at AND ae.effective_at < ap.ends_at` |

### R063 — `policy_version` is non-empty and matches a known pin (G §1)

| Field | Value |
|---|---|
| check_code | `R063` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT ae.id AS entity_id, 1::bigint AS qty FROM fin.accounting_events ae` |
| comparison_query | `SELECT ae.id AS entity_id, 1::bigint AS qty FROM fin.accounting_events ae WHERE ae.policy_version <> ''` |

### R064 — Allocation group sums to the parent CONSIDERATION_ALLOCATED event

| Field | Value |
|---|---|
| check_code | `R064` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT g.accounting_event_id AS entity_id, SUM(g.amount_minor)::bigint AS qty FROM fin.revenue_allocation_groups g GROUP BY g.accounting_event_id` |
| comparison_query | `SELECT ae.id AS entity_id, ae.amount_minor AS qty FROM fin.accounting_events ae WHERE ae.event_type = 'CONSIDERATION_ALLOCATED'` |

### R065 — Allocation lines sum to their group (ASC 606)

| Field | Value |
|---|---|
| check_code | `R065` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT l.group_id AS entity_id, SUM(l.amount_minor)::bigint AS qty FROM fin.revenue_allocation_lines l GROUP BY l.group_id` |
| comparison_query | `SELECT g.id AS entity_id, g.amount_minor AS qty FROM fin.revenue_allocation_groups g` |

### R066 — BREAKAGE_RECOGNIZED cites an EXPIRED lot and an EXPIRY tx

| Field | Value |
|---|---|
| check_code | `R066` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT ae.id AS entity_id, 1::bigint AS qty FROM fin.accounting_events ae WHERE ae.event_type = 'BREAKAGE_RECOGNIZED'` |
| comparison_query | `SELECT ae.id AS entity_id, 1::bigint AS qty FROM fin.accounting_events ae JOIN fin.lots l ON l.id = ae.source_id JOIN fin.ledger_transactions t ON t.economic_source_type = 'LOT' AND t.economic_source_id = l.id AND t.shape = 'EXPIRY' WHERE ae.event_type = 'BREAKAGE_RECOGNIZED' AND ae.source_type = 'LOT' AND l.status = 'EXPIRED'` |

### R067 — BAD_DEBT_WRITE_OFF cites an UNCOLLECTIBLE invoice and an approval

| Field | Value |
|---|---|
| check_code | `R067` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT ae.id AS entity_id, 1::bigint AS qty FROM fin.accounting_events ae WHERE ae.event_type = 'BAD_DEBT_WRITE_OFF'` |
| comparison_query | `SELECT ae.id AS entity_id, 1::bigint AS qty FROM fin.accounting_events ae JOIN fin.invoices i ON i.id = ae.source_id WHERE ae.event_type = 'BAD_DEBT_WRITE_OFF' AND i.status = 'UNCOLLECTIBLE'` |

### R068 — TAX_ACCRUED ≡ invoice.tax_minor for the cited invoice

| Field | Value |
|---|---|
| check_code | `R068` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT ae.source_id AS entity_id, ae.amount_minor AS qty FROM fin.accounting_events ae WHERE ae.event_type = 'TAX_ACCRUED'` |
| comparison_query | `SELECT i.id AS entity_id, i.tax_minor AS qty FROM fin.invoices i WHERE i.status IN ('ISSUED','PART_PAID','PAID','UNCOLLECTIBLE')` |

### R069 — DEFERRED_REVENUE_CREATED for every PAID purchase that created a lot with `consideration_minor > 0`

| Field | Value |
|---|---|
| check_code | `R069` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT l.id AS entity_id, l.consideration_minor AS qty FROM fin.lots l WHERE l.consideration_minor > 0 AND l.source_kind IN ('PURCHASE','SUBSCRIPTION_GRANT')` |
| comparison_query | `SELECT ae.source_id AS entity_id, ae.amount_minor AS qty FROM fin.accounting_events ae WHERE ae.event_type = 'DEFERRED_REVENUE_CREATED' AND ae.source_type = 'LOT'` |

---

## 12. R070–R079 — Billing / cash / tax freeze (Stage 10)

### R070 — Invoice header identity: `subtotal_minor + tax_minor = total_minor`

| Field | Value |
|---|---|
| check_code | `R070` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT i.id AS entity_id, i.total_minor AS qty FROM fin.invoices i` |
| comparison_query | `SELECT i.id AS entity_id, (i.subtotal_minor + i.tax_minor)::bigint AS qty FROM fin.invoices i` |

### R071 — `payment_allocations` SUM ≤ `invoices.total_minor` (A §10.10)

| Field | Value |
|---|---|
| check_code | `R071` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT i.id AS entity_id, i.total_minor AS qty FROM fin.invoices i WHERE i.status <> 'VOID'` |
| comparison_query | `SELECT pa.invoice_id AS entity_id, COALESCE(SUM(pa.amount_minor),0)::bigint AS qty FROM fin.payment_allocations pa GROUP BY pa.invoice_id` |

Drift when comparison > source (`observed_delta_units < 0`). Slack is green.

### R072 — `invoice_payment_allocations` twin (A §10.7) matches §10.10

| Field | Value |
|---|---|
| check_code | `R072` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT pa.invoice_id AS entity_id, SUM(pa.amount_minor)::bigint AS qty FROM fin.payment_allocations pa GROUP BY pa.invoice_id` |
| comparison_query | `SELECT ipa.invoice_id AS entity_id, SUM(ipa.amount_minor)::bigint AS qty FROM fin.invoice_payment_allocations ipa GROUP BY ipa.invoice_id` |

A reserved both tables. They are the same fact from payment-side and invoice-side. Divergence is drift.

### R073 — Frozen `tax_snapshots` ≡ `invoice_tax_lines`

| Field | Value |
|---|---|
| check_code | `R073` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT ts.invoice_id AS entity_id, SUM(ts.tax_minor)::bigint AS qty FROM fin.tax_snapshots ts GROUP BY ts.invoice_id` |
| comparison_query | `SELECT itl.invoice_id AS entity_id, SUM(itl.tax_minor)::bigint AS qty FROM fin.invoice_tax_lines itl GROUP BY itl.invoice_id` |

Also assert per-line: `itl.tax_snapshot_id` exists, `itl.vat_bps = ts.vat_bps`, `itl.tax_treatment = ts.tax_treatment`, `itl.jurisdiction = ts.jurisdiction`. Runner emits one drift row per mismatched snapshot.

### R074 — Invoice lines sum to `subtotal_minor` (no sourceless lines)

| Field | Value |
|---|---|
| check_code | `R074` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT i.id AS entity_id, i.subtotal_minor AS qty FROM fin.invoices i WHERE i.status <> 'VOID'` |
| comparison_query | `SELECT il.invoice_id AS entity_id, SUM(il.amount_minor)::bigint AS qty FROM fin.invoice_lines il GROUP BY il.invoice_id` |

### R075 — Sequence never reused: `UNIQUE(legal_entity_id, invoice_number)` probe

| Field | Value |
|---|---|
| check_code | `R075` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT MIN(i.id::text)::uuid AS entity_id, 1::bigint AS qty FROM fin.invoices i GROUP BY i.legal_entity_id, i.invoice_number` |
| comparison_query | `SELECT MIN(i.id::text)::uuid AS entity_id, COUNT(*)::bigint AS qty FROM fin.invoices i GROUP BY i.legal_entity_id, i.invoice_number` |

### R076 — Credit/debit notes reference an ISSUED+ invoice and do not exceed remaining

| Field | Value |
|---|---|
| check_code | `R076` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT cn.invoice_id AS entity_id, SUM(cn.amount_minor)::bigint AS qty FROM fin.credit_notes cn WHERE cn.status = 'ISSUED' GROUP BY cn.invoice_id` |
| comparison_query | `SELECT i.id AS entity_id, i.total_minor AS qty FROM fin.invoices i WHERE i.status IN ('ISSUED','PART_PAID','PAID','UNCOLLECTIBLE')` |

Drift when credit SUM > invoice total.

### R077 — PAID invoice allocations ≡ total; PART_PAID is strictly between

| Field | Value |
|---|---|
| check_code | `R077` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT i.id AS entity_id, CASE i.status WHEN 'PAID' THEN i.total_minor WHEN 'PART_PAID' THEN 1 ELSE 0 END AS qty FROM fin.invoices i WHERE i.status IN ('PAID','PART_PAID')` |
| comparison_query | `SELECT i.id AS entity_id, COALESCE((SELECT SUM(pa.amount_minor) FROM fin.payment_allocations pa WHERE pa.invoice_id = i.id),0)::bigint AS qty FROM fin.invoices i WHERE i.status IN ('PAID','PART_PAID')` |

Runner applies: PAID ⇒ equality; PART_PAID ⇒ `0 < sum < total`.

### R078 — VOID invoice has zero allocations and an `INVOICE_VOID` approval

| Field | Value |
|---|---|
| check_code | `R078` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT i.id AS entity_id, 0::bigint AS qty FROM fin.invoices i WHERE i.status = 'VOID'` |
| comparison_query | `SELECT i.id AS entity_id, COALESCE((SELECT SUM(pa.amount_minor) FROM fin.payment_allocations pa WHERE pa.invoice_id = i.id),0)::bigint AS qty FROM fin.invoices i WHERE i.status = 'VOID'` |

### R079 — WC-KSA ISSUE requires ZATCA columns (DL-018)

| Field | Value |
|---|---|
| check_code | `R079` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT i.id AS entity_id, 1::bigint AS qty FROM fin.invoices i JOIN fin.platform_legal_entities le ON le.id = i.legal_entity_id WHERE le.jurisdiction = 'SA' AND i.status IN ('ISSUED','PART_PAID','PAID')` |
| comparison_query | `SELECT i.id AS entity_id, 1::bigint AS qty FROM fin.invoices i JOIN fin.platform_legal_entities le ON le.id = i.legal_entity_id WHERE le.jurisdiction = 'SA' AND i.status IN ('ISSUED','PART_PAID','PAID') AND i.xml_uuid IS NOT NULL AND i.qr_payload IS NOT NULL AND i.prev_invoice_hash IS NOT NULL` |

Stage 10 enforcement; Stage 0 only names the check.

---

## 13. R080–R089 — Vendor economics (Stage 11)

A §11.5–11.6 are stubs. SQL below uses the assumed columns in §1; the runner must fail `CHECK_NOT_INSTALLED` until Agent A fills the stubs.

### R080 — Vendor usage composite FK to customer usage (DL-021)

| Field | Value |
|---|---|
| check_code | `R080` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT v.id AS entity_id, 1::bigint AS qty FROM fin.vendor_usage_events v` |
| comparison_query | `SELECT v.id AS entity_id, 1::bigint AS qty FROM fin.vendor_usage_events v JOIN fin.usage_events u ON u.id = v.usage_event_id AND u.residency_key = v.residency_key` |

### R081 — Estimate exists before actual (audit D-4 pattern)

| Field | Value |
|---|---|
| check_code | `R081` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT ac.vendor_usage_event_id AS entity_id, 1::bigint AS qty FROM fin.vendor_actual_costs ac` |
| comparison_query | `SELECT ac.vendor_usage_event_id AS entity_id, 1::bigint AS qty FROM fin.vendor_actual_costs ac JOIN fin.vendor_cost_estimates e ON e.vendor_usage_event_id = ac.vendor_usage_event_id` |

### R082 — FINALIZED statement lines sum to `vendor_statements.total_minor`

| Field | Value |
|---|---|
| check_code | `R082` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT s.id AS entity_id, s.total_minor AS qty FROM fin.vendor_statements s WHERE s.status = 'FINALIZED'` |
| comparison_query | `SELECT l.statement_id AS entity_id, SUM(l.amount_minor)::bigint AS qty FROM fin.vendor_statement_lines l GROUP BY l.statement_id` |

### R083 — Vendor rate-version overlap empty (DL-023)

Same shape as R037 on `fin.vendor_rate_versions`. `severity MEDIUM`, `WARN`.

### R084 — A/B: internal `vendor_usage_events.quantity_units` vs `vendor_reported_usage.quantity_units` by `(vendor_id, period_key)`

| Field | Value |
|---|---|
| check_code | `R084` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT v.vendor_id AS entity_id, SUM(v.quantity_units)::bigint AS qty FROM fin.vendor_usage_events v GROUP BY v.vendor_id, date_trunc('month', v.occurred_at)` |
| comparison_query | `SELECT r.vendor_id AS entity_id, SUM(r.quantity_units)::bigint AS qty FROM fin.vendor_reported_usage r GROUP BY r.vendor_id, r.period_key` |

Spec §87 variance A/B. Variance reason classification is Stage 11 (`vendor/reconciliation.js`); this check only flags nonzero delta.

### R085 — C/D: estimate vs actual by vendor_usage_event

| Field | Value |
|---|---|
| check_code | `R085` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT e.vendor_usage_event_id AS entity_id, e.amount_minor AS qty FROM fin.vendor_cost_estimates e` |
| comparison_query | `SELECT ac.vendor_usage_event_id AS entity_id, ac.amount_minor AS qty FROM fin.vendor_actual_costs ac` |

### R086 — E/F: actuals vs finalized statement lines

| Field | Value |
|---|---|
| check_code | `R086` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT ac.id AS entity_id, ac.amount_minor AS qty FROM fin.vendor_actual_costs ac` |
| comparison_query | `SELECT l.vendor_usage_event_id AS entity_id, l.amount_minor AS qty FROM fin.vendor_statement_lines l JOIN fin.vendor_statements s ON s.id = l.statement_id WHERE s.status = 'FINALIZED'` |

<!-- OPEN: `vendor_statement_lines.vendor_usage_event_id` is listed in A §11.7 as one of two sources. -->

### R087 — Google SKU map is on `vendor_rate_versions`, not in JS (audit D-4)

| Field | Value |
|---|---|
| check_code | `R087` |
| severity | `LOW` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT 1 AS entity_id, 1::bigint AS qty` |
| comparison_query | `SELECT 1 AS entity_id, COUNT(*)::bigint AS qty FROM fin.vendors v JOIN fin.vendor_rate_cards rc ON rc.vendor_id = v.id JOIN fin.vendor_rate_versions rv ON rv.vendor_rate_card_id = rc.id WHERE v.code = 'google_maps' AND rv.unit_cost_minor IS NOT NULL` |

Comparison `>= 1` is green (seed present). Zero seeded versions after Stage 11 is drift. This does **not** UPDATE `area_intelligence.google_api_usage_log` — that is the historical one-shot in §15.

### R088 — `vendor_usage_events` unique `(vendor_id, source_system, source_event_id)`

| Field | Value |
|---|---|
| check_code | `R088` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT MIN(v.id::text)::uuid AS entity_id, 1::bigint AS qty FROM fin.vendor_usage_events v GROUP BY v.vendor_id, v.source_system, v.source_event_id` |
| comparison_query | `SELECT MIN(v.id::text)::uuid AS entity_id, COUNT(*)::bigint AS qty FROM fin.vendor_usage_events v GROUP BY v.vendor_id, v.source_system, v.source_event_id` |

### R089 — Margin probe: recognized revenue minus attributable actual cost (informational)

| Field | Value |
|---|---|
| check_code | `R089` |
| severity | `LOW` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | `SELECT ae.accounting_period_id AS entity_id, SUM(ae.amount_minor)::bigint AS qty FROM fin.accounting_events ae WHERE ae.event_type = 'REVENUE_RECOGNIZED' GROUP BY ae.accounting_period_id` |
| comparison_query | `SELECT ae.accounting_period_id AS entity_id, SUM(ae.amount_minor)::bigint AS qty FROM fin.accounting_events ae WHERE ae.event_type = 'REVENUE_RECOGNIZED' GROUP BY ae.accounting_period_id` |

Stage 11 subtracts attributable `vendor_actual_costs.amount_minor` in the runner, not in this comparison identity. Nonzero margin is `WARN` only. Do not invent a `margin` table.

---

## 14. R090-R092 — Stage 13 cutover isolation

Plan: TEST/LIVE / tenant / legal-entity contamination. These stay red until dual-write exists. They do **not** write `commercial.*`.

### R090 — TEST/LIVE contamination

| Field | Value |
|---|---|
| check_code | `R090` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT 1 AS entity_id, 0::bigint AS qty` |
| comparison_query | Count of FK pairs where `environment` differs across `ledger_postings` / `ledger_transactions` / `ledger_books` / `lots` / `usage_events` / `rated_usage` / `invoices` / `payments`. Implementation: union of R016-class joins. Any row is drift. |

### R091 — Tenant contamination

| Field | Value |
|---|---|
| check_code | `R091` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_AFFECTED_HOLDER` |
| source_query | `SELECT i.id AS entity_id, 1::bigint AS qty FROM fin.invoices i` |
| comparison_query | `SELECT i.id AS entity_id, 1::bigint AS qty FROM fin.invoices i JOIN fin.billing_accounts ba ON ba.id = i.billing_account_id JOIN fin.tenants t ON t.id = i.tenant_id WHERE i.tenant_id = ba.tenant_id AND ba.tenant_id = t.id AND i.environment = ba.environment` |

Same-tenant walk is required for `rated_usage`, `payments`, `lots`, `holds` (runner expands).

### R092 — Legal-entity contamination + single-ledger doctrine (audit A-4)

| Field | Value |
|---|---|
| check_code | `R092` |
| severity | `CRITICAL` |
| expected_delta_units | `0` |
| drift_action | `BLOCK_BILLING_CLOSE` |
| source_query | `SELECT i.id AS entity_id, 1::bigint AS qty FROM fin.invoices i` |
| comparison_query | `SELECT i.id AS entity_id, 1::bigint AS qty FROM fin.invoices i JOIN fin.platform_legal_entities le ON le.id = i.legal_entity_id JOIN fin.billing_accounts ba ON ba.id = i.billing_account_id WHERE i.legal_entity_id = ba.seller_legal_entity_id` |

Stage 13 **adds** a detective query (not a `fin.*` write) that `wa_listings.ai_credit_transactions` created after cutover have a matching `fin.usage_events` row with `source_system = 'wa_listings'`. Residual rows without a match are A-4 drift. The live `credits.js` path is **not** patched in Stage 0 (DL-011).

---

## 15. Historical backfill reconciliation (A-3, D-1, D-4)

These are **one-time** `ON_DEMAND` runs. They do not sit on the daily schedule. They stamp:

| Stamp | Value |
|---|---|
| `reconciliation_runs.source_system` | `backfill_v1` |
| `reconciliation_runs.schedule_kind` | `ON_DEMAND` |
| `usage_events.source_system` (when a reconstruction row is later written) | `backfill_v1` |
| `usage_events.source_event_id` | stable: `'<legacy_table>:' \|\| legacy_pk` — never recycled (DL-009) |
| `ledger_transactions.economic_source_type` | `RECONCILIATION` |
| `ledger_transactions.actor_type` | `RECONCILIATION` |
| `financial_audit_events.action` | `BACKFILL_V1_<CODE>` |

Zero live tenants today (handover §2.4 / Agent A Stage 0 note). **No customer credit-note pass** until a customer exists. The runbooks stay evidence, not a silent `commercial.*` UPDATE.

Execution stage: **Stage 13**. Stage 0 only specifies the recon pair so the backfill cannot invent a second method.

### 15.1 BF-A3 — empty `commercial.usage_events` (audit A-3 / D-3)

**Window:** Phase 7a emit wiring (`8d256fd`) → fix `5fccd71`.
**Why irrecoverable from `commercial.*`:** every INSERT raised `42P10`; `events.js:153` swallowed it.

Audit D Runbook B becomes one recon run:

| Field | Value |
|---|---|
| check_code | `BF-A3` (not in R001–R092; stored in `check_code`) |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `WARN` (no live tenant to block) |
| source_query | Priority union of reconstruction sources, counted by `actionKey` (audit D §4 table) |
| comparison_query | `SELECT event_type, COUNT(*) FROM fin.usage_events WHERE source_system = 'backfill_v1' AND occurred_at >= :win_start AND occurred_at < :win_end GROUP BY event_type` |

Source union (fidelity order, audit A §4 + D Runbook B):

1. `distribution_jobs WHERE status = 'published'` → `publish.*`
2. `social_cards` where engine `bannerbear` → `render.template.premium`
3. `conversation_messages` with `suggested_reply IS NOT NULL` → `ai.reply.drafted`
4. `activity_log` `type = 'contact_lead_summary_regenerated'` → `ai.chat.turn`
5. outbound `conversation_messages` → `message.out.whatsapp.*` / channel variants
6. inbound `conversation_messages` → `message.in.*` (rate-0)
7. `wa_listings.ai_usage_logs` → `ai.description.*` (A-4 shadow; tagged, not laundered into lots until Stage 13 retire)

Each reconstructed fact, **when Stage 13 writes**, is `event_kind = 'ORIGINAL'`, `ingestion_version = 1`. Reconstruction notes go in `financial_audit_events.after_state` — `data` JSONB is forbidden on `fin.*`.

Quota consumption during backfill: **do not** `recordConsumption` / do not write `ledger_postings`. Facts only (DL-007). Finance decides later whether to grant `COMPENSATION` lots. That decision is a Stage 13 approval, not a recon auto-post.

### 15.2 BF-D1 — WhatsApp inbound dropped (audit D-1)

**Window:** Phase 4.6 → `5fccd71`.
Audit D Runbook A is the source_query:

```sql
SELECT pm.message_id AS source_event_id, pm.from_number, pm.processed_at
FROM wa_listings.processed_messages pm
LEFT JOIN wa_listings.sessions s ON s.data->>'last_message_id' = pm.message_id
LEFT JOIN wa_listings.drafts   d ON d.data->>'source_message_id' = pm.message_id
WHERE s.id IS NULL AND d.id IS NULL
  AND pm.processed_at < :fix_5fccd71_deploy_ts;
```

| Field | Value |
|---|---|
| check_code | `BF-D1` |
| severity | `HIGH` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| comparison_query | `SELECT source_event_id FROM fin.usage_events WHERE source_system = 'backfill_v1' AND event_type LIKE 'message.in.whatsapp%' AND occurred_at < :fix_ts` |

Replay must not double-charge (audit D §1). Ingest path for a backfill row is **facts + optional rate-0**; it does not authorize. Tenant notification is an `outbox_events` topic `notification.backfill_whatsapp` after the run, not a side effect inside the SQL.

Corroboration: `public.webhook_delivery_log` `provider = 'whatsapp'` (audit D §1 path 2). Drift if Runbook A row has no twin — still reconstruct, tag `after_state.corroborated = false`.

### 15.3 BF-D4 — Google Maps budget NULL (audit D-4)

**Window:** Phase 6 launch → `c2e6240`.
Audit D Runbook C is **not** executed as an UPDATE from this design. The recon pair is:

| Field | Value |
|---|---|
| check_code | `BF-D4` |
| severity | `MEDIUM` |
| expected_delta_units | `0` |
| drift_action | `WARN` |
| source_query | Recompute from `area_intelligence.google_api_usage_log.operation` using the A §11.3 seed (`/place/nearbysearch` → 1700 USD minor, `/distancematrix` → 500, else 100) **as a SELECT expression**, never as `UPDATE … SET cost_estimate_usd` |
| comparison_query | `SELECT vue.id, e.amount_minor FROM fin.vendor_usage_events vue JOIN fin.vendor_cost_estimates e ON e.vendor_usage_event_id = vue.id JOIN fin.vendors v ON v.id = vue.vendor_id WHERE v.code = 'google_maps' AND vue.source_system = 'backfill_v1'` |

Truth-source for validation (ops, not SQL): Google Cloud Console → Billing → Reports by SKU. Store the Console export hash on `financial_audit_events.after_state`.

Live remediations that stay **out** of Stage 0: `NOT NULL` + `CHECK` on `google_api_usage_log.cost_estimate_usd` (D12); JS destructure (already fixed `c2e6240`). The rebuild pattern (estimate **before** the network call) is Stage 11.

### 15.4 One-shot runner rules

1. Advisory lock: `fin.recon.BF-A3.LIVE.platform` (etc.). Two-int hash as §3.2.
2. Idempotent: `UNIQUE (environment, source_system, source_event_id, residency_key)` on `usage_events` with `ON CONFLICT DO NOTHING` (DL-009). Re-running BF-A3 does not duplicate facts.
3. App role used for backfill writes is **not** `fin_app_role`; it is a Stage 13 `fin_migrate_role` (H §2) with INSERT on `usage_events`, `vendor_usage_events`, `vendor_cost_estimates`, `financial_audit_events`, `reconciliation_*` only.
4. `commercial.*` remains read-only.

---

## 16. Code index to check_code

| Stage | Module (plan) | Codes that must appear in the postgres job summary |
|---|---|---|
| 1 | `backend/src/fin/reconciliation/checks/R001_*.js` … `R023_*.js` | `R001`–`R023` (`R020`–`R023` may `CHECK_NOT_INSTALLED` until Stage 6) |
| 2–3 | `R030_*.js` … `R039_*.js` | `R030`–`R039` |
| 5 | `R040_*.js` … `R049_*.js` | `R040`–`R049` |
| 8 | `R050_*.js` … `R059_*.js` | `R050`–`R059` |
| 9 | `R060_*.js` … `R069_*.js` | `R060`–`R069` |
| 10 | `R070_*.js` … `R079_*.js` | `R070`–`R079` |
| 11 | `R080_*.js` … `R089_*.js` | `R080`–`R089` |
| 13 | `R090_*.js` + `BF_A3.js` / `BF_D1.js` / `BF_D4.js` | `R090`–`R092`, `BF-A3`, `BF-D1`, `BF-D4` |

---

## 17. Acceptance (A §18 posture)

Gated real-Postgres. File names **must** appear in the CI **postgres** job summary (`docs/HANDOVER_2026-08-16.md` §3.1). If they do not appear, they did not run.

| # | Test file | Asserts |
|---|---|---|
| F1 | `backend/src/fin/reconciliation/r001-conservation.postgres.test.js` | Insert a tx whose postings sum to 1 → R001 `DRIFT`, `drift_action = BLOCK_BILLING_CLOSE`; balanced tx → `GREEN` |
| F2 | `backend/src/fin/reconciliation/r002-containment.postgres.test.js` | Posting with `book_id ≠ tx.book_id` (even `CLEARING`) → R002 `DRIFT` |
| F3 | `backend/src/fin/reconciliation/r004-balance-cache.postgres.test.js` | Cache `balance_units` off by 1 vs `SUM(postings)` → R004 `DRIFT` |
| F4 | `backend/src/fin/reconciliation/r006-lot-remaining.postgres.test.js` | `remaining_units ≠ granted_units + SUM(lot_allocations.units)` → R006 `DRIFT` |
| F5 | `backend/src/fin/reconciliation/r013-transfer-pair.postgres.test.js` | 1-leg and 3-leg `pair_id` → R013 `DRIFT` (DL-025) |
| F6 | `backend/src/fin/reconciliation/r016-env-isolation.postgres.test.js` | TEST posting on LIVE book → R016/R090 `DRIFT` |
| F7 | `backend/src/fin/reconciliation/r032-no-price-on-facts.postgres.test.js` | `information_schema` probe: `price_minor` absent on `fin.usage_events` |
| F8 | `backend/src/fin/reconciliation/r061-hard-closed.postgres.test.js` | Event against HARD_CLOSED → write rejected (G) **and** R061 would `DRIFT` if trigger dropped |
| F9 | `backend/src/fin/reconciliation/r071-payment-cap.postgres.test.js` | Allocation SUM = total+1 → R071 `DRIFT`, `BLOCK_BILLING_CLOSE` |
| F10 | `backend/src/fin/reconciliation/r073-tax-freeze.postgres.test.js` | `tax_snapshots.tax_minor` ≠ SUM(`invoice_tax_lines`) → R073 `DRIFT` |
| F11 | `backend/src/fin/reconciliation/r060-period-equivalence.postgres.test.js` | `SUM(accounting_events.amount_minor)` by period ≠ cited sources → R060 `DRIFT` |
| F12 | `backend/src/fin/reconciliation/ladder.postgres.test.js` | R001 drift applies `BLOCK_BILLING_CLOSE` via `account_controls` + period close rejected; greener rerun does **not** auto-clear |
| F13 | `backend/src/fin/reconciliation/advisory-lock.postgres.test.js` | Second runner on same `check_code+env+scope` gets `RECON_LOCK_HELD`, does not skip other codes |
| F14 | `backend/src/fin/reconciliation/backfill-v1.postgres.test.js` | BF-A3 / BF-D1 / BF-D4 stamp `source_system='backfill_v1'`; second run `ON CONFLICT DO NOTHING`; no `ledger_postings` written |
| F15 | `backend/src/fin/reconciliation/app-role-readonly.postgres.test.js` | Recon read txn cannot `INSERT fin.ledger_postings` (H grants) |

Property-based (plan §116): after every random Stage-1 command sequence, R001–R007 and R016 are green. Sequence fixtures are stored and replayable.

---

## 18. Live P0s this file does not remediate

| Finding | Why this file only scopes it |
|---|---|
| A/B-1 split INSERT / `recordConsumption` | Replacement is Stage 2+6 `transaction()` on `fin.*`. R001/R004 detect the class of bug after cutover. |
| A-2 swallow / no DLQ | Stage 2 `usage_events_dlq` + R033. Do not edit `events.js`. |
| A-4 `ai_credit_*` | Stage 6/7 + Stage 13. R092 detective only after cutover. |
| C-1 pricing PATCH throws | Stage 4. Not a recon check. |
| C-2 lost updates | Stage 1 `+occ`. Not a recon check. |
| E-3 `audit_log` mutable | H + Stage 1 `financial_audit_events`. |
| A-3 / D-1 / D-4 historical | §15 one-shots at Stage 13. Runbooks stay in Audit D. |

---

## 19. A-Q4 close

**A-Q4:** R001–R023 SQL against these columns — **closed**. This file is the pair list. R024–R092 are the spec §96 remainder mapped to the same column vocabulary. Missing vendor-stub columns are `<!-- OPEN -->` plus DL-046 notes, not parallel tables.

Agent B/C, if they add a status or lock key that a `PER_CLOSE` check must read, append a Decision Log row. Do not edit this file from another agent.
