# Deliverable D — Concurrency

**Stage:** 0 (§128)
**Owner:** Agent C
**Date:** 2026-08-18
**Status:** Stage 0 design — **no** `backend/src/**` change, **no** migration
**Depends on:** `A_ENTITY_MODEL.md` (vocabulary), `DECISION_LOG.md` DL-001…DL-028, this file's DL-037…DL-040
**Closes:** A-Q2 (lock order). Does **not** reopen A-Q3 (DL-014) or A-Q7 (DL-013).
**Coordinates:** `B_STATE_MACHINES.md` + `C_TRANSACTION_MATRIX.md` had **not** landed when this file was written. Command ids below are A's `ledger_transactions.shape` set plus the Stage 0 plan's economic commands. When B/C land, those files own transition *names*; this file owns lock *order*. Do not invent a parallel command vocabulary.

<!-- OPEN: C_TRANSACTION_MATRIX.md not landed. If B adds a multi-row command this matrix omits, that command inherits §3 global order — do not add a local order. If B needs a column A omitted, B appends a Decision Log row; C does not invent the column. -->

---

## 0. Why this file exists

Audit **C-2** is live: `postgres-adapter.js:219` reads before `BEGIN` at `:232`. There is no `version`, no `SELECT … FOR UPDATE`, no `If-Match`. Concurrent admin writes silently clobber. That is a lost-write, not a last-write-wins product choice.

This deliverable specifies how `fin.*` writers will be serialised. It does **not** remediate the live DAL. C-2 on `postgres-adapter.js` is a **Stage 1 foundation fix on `fin.*` writers**, not a drive-by rewrite in this PR (audit Stage 0 / Agent A; DL-011). `commercial.*` stays frozen.

Enterprise posture, not MVP: every multi-row command has a total lock order; every MUTABLE / INTENT row that HTTP PATCH can touch has OCC; every worker that must be singleton or sharded has a named advisory key; every constraint named here has a real-Postgres acceptance test in §12.

---

## 1. Invariants

| ID | Invariant | Enforced by |
|---|---|---|
| D-I1 | A command that touches more than one row acquires locks in **exactly** the §3 order. No path-local order. | Review + deadlock tests |
| D-I2 | Paired `TRANSFER` locks **both** `ledger_books` in `book_id ASC` before any account, lot, or hold on either book (DL-012, A-Q2) | Command matrix §4 |
| D-I3 | Lots are locked `holder_id ASC, draw_priority ASC, lot_id ASC` (A §5.1 / §13 draw order) | §3.4 |
| D-I4 | Hold **expiry** claims with `SELECT … FOR UPDATE SKIP LOCKED`, then takes the book with `NOWAIT` so the claim cannot invert §3 (see §5) | Expiry worker |
| D-I5 | Every table A §1.1 classifies **MUTABLE** or **INTENT** has `version BIGINT NOT NULL DEFAULT 1` bumped by `fin.trg_bump_version` **BEFORE UPDATE**. HTTP PATCH requires `If-Match: "<version>"`. Mismatch → `412 PRECONDITION_FAILED` + current representation | §6, DL-004 |
| D-I6 | `transaction(fn)` is one Postgres connection. Reads inside `fn` see that connection's writes (RYOW). It is **not** a distributed saga | §8, audit B §3 |
| D-I7 | A `pair_id` is two `TRANSFER` rows, two distinct `book_id`s, same `environment`. 1-leg and 3-leg fail at COMMIT (R2-1 / DL-025 / DL-037) | §9 |
| D-I8 | Cross-currency pair-leg requires `fx_rate_snapshot_id` on **each** leg (R2-2 / DL-026 / DL-038) | §10 |
| D-I9 | Advisory locks are taken on a **dedicated** pool client and held for the process lifetime (renewal-scanner pattern). They are never taken *after* a row lock on the request client | §7 |
| D-I10 | Isolation is `READ COMMITTED` plus row locks. `SERIALIZABLE` is not the default; 40001/40P01 retry is | §11 |

---

## 2. A-Q2 — closed

**Question (A §17):** lock order when a command touches book + lot + hold + facility + `pair_id`.

**Answer:** a single total order, applied on every path including workers:

```
idempotency_keys (claim)          — HTTP / worker command envelope only; see E
→ ledger_book_id ASC              — paired TRANSFER: both books, ASC
→ account_type_rank ASC           — hierarchy depth inside the book
→ ledger_accounts.id ASC
→ account_balances.account_id     — same order as the parent account
→ credit_facilities.id ASC
→ lots.holder_id ASC
→ lots.draw_priority ASC          — spec §39 / A §13
→ lots.id ASC
→ holds.id ASC                    — expiry: SKIP LOCKED claim + book NOWAIT (§5)
→ facility_reservations.id ASC
→ dunning_cases.id ASC
→ remaining INTENT / MUTABLE rows — table_rank ASC, id ASC (§3.7)
```

That is A-Q2's recommended `ledger_book_id ASC → account hierarchy depth → account_id ASC`, extended for pair, lots, holds, facilities, reservations, and dunning. **Closed.**

`account_type_rank` (depth inside a book — not an org tree):

| Rank | `account_type` | Why this depth |
|---|---|---|
| 10 | `ISSUANCE` | Source of granted units |
| 20 | `AVAILABLE` | Spendable |
| 30 | `HELD` | Authorize / capture / void |
| 40 | `CONSUMED` | Capture / direct spend |
| 50 | `EXPIRED` | Lot / hold expiry |
| 60 | `ADJUSTMENT` | Manual / FX residual |
| 70 | `CLEARING` | Intra-book TRANSFER clearing account (DL-012 — still *this* book) |

Holder org depth is **not** a lock key. Funding resolver walks `funding_relationships` after the books of every holder it will debit are locked in `book_id ASC`. Walking the org tree as a lock order would deadlock with a transfer that locked the child book first.

---

## 3. Global lock order (normative)

### 3.1 Envelope (before economic rows)

| Step | Object | Mode | Notes |
|---|---|---|---|
| E0 | Process advisory lock | `pg_try_advisory_lock` on a **dedicated** client | Workers only. Request path does not hold a process advisory lock |
| E1 | `fin.idempotency_keys` | `INSERT … ON CONFLICT` then `SELECT … FOR UPDATE` | Same DB transaction as the economic work. See `E_IDEMPOTENCY.md` |
| E2 | Shard advisory (two-key) | `pg_try_advisory_lock(class, shard)` | Only the workers in §7.2 that are sharded. Taken on the dedicated client, **before** E1 on the request client |

Never: row lock on the request client → then wait for an advisory lock. That inversion is how a singleton worker and a request deadlock across replicas.

### 3.2 Books and accounts

```sql
-- Paired TRANSFER: lock both books first, UUID ASC (byte order of the PK).
SELECT id FROM fin.ledger_books
 WHERE id IN ($book_a, $book_b)
 ORDER BY id ASC
 FOR UPDATE;

-- Then every account this command will post to, in (book_id, rank, account_id).
SELECT a.id
  FROM fin.ledger_accounts a
 WHERE a.id = ANY ($account_ids)
 ORDER BY a.book_id ASC,
          fin.account_type_rank(a.account_type) ASC,
          a.id ASC
 FOR UPDATE;

-- Cache row travels with its account (PK = account_id).
SELECT account_id FROM fin.account_balances
 WHERE account_id = ANY ($account_ids)
 ORDER BY account_id ASC
 FOR UPDATE;
```

`fin.account_type_rank(text) RETURNS int` is a `IMMUTABLE` SQL function implementing the table in §2. Stage 1 migration ships it. Commands that only read a balance still take `FOR UPDATE` on the cache row if they will post.

Balance debit (spec §115): after the cache lock,

```sql
UPDATE fin.account_balances
   SET balance_units = balance_units + $delta   -- signed; trigger path preferred
 WHERE account_id = $1
   AND balance_units + $delta >= $floor;        -- floor 0 on AVAILABLE/HELD as policy
```

If the `WHERE` matches 0 rows → `INSUFFICIENT_ELIGIBLE_CREDITS` (or the facility/limit denial code). Do **not** read `balance_units` on a second connection and then write. CACHE writers remain the posting trigger (A §4.5); the `UPDATE … WHERE` form is the optimistic alternative when the trigger is not in the same statement. Stage 1 picks one per posting path and tests both races.

### 3.3 Facilities

`credit_facilities` before any lot or hold the reservation will create:

```sql
SELECT id FROM fin.credit_facilities
 WHERE id = ANY ($facility_ids)
 ORDER BY id ASC
 FOR UPDATE;
```

Limit check is against `limit_minor − SUM(OPEN facility_reservations.reserved_minor)` computed **after** the facility row lock, not from a cached counter A did not declare.

### 3.4 Lots (A §13)

Draw order is the lock order. Never "lock the lot we intend to draw first" — two concurrent authorizes on the same holder would deadlock on crossed `draw_priority`.

```sql
SELECT id FROM fin.lots
 WHERE id = ANY ($lot_ids)
 ORDER BY holder_id ASC, draw_priority ASC, id ASC
 FOR UPDATE;
```

A command that *selects* applicable lots (authorize) must:

1. Lock the book(s) and accounts.
2. `SELECT` candidate lots `WHERE holder_id = $h AND status = 'ACTIVE' … ORDER BY draw_priority ASC, id ASC`.
3. `SELECT … FOR UPDATE` those ids in the same `(holder_id, draw_priority, id)` order.
4. Re-evaluate `remaining_units` / applicability after the lock (TOCTOU).

`remaining_units` is mutated only via `lot_allocations` (A §5.1). The lot row lock is still required so two draws cannot allocate past `remaining_units` before the allocation trigger runs.

### 3.5 Holds

**Command path** (authorize / capture / void / expire-on-request):

```sql
SELECT id FROM fin.holds
 WHERE id = ANY ($hold_ids)
 ORDER BY id ASC
 FOR UPDATE;          -- no SKIP LOCKED
```

Always after books + accounts + facilities + lots of that command. Capture of hold H that allocated lots L1,L2 locks L1,L2 then H.

**Expiry worker:** §5. `SKIP LOCKED` is mandatory so two replicas do not wait on the same expired hold. It is **not** a licence to invert book-then-hold.

Index (already in A §13): `(status, expires_at) WHERE status = 'OPEN'`.

### 3.6 Facility reservations

```sql
SELECT id FROM fin.facility_reservations
 WHERE id = ANY ($reservation_ids)
 ORDER BY id ASC
 FOR UPDATE;
```

After the parent `credit_facilities` row and after the `holds` row when the reservation points at a hold. Open-then-link (reserve without a hold yet) locks facility → reservation; authorize-with-facility locks facility → lots → hold → reservation.

### 3.7 Dunning and remaining control rows

`dunning_cases` after the economic resources the step will touch (`account_controls`, `credit_facilities`, invoices). Then the rest, when the command writes them:

| `table_rank` | Table | Typical lock |
|---|---|---|
| 80 | `fin.billing_accounts` | `FOR UPDATE` when the command mutates the header (rare; usually OCC PATCH) |
| 81 | `fin.tenants` | OCC PATCH or `FOR UPDATE` on `READ_ONLY`/`SUSPENDED` flip |
| 82 | `fin.account_controls` | `FOR UPDATE` on dunning `PAUSE_NEW_CREDIT` / `SUSPEND_USAGE` |
| 83 | `fin.purchase_intents` | `FOR UPDATE` on PAID / FAILED / REFUNDED |
| 84 | `fin.billing_periods` | `FOR UPDATE` on close |
| 85 | `fin.accounting_periods` | `FOR UPDATE` on SOFT/HARD close |
| 86 | `fin.invoices` | `FOR UPDATE` until ISSUE; after ISSUE only status+paid (A §10.3) |
| 87 | `fin.invoice_sequences` | `FOR UPDATE` + `UPDATE next_n = next_n + 1 … RETURNING` (no OCC — §6.3) |
| 88 | `fin.payments` / `fin.unapplied_cash` | `FOR UPDATE` |
| 89 | `fin.disputes` | `FOR UPDATE` |
| 90 | `fin.approval_requests` | `FOR UPDATE` on EXECUTED |
| 91 | `fin.contracts` / `fin.prices` / `fin.meters` headers | OCC `If-Match` on HTTP PATCH; `FOR UPDATE` when a command transitions status inside `transaction(fn)` |
| 92 | `fin.outbox_events` | insert only (no lock of peers) |
| 93 | `fin.financial_audit_events` | insert only |

Single-row HTTP PATCH of a MUTABLE header does **not** take book locks. It takes OCC on that row only (§6). If a PATCH handler also writes an economic command, it is not a PATCH — it is a command that must follow §3.

---

## 4. Command lock matrix

Shapes and uniqueness are A §4.3 / DL-014. Transitions are Agent B's (A-Q1). This table is the lock set for every command that touches more than one row.

`POST` / worker commands take E1 (`idempotency_keys`) first unless marked "worker-claim" (expiry / outbox / dlq), which use §5 / §7 instead of an HTTP key.

| Command | Shape(s) | Rows locked (in §3 order) | Inserts (no peer lock) | Notes |
|---|---|---|---|---|
| **FUND** | `FUNDING` | books → accounts → balances → `purchase_intents` | tx, postings, lot (`PURCHASE`), inventory allocations, outbox, audit | Once per `PURCHASE_INTENT` (DL-014) |
| **AUTHORIZE** | `HOLD` | books → accounts → balances → facilities? → lots → (new hold is insert) → reservation? | tx, postings, hold, lot_allocations, reservation?, `authorization_attempts`, outbox | Facility path locks facility before lots |
| **CAPTURE** | `CAPTURE` | books → accounts → balances → lots (held) → hold → reservation? | tx, postings, allocations, outbox | Hold must still be `OPEN` after lock |
| **VOID** | `VOID` | books → accounts → balances → lots → hold → reservation? | tx, postings, restore allocations, outbox | |
| **EXPIRE_HOLD** | `VOID` or `EXPIRY` on hold | worker-claim §5: SKIP LOCKED hold, `NOWAIT` book, then replay §3 on that hold's book/lots/reservation | tx, postings, outbox | Worker; see §5 |
| **DIRECT_SPEND** | `DIRECT_SPEND` | books → accounts → balances → lots | tx, postings, allocations, outbox | Once per `RATED_USAGE` |
| **EXPIRE_LOT** | `EXPIRY` | books → accounts → balances → lot | tx, postings, outbox | Once per `LOT`. Worker may batch lots **sorted by book_id, holder_id, draw_priority, id** |
| **REFUND** | `REFUND` | books → accounts → balances → lots (new `REFUND_REVERSAL` is insert) → payment? → invoice? | tx, postings, lot, `fin.refunds` (when Stage 10 fills T4), outbox | **Not** unique per source — `idempotency_keys` only (DL-014) |
| **GRANT** | `GRANT` | books → accounts → balances → `approval_requests` | tx, postings, lot (`PROMOTIONAL_GRANT` / `SUBSCRIPTION_GRANT` / `COMPENSATION`), outbox | Once per approval/grant source |
| **TRANSFER** | `TRANSFER` × 2 + dest `ADJUSTMENT`/`FX_ROUNDING` if residual | **both** books ASC → all accounts of both books that will be posted → balances → lots (source draw + dest `TRANSFER_IN` insert) | two `ledger_transactions` sharing `pair_id`, postings, allocations, outbox | One `pair_id`, two books. §9 / §10 |
| **ADJUSTMENT** | `ADJUSTMENT` | books → accounts → balances → lots? | tx, postings, outbox | Not unique per source — key only |
| **MIGRATE** | `MIGRATE` | books (src+dst if two) ASC → accounts → balances → src lot → dest lot insert | tx(s), postings, allocations, outbox | Two books ⇒ treat as paired only if shape is `TRANSFER`. `MIGRATE` stays same-book unless B's matrix says otherwise. <!-- OPEN: Agent B — is MIGRATE same-book only? If cross-book, it must become a TRANSFER pair (DL-012), not a second cross-book shape. --> |
| **FACILITY_RESERVE** | (may also `HOLD`) | books → accounts → balances → facility → lots? → hold? → reservation | reservation, optional hold/tx, outbox | |
| **FACILITY_CAPTURE** | `CAPTURE` | same as CAPTURE + facility + reservation | | |
| **FACILITY_RELEASE** / **FACILITY_EXPIRE** | `VOID` / `EXPIRY` | facility → (book path if a hold exists) → hold → reservation | | Release without a hold: facility → reservation only |
| **ISSUE_INVOICE** | none, or `ADJUSTMENT` for rounding | billing_period → invoice → `invoice_sequences` → tax_snapshot insert | invoice lines, tax lines, `accounting_events`, outbox | Sequence is `FOR UPDATE` + increment. No book lock unless a posting is in the same command |
| **APPLY_PAYMENT** | `FUNDING` and/or cash allocation | books? → accounts? → balances? → payment → invoices (id ASC) → `unapplied_cash` | allocations, outbox | PSP path also claims `UNIQUE(provider, provider_event_id)` (E §5) |
| **ALLOCATE_PAYMENT** | none | payment → invoices ASC → `unapplied_cash` | `payment_allocations` / `invoice_payment_allocations` | Cumulative ≤ `invoice.total_minor` |
| **OPEN_DUNNING** | none | invoice → `dunning_cases` (insert) | `dunning_steps`, outbox | |
| **ADVANCE_DUNNING** | none | facility? → `account_controls` → invoice → `dunning_cases` | `dunning_steps`, outbox | Step kinds A §8.5. B owns legal transitions |
| **CLOSE_DUNNING** | none | `dunning_cases` + invoice | step, outbox | |
| **PERIOD_CLOSE** (billing) | none | `billing_periods` → dependent invoices if drafted in-command | outbox | Status machine is B |
| **ACCOUNTING_CLOSE** | none | `accounting_periods` | outbox, audit | `HARD_CLOSED` rejects new `accounting_events` (A §9.0) |
| **RECON_RESOLVE** | `ADJUSTMENT` if money moves | books… (if posting) → `reconciliation_resolution` → approval | drift action, outbox | |
| **DISPUTE_OPEN** / **DISPUTE_RESOLVE** | `ADJUSTMENT` / `REFUND` if money | payment → invoice → dispute → (book path if posting) | outbox | |
| **CONTRACT_TRANSITION** | `GRANT` / `EXPIRY` / `MIGRATE` as B requires | books… then `contracts` | versions are APPEND_ONLY inserts | Header `FOR UPDATE` or If-Match + command |
| **LEGAL_ENTITY_CREATE** | none | advisory class `FIN_PARTITION_DDL` (§7) then `platform_legal_entities` | `CREATE TABLE … PARTITION OF usage_events` | Partition DDL often **cannot** share the row transaction. Race documented in §7.4 |

Single-row HTTP PATCH commands (`PATCH /tenants/:id`, `PATCH /prices/:id`, …) are §6 only.

<!-- OPEN: When C_TRANSACTION_MATRIX.md lands, replace the Command column with B/C's identifiers. Do not change the lock sets unless B introduces a new table A declared. -->

---

## 5. Hold expiry worker — `SKIP LOCKED` without lock inversion

A §13 already indexes OPEN holds by `expires_at`. Two replicas must not expire the same hold, and must not deadlock with CAPTURE (which locks **book then hold**).

**Forbidden:**

```sql
BEGIN;
SELECT id FROM fin.holds
 WHERE status = 'OPEN' AND expires_at <= $clock
 ORDER BY expires_at, id
 FOR UPDATE SKIP LOCKED
 LIMIT $batch;                 -- hold locks now held
SELECT id FROM fin.ledger_books WHERE id = $book FOR UPDATE;  -- inversion vs CAPTURE
```

**Required:**

```sql
-- 1. Probe without holding (uses the partial index).
SELECT id, book_id FROM fin.holds
 WHERE status = 'OPEN' AND expires_at <= $clock
 ORDER BY expires_at ASC, id ASC
 LIMIT $batch;

-- 2. Per candidate, one transaction, §3 order, SKIP LOCKED only on the hold:
BEGIN;
  SELECT id FROM fin.ledger_books WHERE id = $book_id FOR UPDATE NOWAIT;
  -- 55P03 / lock_not_available → ROLLBACK; skip this hold this tick.
  SELECT id FROM fin.holds
   WHERE id = $hold_id AND status = 'OPEN' AND expires_at <= $clock
   FOR UPDATE SKIP LOCKED;
  -- 0 rows → another worker won; ROLLBACK.
  -- else: VOID/EXPIRY postings, status EXPIRED, outbox, COMMIT.
COMMIT;
```

`NOWAIT` on the book is what makes `SKIP LOCKED` on the hold safe: we never wait for a CAPTURE that already holds the book and wants this hold. The hold is skipped until the next tick.

Batch candidates **must** be processed in `book_id ASC, hold_id ASC` so two expiry workers that probed overlapping sets still acquire books in the same order if `NOWAIT` is ever relaxed.

Facility-reservation expiry follows the same shape: lock `credit_facilities` (and book, if a hold exists) before `SKIP LOCKED` on the reservation.

Lot expiry is not SKIP LOCKED on the lot first. Probe, then book → lot `FOR UPDATE` (no skip required if the worker is singleton per §7; if sharded, `SKIP LOCKED` on the lot **after** the book lock).

---

## 6. Optimistic concurrency — If-Match middleware

### 6.1 Where `version` lives

A §1.1 + DL-004: every **MUTABLE** and **INTENT** table has `+occ`. APPEND_ONLY has no `version` and no `UPDATE`. CACHE (`account_balances`, `limit_counters`) has no `version`; CACHE writes are trigger-only (or the §3.2 `WHERE` debit).

`fin.trg_bump_version` is attached `BEFORE UPDATE` on every `+occ` table:

```sql
CREATE OR REPLACE FUNCTION fin.trg_bump_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

-- Applied per MUTABLE / INTENT table, e.g.:
CREATE TRIGGER trg_tenants_bump_version
  BEFORE UPDATE ON fin.tenants
  FOR EACH ROW
  EXECUTE FUNCTION fin.trg_bump_version();
```

The trigger is the bump. The **predicate** is the writer's `WHERE id = $1 AND version = $2`. A writer that omits `version` in the `WHERE` still increments (trigger) and **loses C-2 protection**. Stage 1 `fin.*` writers must include it. Linter / code-review gate: no `UPDATE fin.<mutable>` without `version` in `WHERE` except `invoice_sequences.next_n` (§6.3).

<!-- OPEN: A §3.2 `environments` and A §6.2 `usage_events_dlq` are MUTABLE but the column tables omit `+occ`. DL-040 applies §1.1: they get `version`. A §10.2 `invoice_sequences` is MUTABLE but increment is the concurrency control — no `version`. -->

### 6.2 HTTP PATCH middleware contract

Applies to every `PATCH` (and any `PUT` that is a merge) against a MUTABLE / INTENT / VERSIONED-**header** resource. Does **not** apply to `POST` economic commands (those use `Idempotency-Key`, see E) or to APPEND_ONLY (there is no PATCH).

**Request**

| Rule | Value |
|---|---|
| Header | `If-Match` **required** |
| Form | strong ETag, quoted decimal of `version`: `If-Match: "3"` |
| `If-Match: *` | **rejected** — `428 PRECONDITION_REQUIRED` is wrong here; return `428` only when the header is **absent**. `*` → `412` with `code=IF_MATCH_STAR_FORBIDDEN` |
| Weak ETag (`W/"3"`) | rejected, same 412 code `IF_MATCH_WEAK_FORBIDDEN` |
| List of etags | rejected unless it is exactly one strong tag |
| Body | RFC 7396 merge-patch (`Content-Type: application/merge-patch+json`) for scalar headers. RFC 6902 is Stage 4+ for list-element edits (audit C enterprise recs) — out of C's file ownership to specify the patch algebra |

**Server algorithm** (inside `transaction(fn)`, one client):

1. Parse `If-Match` → `expected_version` (integer ≥ 1). Failure → `400` `IF_MATCH_MALFORMED`.
2. `SELECT * FROM fin.<table> WHERE id = $id FOR UPDATE`.
3. 0 rows → `404` (or `404` via authz existence-hiding — Agent D / H).
4. If `row.version <> expected_version` → **do not write**. Return `412 PRECONDITION_FAILED` with:
   - `ETag: "<row.version>"`
   - `Content-Type: application/json`
   - body = **current server representation** of the resource (the row just locked), plus envelope `{ code: 'PRECONDITION_FAILED', category: 'CONFLICT', retryable: true, current: <rep> }`
5. Apply merge-patch. `undefined` = leave; `null` = clear where the column is nullable.
6. `UPDATE … SET … WHERE id = $id AND version = $expected_version`.
7. `rowCount = 0` (lost the race despite `FOR UPDATE` — should not happen on one row; treat as 412 and re-read).
8. Trigger sets `version = expected + 1`. Return `200` with `ETag: "<new_version>"` and the new representation.

**GET / HEAD** of the same resource **must** emit `ETag: "<version>"` so clients can PATCH.

**Not 409.** Audit C offered 409 or 412. This rebuild uses **412** (HTTP precondition, A §18 #5). 409 is reserved for idempotency `IN_FLIGHT` (E).

### 6.3 `invoice_sequences` exception

A §10.2: `UPDATE … SET next_n = next_n + 1 WHERE id = $1 RETURNING`. That increment **is** the concurrency control. A `version` column would serialize the same row and fight the increment (`WHERE version = $m` would fail the second issuer in a period). **No `+occ`.** Lock is `SELECT … FOR UPDATE` on the sequence row (table_rank 87) before increment.

### 6.4 Internal workers vs If-Match

Workers do not send HTTP headers. They `SELECT … FOR UPDATE` and `UPDATE … WHERE id AND version` (or status-machine predicates: `WHERE id = $1 AND status = 'OPEN'`). Status predicates are additional; they do not replace `version` on INTENT tables that have both.

---

## 7. Advisory-lock inventory

Pattern (live, correct — audit B §1): `backend/src/billing/products/renewal-scanner.js:162-172`.

```js
const client = await getPool().connect()
const { rows } = await client.query(
  'SELECT pg_try_advisory_lock($1) AS ok',
  [String(SCHEDULER_LOCK_ID)],
)
if (!rows[0]?.ok) {
  client.release()
  return false
}
lockClient = client   // held for process lifetime; release ⇒ lock drops
```

`fin.*` workers copy this: dedicated client, `pg_try_advisory_lock`, never `pg_advisory_lock` (blocking) at boot, never the request-path pool client.

**Do not reuse** `8734281374` (`SCHEDULER_LOCK_ID`). That key remains the legacy `commercial.*` renewal scanner until Stage 13. Colliding with it would silence either the legacy scheduler or the `fin` contract scanner on a mixed-deploy replica.

### 7.1 Key space

Prefer the two-int form so classes cannot collide: `pg_try_advisory_lock(class int4, key2 int4)`.

`class` values are constants in `backend/src/fin/foundation/advisory-locks.js` (Stage 1). This file is the registry.

| class | Name | key2 | Who may hold | Concurrent winners? |
|---|---|---|---|---|
| `1001` | `FIN_CONTRACT_RENEWAL` | `0` | Contract / entitlement renewal scanner (replaces renewal-scanner for `fin.contracts`) | **No** — singleton across the fleet |
| `1002` | `FIN_HOLD_EXPIRY` | `0` or shard `0..N-1` | Hold expiry worker | **Yes, sharded.** `key2=0` = singleton (default until volume needs shards). Shards partition `id` by `mod(hashtext(id::text), N)` |
| `1003` | `FIN_LOT_EXPIRY` | `0` or shard | Lot expiry worker | Same as 1002 |
| `1004` | `FIN_OUTBOX_PUBLISH` | `0` or shard | Outbox publisher | **Yes** if using `SKIP LOCKED` on `outbox_events` (A §13). Advisory is optional belt-and-braces; default **singleton** (`key2=0`) until a second publisher is load-tested |
| `1005` | `FIN_USAGE_DLQ` | `0` or shard | `usage_events_dlq` replay | Same as 1004 |
| `1006` | `FIN_DUNNING` | `0` | Dunning stepper | **No** — singleton. Steps have legal side effects (SUSPEND_USAGE) |
| `1007` | `FIN_BILLING_CLOSE` | `hash(billing_account_id)` | Period-close worker | **Yes, per billing_account.** Two workers may close *different* accounts. Same account: one winner |
| `1008` | `FIN_ACCOUNTING_CLOSE` | `hash(legal_entity_id)` | SOX close worker | **Yes, per legal_entity** |
| `1009` | `FIN_RECONCILIATION` | `env_code` (`1=LIVE`, `2=TEST`) | Reconciliation runner | **No** per environment — one LIVE run, one TEST run may overlap |
| `1010` | `FIN_AUTO_TOPUP` | `0` or shard | Auto top-up (Stage 7) | Sharded like 1002 |
| `1011` | `FIN_PARTITION_DDL` | `hash(residency_key)` | Legal-entity create / partition ensure | **No** per `residency_key` — see §7.4 |
| `1012` | `FIN_IDEMPOTENCY_SWEEP` | `0` | Expires `idempotency_keys` (E) | **No** |

`hash(uuid)` for `key2` is `('x' || right(replace(uuid::text, '-', ''), 8))::bit(32)::int` — stable, not `hashtext` of a locale-sensitive collation.

### 7.2 Concurrency matrix (who vs who)

| | 1001 | 1002 | 1003 | 1004 | 1005 | 1006 | 1007† | 1008† | 1009 | 1010 | 1011† | 1012 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **same class, same key2** | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| **same class, other key2** | n/a | many | many | many | many | n/a | many | many | LIVE∥TEST | many | many | n/a |
| **other class** | many | many | many | many | many | many | many | many | many | many | many | many |

† sharded. `1` = only one connection in the fleet holds that `(class, key2)`.

Request-path API processes hold **none** of these except `1011` during legal-entity create (short, dedicated client, released after `COMMIT` + partition exists — the one advisory that is **not** process-lifetime; see §7.4).

### 7.3 Losing the lock

`pg_try_advisory_lock` returned false: log `advisory_lock_not_acquired{class,key2}`, do not run the tick, release the attempt client. The winner's crash (TCP reset) drops the lock; the next tick on another replica acquires. This is the renewal-scanner contract.

Do **not** `pg_advisory_unlock` on a request client you do not own. Do **not** use session locks on a pooled request client — the next borrower would inherit the lock (`pg_advisory_lock` is session-level). That is why the dedicated `lockClient` is never released back to the pool.

### 7.4 `usage_events` LIST partition race (A §6.1)

Creating `platform_legal_entities` **must** create the matching `usage_events` LIST partition. `CREATE TABLE … PARTITION OF` cannot always join the entity `INSERT` transaction.

Order:

1. Dedicated client: `pg_try_advisory_lock(1011, hash(residency_key))`. Fail → 409 `PARTITION_DDL_IN_PROGRESS` (retryable).
2. `SELECT` existing partition (catalog).
3. If missing: `CREATE TABLE IF NOT EXISTS … PARTITION OF fin.usage_events FOR VALUES IN ($residency_key)`.
4. On the **request** transaction client: `INSERT platform_legal_entities`.
5. Unlock 1011 after both succeed (or after the entity insert is safely retryable because the partition is `IF NOT EXISTS`).

A usage insert that hits a missing partition is `23514` → `usage_events_dlq` with `PARTITION_MISSING` (A §6.2), never swallowed (audit A-2 lesson). The DLQ worker re-checks the partition under 1011.

---

## 8. Read-your-own-writes inside `transaction(fn)`

Live mechanism (audit B, `postgres-adapter.js:302-325`): `AsyncLocalStorage` pins one `pg` client for the duration of `work`. Nested `transaction(fn)` reuses the outer client (no `BEGIN` on `BEGIN`). `runLogged` uses `currentTxClient() || getPool()`.

**Contract for every `fin.*` writer (Stage 1), unchanged in spirit:**

| Rule | Meaning |
|---|---|
| One connection | All `find*` / `insert` / `update` / `query` inside `fn` use the ambient client |
| RYOW | A `SELECT` after an `INSERT` in the same `fn` sees the uncommitted row. A §18-style test already exists for raw `query()` (`transaction.test.js:116-142`); Stage 1 must also assert `findAll` / `findOne` (audit B §4 gap) |
| Isolation | `READ COMMITTED`. Uncommitted writes from **other** connections are invisible. Own writes are visible |
| Locks | `FOR UPDATE` taken in `fn` is held until `COMMIT`/`ROLLBACK` |
| Nested | No savepoints. An inner throw rolls back the **outer** work. If a command needs a nested rollback, it is two commands or an explicit `SAVEPOINT` added later via Decision Log — not silently |
| Cross-schema | Allowed on this one Postgres (`fin.*` + `public.*` identity reads). `transaction(fn)` is **not** valid across two databases (audit B §3 / risk 11) |
| Side effects | No HTTP / PSP / email inside `fn`. Those go to `fin.outbox_events` in the same `fn` (audit B-8) |
| Clock | `BusinessClock.now()` is read once per command and passed in. Do not `DEFAULT CURRENT_TIMESTAMP` on economic effect columns (A §1) |

**C-2 on the current adapter is out of scope to fix here.** Stage 1 `fin.*` writers must not call `update(coll, {id}, changes)` and must not read-modify-write outside `fn`. They `SELECT … FOR UPDATE` inside `fn` and `UPDATE … WHERE id AND version`. The existing adapter's read-before-`BEGIN` remains a live P0 on `commercial.*` until the Stage 1 foundation pass.

---

## 9. R2-1 — TRANSFER pair integrity (DL-025, mechanism DL-037)

A §4.3 already declares the two table constraints. This file owns the deferred cardinality assertion and the SQL that Stage 1 must ship.

### 9.1 Three constraints

```sql
-- 1. pair_id is a TRANSFER-only field (A / DL-025)
ALTER TABLE fin.ledger_transactions
  ADD CONSTRAINT chk_pair_id_transfer_only
  CHECK (pair_id IS NULL OR shape = 'TRANSFER');

-- 2. At most one leg per book per pair (A / DL-025)
CREATE UNIQUE INDEX uq_ledger_tx_pair_book
  ON fin.ledger_transactions (pair_id, book_id)
  WHERE pair_id IS NOT NULL;

-- 3. Exactly two rows per pair_id at COMMIT (DL-037). A CHECK cannot count.
CREATE OR REPLACE FUNCTION fin.assert_transfer_pair_cardinality()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pid uuid;
  n   integer;
BEGIN
  pid := COALESCE(NEW.pair_id, OLD.pair_id);
  IF pid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*) INTO n
    FROM fin.ledger_transactions
   WHERE pair_id = pid;

  IF n <> 2 THEN
    RAISE EXCEPTION
      'TRANSFER pair_id % must have exactly 2 rows at COMMIT, found %',
      pid, n
      USING ERRCODE = '23514',
            HINT = 'Insert both TRANSFER legs in one transaction(fn)';
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
```

`DELETE` is listed so a future REVOKE bypass still fails closed. The app role has no `DELETE` on APPEND_ONLY (A §1.1).

### 9.2 What each constraint catches

| Attempt | CHECK | UNIQUE(pair, book) | Deferred count=2 |
|---|---|---|---|
| `pair_id` on `FUNDING` | reject | | |
| Two legs, same book | | reject | |
| One leg, `COMMIT` | | | reject |
| Three legs, three books, `COMMIT` | | | reject |
| Two legs, two books, one `transaction(fn)` | pass | pass | pass |

A 3-leg insert in one transaction is rejected at `COMMIT` even if the writer issued three `INSERT`s. That is the named acceptance test in §12.

Each paired tx still conserves independently (`SUM(postings) = 0` deferred, A §4.3 I-01). `CLEARING` is an `account_type` in *that* book (DL-012), never a posting whose `book_id ≠ tx.book_id`.

---

## 10. R2-2 — FX-stamp enforcement (DL-026, mechanism DL-038)

A line 328 / §4.3 is prose. A table `CHECK` cannot join `ledger_books`. Mechanism is a **deferred constraint trigger** so both legs exist at `COMMIT` (the first `BEFORE INSERT` cannot see the counterpart).

```sql
CREATE OR REPLACE FUNCTION fin.assert_pair_fx_stamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  this_ccy  char(3);
  other_ccy char(3);
  other_fx  uuid;
BEGIN
  IF NEW.pair_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.currency INTO this_ccy
    FROM fin.ledger_books b
   WHERE b.id = NEW.book_id;

  SELECT b.currency, t.fx_rate_snapshot_id
    INTO other_ccy, other_fx
    FROM fin.ledger_transactions t
    JOIN fin.ledger_books b ON b.id = t.book_id
   WHERE t.pair_id = NEW.pair_id
     AND t.id <> NEW.id;

  -- Counterpart missing: cardinality trigger fails the COMMIT. Do not
  -- also demand an FX stamp on a 1-leg pair.
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
    -- One economic conversion: both legs stamp the same snapshot (DL-015).
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
```

Same-currency pair: `fx_rate_snapshot_id` may be NULL. Cross-currency: both legs non-NULL and equal. Destination residual posts `ADJUSTMENT` / `reason_code='FX_ROUNDING'` on the **destination** tx, still zero-sum (DL-015). No eighth `account_type`.

Postings: A §4.4 — `fx_rate_snapshot_id` required iff the parent tx has one. Stage 1 adds a `BEFORE INSERT` on `ledger_postings` that copies-or-rejects against `ledger_transactions.fx_rate_snapshot_id`. That is I-02-adjacent, not R2-2; test it with the I-02 suite.

---

## 11. Retry policy

| Class | Postgres / HTTP | Automatic retry? | Ceiling |
|---|---|---|---|
| Deadlock | `40P01` | yes, same `transaction(fn)`, full replay from lock step 1 | 3 attempts, equal jitter 20–80 ms |
| Serialization | `40001` | yes (if a path ever uses `SERIALIZABLE`) | 3 |
| Lock `NOWAIT` | `55P03` | expiry worker: skip row; request path: do not use `NOWAIT` | next tick |
| Unique once-per-source-shape | `23505` on `uq_ledger_tx_once_per_source_shape` / transfer-per-book | **no re-execute** — load the existing tx and treat as success (E §3) | — |
| OCC mismatch | 0 rows / HTTP 412 | **no** automatic retry on PATCH. Client re-GETs and re-applies | — |
| Idempotency `IN_FLIGHT` | HTTP 409 + `Retry-After` | client-side only | E |
| Advisory not acquired | — | skip tick | next interval |
| Insufficient balance | business denial | no | write `authorization_attempts` |

Idempotency-key claim happens **once** per attempt. A deadlock retry **reuses** the same `IN_FLIGHT` row (same fingerprint) inside the same request; it does not insert a second key.

---

## 12. Acceptance (real Postgres)

Same posture as A §18. Gated by `TEST_DATABASE_URL`. **If a test file name does not appear in the CI postgres job summary, it did not run.** Counts in this document are not evidence.

Stage 1 ships these files in the **same PR** as migrations `100`–`109` / the first `fin.*` writer. Not a follow-up.

| # | File | Asserts |
|---|---|---|
| D-T1 | `backend/src/fin/foundation/occ-tenants.test.js` | Two concurrent `UPDATE fin.tenants … WHERE id AND version=$same`. Exactly one `rowCount=1`; the loser is 0 rows. HTTP harness maps that to **412** with the winner's representation in the body |
| D-T2 | `backend/src/fin/foundation/advisory-lock.test.js` | Two workers race `pg_try_advisory_lock(1001, 0)` on two connections. Exactly one `ok=true`. Loser releases its client. Winner disconnect → loser's retry `ok=true` |
| D-T3 | `backend/src/fin/ledger/transfer-pair.test.js` | (a) `pair_id` on `FUNDING` → CHECK. (b) two TRANSFER same `pair_id`+`book_id` → unique. (c) **3-leg insert** (three books, one `pair_id`) in one `BEGIN` → `COMMIT` raises `23514`. (d) 1-leg `COMMIT` raises. (e) 2-leg two books commits |
| D-T4 | `backend/src/fin/ledger/fx-stamp.test.js` | Cross-currency pair, both legs `fx_rate_snapshot_id IS NULL` → `COMMIT` raises. Same pair with a snapshot on both legs commits. Same-currency pair without snapshot commits. Mismatched snapshots on the two legs raises |
| D-T5 | `backend/src/fin/foundation/lock-order-transfer.test.js` | Session A locks `book_lo` then waits on `book_hi`; session B must not lock `book_hi` first. Contended TRANSFER of the same pair uses `book_id ASC` — no `40P01` across 50 races (or 40P01 only then successful retry) |
| D-T6 | `backend/src/fin/lots/draw-order-lock.test.js` | Two AUTHORIZE on one holder, overlapping lots. Both lock `(holder_id, draw_priority, id)` ASC. No deadlock; `remaining_units` never negative |
| D-T7 | `backend/src/fin/holds/expiry-skip-locked.test.js` | Two expiry workers; one OPEN expired hold. Exactly one posts `EXPIRY`/`VOID`. The other sees 0 rows on `SKIP LOCKED`. CAPTURE concurrent with expiry: one winner, hold not double-finalised |
| D-T8 | `backend/src/fin/holds/expiry-nowait-book.test.js` | CAPTURE holds the book. Expiry's `FOR UPDATE NOWAIT` on that book fails; expiry skips; CAPTURE commits; hold is not EXPIRED |
| D-T9 | `backend/src/fin/facilities/reservation-lock.test.js` | Two FACILITY_RESERVE against one facility. Sum of `OPEN` reservations never exceeds `limit_minor` |
| D-T10 | `backend/src/fin/dunning/case-lock.test.js` | Two ADVANCE_DUNNING on one case. Exactly one step row for that `step_kind`; status is B's single successor |
| D-T11 | `backend/src/fin/foundation/transaction-ryow.test.js` | Inside `transaction(fn)`: insert `fin.tenants`, `findOne` sees it before commit; a second pool connection does not. Nested `transaction(fn)` reuses the client. Throw → rollback visible to the second pool |
| D-T12 | `backend/src/fin/foundation/if-match-middleware.test.js` | PATCH without `If-Match` → 428. `If-Match: *` → 412 `IF_MATCH_STAR_FORBIDDEN`. Stale `"1"` after a winning PATCH → 412 + current body + new `ETag`. Matching tag → 200 + bumped `ETag` |
| D-T13 | `backend/src/fin/foundation/version-trigger.test.js` | `UPDATE fin.tenants SET status = 'SUSPENDED'` (even with `version` in WHERE) results in `version = old+1` via trigger, not via app-supplied `version` |
| D-T14 | `backend/src/fin/ledger/i01-i02.test.js` | Carries A §18 #2 and #3 (conservation + same-book). Not owned to *design* by C but the pair/FX tests share the fixture |
| D-T15 | `backend/src/fin/foundation/partition-ddl-lock.test.js` | Two concurrent `FIN_PARTITION_DDL` for the same `residency_key`. One winner; both entity inserts succeed because `CREATE … IF NOT EXISTS` |

D-T1 and D-T2, D-T3, D-T4, and the fingerprint test in E are the five the Stage 0 brief named explicitly.

---

## 13. What this file will not do

- Will not edit `backend/src/persistence/postgres-adapter.js` or any `commercial.*` writer.
- Will not silently fix C-1 (pricing PATCH signature), A/B-1, A-2, A-4, E-3.
- Will not invent `fin.transfer_intents`. `economic_source_type = 'TRANSFER_INTENT'` (A §4.3) is a **type tag** on `economic_source_id`; if B needs a table, A appends a name. Until then `economic_source_id` is the command's correlation UUID (the `pair_id` is allowed to be that UUID).
- Will not introduce `SERIALIZABLE` as a global default.
- Will not reuse advisory key `8734281374`.

---

## 14. Open items

| ID | Item | Owner |
|---|---|---|
| D-OPEN-1 | Bind §4 command names to `C_TRANSACTION_MATRIX.md` ids when that file lands | Agent C (amend this file) / Agent B |
| D-OPEN-2 | `MIGRATE` cross-book? Must become a `TRANSFER` pair if yes (DL-012) | Agent B |
| D-OPEN-3 | `+occ` on `environments` + `usage_events_dlq`; no `+occ` on `invoice_sequences` | DL-040 — Agent A acknowledges / Stage 1 ships |
| D-OPEN-4 | `EXPIRED` status on `idempotency_keys` (A listed three statuses) | DL-039 / `E_IDEMPOTENCY.md` |
| D-OPEN-5 | RLS vs `FOR UPDATE` (does the app role see the row it is locking?) | Agent D / H |

A-Q2 is **closed** and is not in this table.
