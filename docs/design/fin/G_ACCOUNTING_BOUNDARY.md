# Deliverable G — Accounting boundary

**Stage:** 0 (§128)
**Owner:** Agent D (this file). Sits on A + DL-000…DL-028. B/C had not landed at write time; `accounting_periods.status` and `approval_requests` transitions follow A. If B renames a status, append a Decision Log row.
**Date:** 2026-08-18
**Status:** Stage 0 design. Closes **A-Q5**.
**Locks:** `fin.accounting_events`, `fin.accounting_periods`, `fin.revenue_allocation_groups`, `fin.revenue_allocation_lines`, `fin.tax_snapshots`, `fin.fx_rate_snapshots`, `fin.lots`, `fin.rated_usage`, `fin.invoices`, `fin.payments`, `fin.credit_notes` as specified in A.
**Does not:** write `ledger_postings` (the engine writes `accounting_events` only), invent tables, or silently remediate live P0s.

SOX 302/404 is the close discipline. ASC 606 / IFRS 15 is the revenue discipline. Tax is a snapshot at ISSUE (A §9.3), never a live re-read of `commercial.territories.vat_percent`.

---

## 0. One-sentence contract

The accounting engine **reads** economic facts (`rated_usage`, issued `invoices` + `tax_snapshots`, `payments`, `credit_notes` / `debit_notes`, lot expiries) and **writes only** `fin.accounting_events` (plus the allocation companions when the event is `CONSIDERATION_ALLOCATED`). It never inserts `ledger_postings`. A posting that needs to exist for conservation is created by the **ledger command** that already moved value (Stage 1 `ledger/transactions.js`); accounting is a projection, not a second ledger (DL-006).

---

## 1. Policy vs invariant

| Kind | Who may change it | Where it lives | Examples |
|---|---|---|---|
| **Invariant** | Nobody without a Decision Log + Stage 0 revision | Triggers, CHECKs, this file’s §4 | I-01/I-02; HARD_CLOSED reject; `policy_version` NOT NULL; `effective_at` inside the period; integer `*_minor` only; no write to `ledger_postings` |
| **Policy** | Versioned `AccountingPolicy` object, pinned on the event | Application module `backend/src/fin/accounting/policy/<version>.js` | When prepaid consideration becomes deferred revenue; breakage `ON_EXPIRY` vs `PROPORTIONAL_EXPECTED_BREAKAGE` (spec §74); standalone-selling-price weights; whether a credit note reverses revenue or is a concession |

`accounting_events.policy_version` is `TEXT NOT NULL` (A §9.1). Pin format: `YYYY-MM-DD.<slug>` e.g. `2026-08-18.launch`. The runner that inserts the event **copies the pin from the policy object that evaluated it**. Replaying an old invoice uses the **stamped** pin, not “whatever is current”.

There is no `fin.accounting_policies` table in A. Do not invent one. The versioned JS module **is** the policy artefact; its SHA-256 is written to `financial_audit_events.after_state` when a new pin is activated (Stage 9 admin).

Launch pin: `2026-08-18.launch` — default behaviours in §3.

---

## 2. `AccountingPolicy.evaluate*` input shape

A-Q5 asked which columns are **policy inputs** vs **invariants**. Invariants are listed so a policy author cannot “evaluate around” them. The engine refuses to call `evaluate*` when an invariant is already violated.

Common envelope (every `evaluate*`):

```
PolicyInput = {
  environment,                    -- invariant: must match every cited row
  legal_entity_id,                -- invariant: seller of record
  accounting_period_id,           -- invariant: period.status ∈ {OPEN, SOFT_CLOSED}; HARD_CLOSED → reject before evaluate
  clock,                          -- BusinessClock.now() — never Date.now
  actor_type, actor_id,           -- I-15
  policy_version,                 -- pin about to be stamped
  approval_request_id             -- required for BAD_DEBT_WRITE_OFF, HARD_CLOSED reopen (H)
}
```

### 2.1 `evaluateDeferredRevenueCreated`

**Trigger:** lot INSERT with `consideration_minor > 0` and `source_kind ∈ {PURCHASE, SUBSCRIPTION_GRANT}` after the FUNDING/GRANT ledger tx commits (outbox topic `accounting.lot_funded`). Bonus lots (`consideration_minor = 0`) **do not** create deferred revenue.

| Role | Columns |
|---|---|
| Policy inputs | `lots.source_kind`, `lots.consideration_minor`, `lots.currency`, `lots.expires_at`, `lots.granted_units`, `purchase_intents.quoted_minor` (if present), `contracts.billing_currency` |
| Invariants | `consideration_minor >= 0`; currency = book currency; `environment` match; amount to stamp = `consideration_minor` (policy may split across obligations, may **not** change the total) |

**Output:** zero or one `DEFERRED_REVENUE_CREATED` (`source_type='LOT'`, `source_id=lots.id`, `amount_minor=consideration_minor`) plus, when the lot funds more than one performance obligation, a `CONSIDERATION_ALLOCATED` event and group/lines (§3.7).

### 2.2 `evaluateRevenueRecognized`

**Trigger:** `rated_usage` INSERT with `amount_minor > 0` and `late_class ∈ {OPEN_PERIOD, PRE_INVOICE}` **or** capture of a hold that spends a consideration-bearing lot. `late_class = POST_INVOICE` / `CLOSED_ACCOUNTING` still recognizes, but the **period** is the **open** successor (A §9.0), never the HARD_CLOSED window.

| Role | Columns |
|---|---|
| Policy inputs | `rated_usage.amount_minor`, `currency`, `billable_units`, `late_class`, `price_version_id`, `contract_version_id`, `explanation` (SSP / tier trail), `lots.consideration_minor` remaining (via allocations), `revenue_allocation_lines` if a group already exists |
| Invariants | `amount_minor` is the rated integer — policy may defer a slice (breakage / remaining obligation) but the **sum of recognized + still-deferred** for that source equals the original consideration or the rated amount; `accounting_period_id` on the event is OPEN/SOFT_CLOSED; no UPDATE of a prior `rated_usage` row (I-12) |

**Output:** `REVENUE_RECOGNIZED` (`source_type='RATED_USAGE'` or `'LOT'`, `amount_minor` = recognized slice).

### 2.3 `evaluateReceivableCreated`

**Trigger:** invoice transition to `ISSUED` (Agent B owns the machine).

| Role | Columns |
|---|---|
| Policy inputs | `invoices.subtotal_minor`, `tax_minor`, `total_minor`, `currency`, `legal_entity_id`, `billing_account_id`, `issued_at` |
| Invariants | `subtotal_minor + tax_minor = total_minor` (F R070); `tax_snapshots` already frozen (F R073); receivable amount = `total_minor` (gross). Policy does **not** net unapplied cash here |

**Output:** `RECEIVABLE_CREATED` (`source_type='INVOICE'`, `amount_minor=total_minor`). Tax is a separate `TAX_ACCRUED` (§2.6), not folded in.

### 2.4 `evaluateBadDebtWriteOff`

**Trigger:** invoice → `UNCOLLECTIBLE` after `approval_requests.action_kind = 'WRITE_OFF'` is `EXECUTED`.

| Role | Columns |
|---|---|
| Policy inputs | `invoices.total_minor`, remaining unallocated (`total_minor − SUM(payment_allocations)`), `dunning_cases` last `step_kind`, `disputes.status` |
| Invariants | invoice status is `UNCOLLECTIBLE`; an `APPROVED`/`EXECUTED` write-off approval exists; amount ≤ remaining AR; this is **credit loss**, not a revenue reversal (spec §73). A concession that reverses revenue is a `credit_notes` path + `REVENUE_RECOGNIZED` negative event, not this method |

**Output:** `BAD_DEBT_WRITE_OFF` (`source_type='INVOICE'`, `amount_minor` = written-off AR).

### 2.5 `evaluateBreakageRecognized`

**Trigger:** `ledger_transactions.shape = 'EXPIRY'` on a lot (expiry worker, spec §67) **or** (launch-off, policy flag) periodic expected-breakage job.

| Role | Columns |
|---|---|
| Policy inputs | `lots.granted_units`, `lots.remaining_units`, `lots.consideration_minor`, `lots.expires_at`, `lots.source_kind` |
| Invariants | an `EXPIRY` tx exists for `ON_EXPIRY`; `remaining_units` already moved on the ledger (F R025); breakage money = `consideration_minor * remaining_units / granted_units` using **integer** arithmetic (truncate toward 0; residual 1-minor goes to the last event — never float) |
| Launch policy | `ON_EXPIRY` only. `PROPORTIONAL_EXPECTED_BREAKAGE` is a later pin, not `2026-08-18.launch` |

**Output:** `BREAKAGE_RECOGNIZED` (`source_type='LOT'`, `amount_minor` = computed breakage). Bonus lots (`consideration_minor = 0`) produce **no** event.

### 2.6 `evaluateTaxAccrued`

**Trigger:** same ISSUE transaction as `RECEIVABLE_CREATED`.

| Role | Columns |
|---|---|
| Policy inputs | `tax_snapshots.tax_treatment`, `vat_bps`, `tax_minor`, `jurisdiction`, `invoice_tax_lines` |
| Invariants | DL-017 CHECK (`STANDARD ⇒ vat_bps > 0`; else 0); `SUM(tax_snapshots.tax_minor) = invoices.tax_minor`; treatment is not re-derived from a territory table; `REVERSE_CHARGE` and `ZERO_RATED` both 0% and **must not** collapse (A §9.3) |

**Output:** one `TAX_ACCRUED` per snapshot (`source_type='TAX_SNAPSHOT'`, `source_id=tax_snapshots.id`, `amount_minor=tax_minor`). Zero-rated / exempt / out-of-scope / reverse-charge still write an event with `amount_minor = 0` so the treatment is auditable.

### 2.7 `evaluateConsiderationAllocated`

**Trigger:** multi-obligation purchase / subscription grant (ASC 606 allocation). Called from §2.1 when the contract has more than one `contract_components` performance obligation.

| Role | Columns |
|---|---|
| Policy inputs | `contract_components` (obligation keys), `price_versions` / SSP table in `explanation`, `lots.consideration_minor` (total transaction price) |
| Invariants | `SUM(revenue_allocation_groups.amount_minor) = parent event.amount_minor` (F R064); `SUM(lines) = group` (F R065); each line cites `rated_usage_id` **or** `invoice_line_id`, never neither; allocation is frozen at grant — later re-rates add adjustment lines, they do not UPDATE groups |

**Output:** `CONSIDERATION_ALLOCATED` + N groups (`obligation_key`, `amount_minor`) + M lines.

---

## 3. Default launch policies (`2026-08-18.launch`)

| Event | Default |
|---|---|
| `DEFERRED_REVENUE_CREATED` | 100% of `consideration_minor` on paid lots; 0 on bonus |
| `REVENUE_RECOGNIZED` | Recognize `rated_usage.amount_minor` when the spend draws a consideration-bearing lot, proportional to `units_drawn / granted_units` of remaining consideration; prepaid unused stays deferred |
| `RECEIVABLE_CREATED` | Gross `invoices.total_minor` at ISSUE |
| `BAD_DEBT_WRITE_OFF` | Remaining AR after allocations; requires WRITE_OFF approval |
| `BREAKAGE_RECOGNIZED` | `ON_EXPIRY` only; integer residual on last minor |
| `TAX_ACCRUED` | Snapshot as-is; never re-rate VAT |
| `CONSIDERATION_ALLOCATED` | Relative SSP from `price_versions` effective at grant; if a component has no SSP, reject the grant (`RATE_NOT_CONFIGURED`) rather than smuggle a guess |

---

## 4. Period close (DL-016 / A §9.0)

`fin.accounting_periods` is the **legal-entity** SOX close. It is not `fin.billing_periods` (per billing-account, invoicing).

| Status | New `accounting_events` | New `rated_usage` | Billing close |
|---|---|---|---|
| `OPEN` | Allowed if `effective_at ∈ [starts_at, ends_at)` | `late_class = OPEN_PERIOD` or `PRE_INVOICE` | Independent |
| `SOFT_CLOSED` | Allowed **only** as an adjustment booked into a still-`OPEN` period (usually the successor). The SOFT period itself accepts no new `effective_at` inside its window unless `approval_requests.action_kind = 'RECONCILIATION_OVERRIDE'` | Arriving usage is `late_class = POST_INVOICE` or `CLOSED_ACCOUNTING` and **stamps the open successor** as `accounting_period_id` | `BLOCK_BILLING_CLOSE` from F still applies if recon is red |
| `HARD_CLOSED` | **Rejected** (trigger below). No exception that writes `accounting_period_id = <hard id>` | Same reject if a writer tries to stamp the hard id | Close already done |

### 4.1 Late-arriving usage (`rated_usage.late_class`, A §6.7)

| `late_class` | When the rater stamps it | Where it books |
|---|---|---|
| `OPEN_PERIOD` | Billing period `OPEN` / `USAGE_CLOSING` | That period’s open accounting period |
| `PRE_INVOICE` | `USAGE_CLOSED` / `RATING_CLOSED` / `INVOICE_DRAFTED` | Same accounting period if still OPEN/SOFT; else successor |
| `POST_INVOICE` | Billing period `INVOICED` / `FINAL` | **Open** accounting period (adjustment / credit-debit path). Never mutates the issued invoice (I-12); Stage 10 issues a debit/credit note |
| `CLOSED_ACCOUNTING` | Accounting period SOFT or HARD at `occurred_at` | **Open successor only**. Stamping a HARD_CLOSED id is illegal (F R043) |

Classifier is the rater (Stage 5), not this engine. This engine **refuses** an event whose `accounting_period_id` is HARD_CLOSED regardless of `late_class`.

### 4.2 The only way to override a HARD_CLOSED period

A §9.0: override requires **both**:

1. `approval_requests.action_kind = 'RECONCILIATION_OVERRIDE'` reaching `APPROVED` with the two-admin rule when the subject is a platform book or a legal-entity close (H §4).
2. Agent B transition: `HARD_CLOSED → SOFT_CLOSED` **first**. New events then follow the SOFT_CLOSED row of the table above (book into an OPEN period, or into this period only with the same approval stamped on the event).

There is no “insert with `force=true`”. There is no UPDATE of an existing `accounting_events` row (APPEND_ONLY). A wrong event is reversed by a new event with negative `amount_minor` and `source_type` pointing at the original, plus `financial_audit_events`.

SOX 404: the reopen, the approval ids, and the reversing event are the audit package. `closed_by_actor_id` on the period is **not** cleared; add `<!-- OPEN: A §9.0 has no `reopened_at` / `reopened_by_actor_id`. Stage 9 should append those columns via a DL row rather than overload `closed_at`. -->`

### 4.3 Trigger — HARD_CLOSED reject

Stage 9 migration (named here so Stage 1’s A §18 #9 can exist as soon as `accounting_events` is born):

```sql
CREATE FUNCTION fin.trg_accounting_event_period_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  st TEXT;
BEGIN
  SELECT status INTO st
  FROM fin.accounting_periods
  WHERE id = NEW.accounting_period_id
    AND environment = NEW.environment
  FOR SHARE;

  IF st IS NULL THEN
    RAISE EXCEPTION 'ACCOUNTING_PERIOD_MISSING';
  END IF;
  IF st = 'HARD_CLOSED' THEN
    RAISE EXCEPTION 'ACCOUNTING_PERIOD_HARD_CLOSED';
  END IF;
  IF NEW.effective_at < (SELECT starts_at FROM fin.accounting_periods WHERE id = NEW.accounting_period_id)
     OR NEW.effective_at >= (SELECT ends_at FROM fin.accounting_periods WHERE id = NEW.accounting_period_id) THEN
    RAISE EXCEPTION 'ACCOUNTING_EVENT_EFFECTIVE_OUT_OF_RANGE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounting_events_period_guard
  BEFORE INSERT ON fin.accounting_events
  FOR EACH ROW
  EXECUTE FUNCTION fin.trg_accounting_event_period_guard();
```

`SOFT_CLOSED` is allowed through this trigger (the **application** then checks that the event is an approved adjustment or that it is booking to a different OPEN period). Putting SOFT in the trigger would block the documented override path.

---

## 5. Boundary: reads, writes, rejects

### 5.1 Reads (never writes these)

| Source | Why the engine reads it |
|---|---|
| `rated_usage` | Recognition basis; `late_class`; `accounting_period_id` already proposed by the rater |
| `invoices` + `invoice_lines` + `invoice_tax_lines` | Receivable + tax + allocation lines |
| `tax_snapshots` | Frozen VAT decision |
| `payments` + `payment_allocations` + `unapplied_cash` | Remaining AR for write-off; never to rewrite cash |
| `credit_notes` / `debit_notes` | Concession vs reversal classifier |
| `lots` + `lot_allocations` + EXPIRY `ledger_transactions` | Breakage + remaining deferred |
| `revenue_allocation_groups` / `_lines` | Already-frozen SSP (read to recognize against) |
| `fx_rate_snapshots` (`MONTH_AVG`) | Presentation only (§6) |
| `accounting_periods` | Gate |

### 5.2 Writes

| Table | When |
|---|---|
| `fin.accounting_events` | Only write. APPEND_ONLY. |
| `fin.revenue_allocation_groups` / `fin.revenue_allocation_lines` | Only with `CONSIDERATION_ALLOCATED` in the **same** DB transaction |
| `fin.financial_audit_events` | Every evaluate* (via the shared audit writer) |
| `fin.outbox_events` | `accounting.event_created` for downstream report extractors |

**Forbidden writes:** `ledger_postings`, `ledger_transactions`, `account_balances`, `lots.remaining_units`, `invoices.*` after ISSUE, `tax_snapshots`, `rated_usage` (re-rate is a new row by Stage 5, not by this engine), `fx_rate_snapshots`.

### 5.3 Reject codes

| Code | When |
|---|---|
| `ACCOUNTING_PERIOD_HARD_CLOSED` | Insert cites HARD_CLOSED (trigger) |
| `ACCOUNTING_PERIOD_MISSING` | Bad FK / env mismatch |
| `ACCOUNTING_EVENT_EFFECTIVE_OUT_OF_RANGE` | `effective_at` outside window |
| `ACCOUNTING_POLICY_PIN_MISMATCH` | Caller tried to stamp a pin ≠ the module that ran |
| `ACCOUNTING_CONSIDERATION_UNBALANCED` | Allocation groups ≠ parent |
| `ACCOUNTING_WRITE_OFF_UNAPPROVED` | BAD_DEBT without WRITE_OFF approval |
| `RATE_NOT_CONFIGURED` | SSP missing on a multi-obligation grant |

---

## 6. FX presentation-currency consolidation (DL-015)

Books are single-currency (A §4.1). Cross-currency **economic** movement is paired TRANSFER txs with `fx_rate_snapshot_id` of kind `TRANSACTION` or `DAILY_ECB` and residual `ADJUSTMENT` / `FX_ROUNDING` (Agent C trigger, DL-026). **This engine does not participate.**

Platform / group reports that need one presentation currency:

1. Read `fx_rate_snapshots` where `snapshot_kind = 'MONTH_AVG'` and `effective_at` is the period’s month.
2. Convert `accounting_events.amount_minor` with rational `rate_bps_num / rate_bps_den` (integer). Residual 1-minor stays on the **report row**, not as a new posting.
3. **Never** UPDATE `ledger_books`, `ledger_postings`, or `accounting_events` to “normalize” currency.

A missing MONTH_AVG snapshot is `ERROR` on the report job, not a silent 1:1 fallback (audit A-2 class).

---

## 7. ASC 606 walk (groups + lines)

```
purchase / subscription grant
  → evaluateDeferredRevenueCreated
  → evaluateConsiderationAllocated          -- if >1 obligation
       revenue_allocation_groups.obligation_key
       revenue_allocation_lines → (rated_usage | invoice_line)
  → (later) evaluateRevenueRecognized per line as usage is rated
  → (expiry) evaluateBreakageRecognized on leftover consideration
```

Standalone selling prices come from `price_versions` effective at grant, not from a later price edit (I-12). A price change mid-contract is a new `contract_versions` row (Agent B); new consumption allocates under the new version; already-recognized amounts stay.

---

## 8. Stage mapping

| Work | Stage |
|---|---|
| Period table + HARD_CLOSED trigger (A §18 #9) | 1 (table) / 9 (engine) |
| `evaluate*` modules + launch pin | 9 |
| Invoice ISSUE hooks | 10 |
| Breakage worker hook | 6 (expiry) + 9 (event) |
| MONTH_AVG report | 12 (ops UI) / 9 (job) |

Live P0s are not remediations in this file. `commercial.billing_credit_notes` is not `fin.credit_notes` (A §14).

---

## 9. Acceptance (A §18 posture)

File names must appear in the CI **postgres** job summary.

| # | Test file | Asserts |
|---|---|---|
| G1 | `backend/src/fin/accounting/hard-closed-reject.postgres.test.js` | INSERT `accounting_events` with `accounting_period_id` HARD_CLOSED → `ACCOUNTING_PERIOD_HARD_CLOSED`. Matches A §18 #9 |
| G2 | `backend/src/fin/accounting/soft-closed-successor.postgres.test.js` | `late_class = CLOSED_ACCOUNTING` stamps an OPEN successor, not the SOFT/HARD id |
| G3 | `backend/src/fin/accounting/reopen-requires-override.postgres.test.js` | HARD→SOFT without `RECONCILIATION_OVERRIDE` rejected; with approved request, SOFT accepts an adjustment event into the **open** period |
| G4 | `backend/src/fin/accounting/no-direct-postings.postgres.test.js` | Accounting service role / function cannot `INSERT fin.ledger_postings` (H grants) |
| G5 | `backend/src/fin/accounting/policy-pin.postgres.test.js` | Event.policy_version equals the module pin; replay of an old invoice with a new pin still writes the **old** pin |
| G6 | `backend/src/fin/accounting/allocation-balance.postgres.test.js` | Groups ≠ parent → `ACCOUNTING_CONSIDERATION_UNBALANCED`; lines ≠ group same |
| G7 | `backend/src/fin/accounting/breakage-integer.postgres.test.js` | `consideration_minor=100`, `granted=3`, `remaining=1` → breakage `33` or `34` with residual documented; never `33.333` |
| G8 | `backend/src/fin/accounting/tax-snapshot-not-reread.postgres.test.js` | Changing a territory VAT after ISSUE does not change `TAX_ACCRUED` or `tax_snapshots` |
| G9 | `backend/src/fin/accounting/fx-month-avg-readonly.postgres.test.js` | Presentation job reads MONTH_AVG; asserting `UPDATE fin.ledger_postings` in that job → insufficient privilege |
| G10 | `backend/src/fin/accounting/write-off-approval.postgres.test.js` | `evaluateBadDebtWriteOff` without WRITE_OFF approval → `ACCOUNTING_WRITE_OFF_UNAPPROVED` |
| G11 | `backend/src/fin/accounting/bonus-lot-no-deferred.postgres.test.js` | `consideration_minor = 0` → zero `DEFERRED_REVENUE_CREATED` rows |

---

## 10. A-Q5 close

**A-Q5:** `AccountingPolicy.evaluate*` input shape (policy vs invariant) — **closed**. §2 is the shape. `policy_version` is the pin. HARD_CLOSED reject is a trigger, not a convention. FX MONTH_AVG is read-only consolidation. B owns the HARD→SOFT transition name; this file names the approval kind it must require.
