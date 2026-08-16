# Billing Enterprise-Spec Rebuild Plan

**Date:** 2026-08-16
**Owner:** Architect (Claude) + implementers
**Basis:** the user-supplied _Enterprise Credit, Metering, Rating, Billing & Financial Ledger — Canonical Production Implementation Specification_ (131 sections)
**Related:** `docs/audit/BILLING_SPEC_AUDIT_2026-08.md`

**Directive:** close every gap the audit identified. **Drop nothing.** Sequence follows the spec's §127 Stages 1-12 exactly. Do not reorder unless the user explicitly authorizes it in writing.

**Scale reality check.** The audit found 105 missing sections + 6 that actively violate spec + 14 partial. The rebuild is not a sprint — it is a sustained multi-month program. Every stage below is itself a sprint. Estimates are calendar-weeks assuming this is the sole priority for the implementer; adjust for parallel work.

**Non-negotiables at every stage:**
- New tables land in a **new** schema (`fin.*` — the Financial Control Plane) so the legacy `commercial.*` schema stays working during migration.
- Existing `commercial.*` tables are frozen for new features; migrations either shim to the new schema or mark as deprecated.
- Every acceptance test in §117-126 runs green before moving to the next stage.
- Reconciliation checks R001-R092 for each stage pass green before moving on.
- No `commercial.*` write-path is deleted until its `fin.*` replacement is dual-writing and reconciling for at least one full billing period.

---

## Executive Roadmap

| Stage | Spec § | Focus | Weeks | Exit condition |
|---|---|---|---|---|
| **0. Foundation prep** | 127 §128 | Deliverables A-H | 1 | All 8 pre-implementation deliverables published + user-approved |
| **1. Foundation** | 127 §1 | Environments, entities, books, accounts, postings, balances, lots, allocations, idempotency, outbox, dedup, RLS, audit, reconciliation framework | 6-8 | §117 acceptance tests + R001-R023 green |
| **2. Usage plane** | 127 §2 | `fin.usage_events` w/ correction shape + permanent source dedup + late-timestamp fields | 2-3 | §118 acceptance tests + R030-R033 green |
| **3. Metering** | 127 §3 | `fin.meters` + `fin.meter_versions` + `fin.metered_usage` + provenance + declarative filter DSL + computation hash | 3-4 | §119 acceptance tests green |
| **4. Contracts + Pricing** | 127 §4 | `fin.contracts` / `contract_versions` / `contract_components` + `fin.prices` / `price_versions` w/ all 7 pricing models + effective-time resolution | 4-5 | Contract state machine green + no overlapping-version constraint enforced |
| **5. Rating** | 127 §5 | `fin.rated_usage` w/ explanation JSON + `rating_hash` + late-event classification + re-rating adjustments + pricing simulator | 4-5 | §120 acceptance tests + R040-R044 green |
| **6. Credit authorization** | 127 §6 | Applicable balances + funding resolver + `fin.holds` (authorize/capture/void/expire) + `fin.usage_limits` + `fin.limit_counters` + hierarchy + control matrix | 5-6 | §121 acceptance tests + R020-R023 green |
| **7. Funding** | 127 §7 | `fin.purchase_intents` + PSP integration + paid vs bonus lots + auto top-up worker + grants + transfers | 4-5 | §123 (partial) + purchase state machine green |
| **8. Postpaid** | 127 §8 | `fin.credit_facilities` + `fin.facility_reservations` + hybrid funding + capture exposure + receivables + dunning | 4-5 | §122 acceptance tests + R050-R053 green |
| **9. Accounting** | 127 §9 | `fin.accounting_events` + policy engine + versioned policies + deferred revenue + revenue allocation + credit loss + breakage + tax boundary | 5-6 | §123 acceptance tests + R060-R063 green |
| **10. Billing** | 127 §10 | `fin.billing_periods` state machine + `fin.invoices` + `invoice_sequences` per legal entity + credit/debit notes + payment allocation | 4-5 | §124 acceptance tests + R070-R073 green |
| **11. Vendor economics** | 127 §11 | `fin.vendors` + `vendor_rate_versions` + `vendor_usage_events` + `vendor_statements` + reconciliation + margin | 3-4 | §125 acceptance tests + R080-R083 green |
| **12. Operations** | 127 §12 | Full 15-section admin control centre + 24 KPIs + exceptions queue (18 types) + approvals UI + pricing simulator UI + audit UI | 4-5 | Traversal test from §130 passes end-to-end |
| **13. Migration + cutover** | — | Dual-write cutover: freeze `commercial.*`, backfill `fin.*`, prove parity, switch writers, deprecate legacy | 3-4 | Legacy read-only for 1 billing period + reconciliation R090-R092 green |

**Total calendar:** 52-70 weeks (~12-16 months) at single-implementer pace, assuming no parallel product work. Every stage ships production-ready; no MVP snapshots.

---

## Stage 0 — Foundation Prep (§128 Deliverables)

Before writing ANY implementation code, produce and validate:

### Deliverable A — Entity model
File: `docs/design/fin/A_ENTITY_MODEL.md`
- Every table with columns, types, FK targets, indexes
- Includes: `platforms`, `environments`, `platform_legal_entities`, `tenants`, `holders`, `billing_accounts`, `organisational_nodes`, `cost_centres`, `ledger_books`, `ledger_accounts`, `ledger_transactions`, `ledger_postings`, `account_balances`, `lots`, `lot_applicability_rules`, `lot_allocations`, `holds`, `usage_limits`, `limit_counters`, `contracts`, `contract_versions`, `contract_components`, `prices`, `price_versions`, `meters`, `meter_versions`, `metered_usage`, `metered_usage_sources`, `usage_events`, `rated_usage`, `accounting_events`, `billing_periods`, `invoices`, `invoice_lines`, `invoice_tax_lines`, `invoice_adjustments`, `invoice_payment_allocations`, `invoice_sequences`, `credit_notes`, `debit_notes`, `payments`, `payment_allocations`, `unapplied_cash`, `credit_facilities`, `facility_reservations`, `dunning_cases`, `dunning_steps`, `purchase_intents`, `vendors`, `vendor_products`, `vendor_rate_cards`, `vendor_rate_versions`, `vendor_usage_events`, `vendor_reported_usage`, `vendor_cost_estimates`, `vendor_actual_costs`, `vendor_statements`, `vendor_statement_lines`, `approval_requests`, `approval_actions`, `idempotency_keys`, `outbox_events`, `authorization_attempts`, `reconciliation_runs`, `reconciliation_checks`, `reconciliation_drift`, `reconciliation_resolution`.
- Approx 50-60 tables. All in `fin.*` schema.

### Deliverable B — State machines
File: `docs/design/fin/B_STATE_MACHINES.md`
- `contract` (DRAFT / ACTIVE / SUSPENDED / TERMINATED / EXPIRED)
- `hold` (OPEN / CAPTURED / VOIDED / EXPIRED)
- `facility` (PENDING / ACTIVE / PAUSED / SUSPENDED / CLOSED)
- `purchase` (CREATED / PAYMENT_PENDING / PAID / FAILED / CANCELED / REFUNDED)
- `invoice` (DRAFT / APPROVED / ISSUED / PART_PAID / PAID / VOID / UNCOLLECTIBLE)
- `billing_period` (OPEN / USAGE_CLOSING / USAGE_CLOSED / RATING_CLOSED / INVOICE_DRAFTED / INVOICED / FINAL)
- `approval_request` (REQUESTED / APPROVED / REJECTED / CANCELED / EXECUTED / EXPIRED)
- `dunning_case` (state per dunning step)
- `lot` (ACTIVE / EXHAUSTED / EXPIRED / FROZEN)

Each state machine documented with permitted transitions + required guards + audit expectations.

### Deliverable C — Transaction matrix
File: `docs/design/fin/C_TRANSACTION_MATRIX.md`
For every economic command (~40 commands): fund / hold / capture / void / expire / spend / refund / grant / transfer / adjustment / migrate / issue-invoice / apply-payment / reconcile / …
- Rows locked
- Tables inserted
- Tables updated
- Postings created (with exact shape)
- Outbox events created
- Rollback behaviour

### Deliverable D — Concurrency strategy
File: `docs/design/fin/D_CONCURRENCY.md`
- Global lock order: `ledger_book_id → account hierarchy depth → account_id`
- Advisory-lock IDs per subsystem
- Which paths use `SELECT FOR UPDATE`, which use `WHERE balance_units >= :amount` optimistic
- Retry policy per error class

### Deliverable E — Idempotency matrix
File: `docs/design/fin/E_IDEMPOTENCY.md`
For every mutation:
- Request-idempotency key requirement (with fingerprint hashing)
- Source economic uniqueness (permanent, non-expiring)
- Duplicate-request behavior (replay / reject / in-flight)

### Deliverable F — Reconciliation matrix
File: `docs/design/fin/F_RECONCILIATION.md`
Every check R001-R092 mapped to:
- Source-of-truth query
- Comparison query
- Expected result
- Severity + response action
- Owning subsystem

### Deliverable G — Accounting boundary
File: `docs/design/fin/G_ACCOUNTING_BOUNDARY.md`
- Which decisions are policy (configurable, versioned) vs engineering invariant (hard-coded)
- Policy interface signatures (`AccountingPolicy.evaluate*`)
- Default policies for launch

### Deliverable H — Security matrix
File: `docs/design/fin/H_SECURITY.md`
- Table-by-table RLS policies
- Role-by-role capability matrix (11+ distinct capabilities per §99)
- Application-role vs system-role separation
- Force-RLS on/off table

**Exit criterion:** user reviews and approves all 8 deliverables. NO IMPLEMENTATION until then.

---

## Stage 1 — Foundation (spec §127-Stage-1)

**Prerequisite:** Stage 0 approved.

### Migrations (all in `fin.*` schema)

1. `100_fin_schema_bootstrap.sql` — create schema, extensions
2. `101_fin_environments_entities.sql` — platforms, environments, legal entities, tenants, holders, billing_accounts, org nodes, cost centres
3. `102_fin_ledger_books_accounts.sql` — ledger_books, ledger_accounts (7 types)
4. `103_fin_ledger_transactions_postings.sql` — ledger_transactions, ledger_postings + book-containment trigger + transaction-conservation deferred trigger
5. `104_fin_account_balances.sql` — account_balances cache
6. `105_fin_lots.sql` — lots (10 source_kinds) + lot_applicability_rules + lot_allocations
7. `106_fin_idempotency_outbox.sql` — idempotency_keys + outbox_events + permanent economic-dedup indexes
8. `107_fin_audit.sql` — financial_audit_events
9. `108_fin_reconciliation.sql` — reconciliation_runs / _checks / _drift / _resolution
10. `109_fin_rls.sql` — ENABLE + FORCE RLS on every tenant-scoped table + policies

### Service modules (all under `backend/src/fin/`)

- `foundation/entities.js` — CRUD for entities
- `foundation/environments.js` — LIVE/TEST scoping + guards
- `foundation/legal-entities.js`
- `ledger/books.js` — CRUD, uniqueness rules
- `ledger/accounts.js` — CRUD, account_type constraints
- `ledger/transactions.js` — the ONLY writer for postings, atomically creates tx + N postings
- `ledger/balance-cache.js`
- `lots/lots.js` — issue/adjust/query; never mutate remaining_units outside allocations
- `lots/allocations.js` — record draws + restores
- `idempotency/keys.js` — request-idempotency middleware
- `outbox/writer.js` + `outbox/publisher.js` (worker)
- `audit/writer.js`
- `reconciliation/runner.js` — the runs coordinator
- `reconciliation/checks/R001_transaction_conservation.js` — R001 through R023 for Stage 1
- `security/rls-policies.js` — declarative RLS bootstrap

### Tests (§117 + §116 + R001-R023)

- Property-based test harness (§116) — random operation sequences with all-invariants-after-each-sequence check
- 10 ledger acceptance tests from §117
- Every one of R001-R023 (transaction/book/balance/cross-book/lots/holds/etc.)
- RLS-per-table tests (§126)

**Exit:** all above green, sustained across 1000+ random operation sequences.

---

## Stage 2 — Usage Plane (spec §127-Stage-2)

**Prerequisite:** Stage 1 exited.

### Migration
- `120_fin_usage_events.sql` — `fin.usage_events` with full spec schema (§6), UNIQUE(environment, source_system, source_event_id), correction/cancellation/replacement kinds, corrects_event_id, ingestion_version

### Services
- `usage/ingest.js` — accepts raw events, enforces source dedup, writes immutably
- `usage/corrections.js` — creates CORRECTION/CANCELLATION/REPLACEMENT rows
- `usage/late-timestamps.js` — occurred_at / received_at / metered_at / rated_at / billing_period / accounting_effective_period fields
- `usage/schema-validation.js` — validates event_type against registered schema

### Tests (§118 + R030-R033)
- 7 usage acceptance tests
- Property-based: 100 identical source events → one usage fact
- Late-arrival: out-of-order events produce identical meter result
- TEST event blocked from LIVE meter

---

## Stage 3 — Metering (spec §127-Stage-3)

**Prerequisite:** Stage 2 exited.

### Migrations
- `130_fin_meters.sql` — meters + meter_versions with aggregation_type (6 types), filter_definition JSONB (validated), effective_from/to
- `131_fin_metered_usage.sql` — metered_usage + metered_usage_sources

### Services
- `metering/registry.js` — meter + meter_version CRUD (versions are append-only)
- `metering/filter-engine.js` — declarative operator DSL (EQ/NEQ/IN/NOT_IN/GT/GTE/LT/LTE/EXISTS/NOT_EXISTS/AND/OR) with allowed-field schema per event_type
- `metering/aggregators/` — COUNT / SUM / MAX / UNIQUE_COUNT / LATEST / TIME_WEIGHTED
- `metering/hash.js` — deterministic computation_hash
- `metering/worker.js` — evaluates meters on schedule + records provenance

### Tests (§119)
- Per-aggregation-type deterministic result tests
- Predicate + dimension grouping tests
- Effective meter-version boundary tests
- Correction propagation tests

---

## Stage 4 — Contracts + Pricing (spec §127-Stage-4)

**Prerequisite:** Stage 3 exited.

### Migrations
- `140_fin_contracts.sql` — contracts + contract_versions (no overlap constraint) + contract_components (12 types w/ validated JSONB)
- `141_fin_prices.sql` — prices + price_versions (7 pricing_models w/ CREDIT|FIAT currency_unit)

### Services
- `contracts/contracts.js` — CRUD + state machine (DRAFT/ACTIVE/SUSPENDED/TERMINATED/EXPIRED)
- `contracts/versions.js` — append-only versioning; no-overlap enforcement
- `contracts/components.js` — polymorphic component validation per type
- `contracts/effective-time.js` — resolver: given (contract_id, timestamp) → version
- `pricing/catalog.js` — CRUD
- `pricing/versions.js` — append-only
- `pricing/resolvers/` — one file per pricing_model (per_unit, flat, package, graduated_tier, volume_tier, percentage, stairstep) — no shared "calculate" function that hides the model
- `pricing/dimension-resolver.js` — deterministic precedence resolver

### Tests
- Contract state-machine acceptance
- No-overlap enforcement
- Each pricing_model against explicit fixtures
- Dimension precedence with ambiguity rejection at config time

---

## Stage 5 — Rating (spec §127-Stage-5)

**Prerequisite:** Stage 4 exited.

### Migrations
- `150_fin_rated_usage.sql` — rated_usage (immutable) + rating_hash + explanation JSONB + adjustment linkage

### Services
- `rating/engine.js` — the single rating write path; computes (contract_version, price_version, included, billable, tier breakdown) and produces `rated_usage`
- `rating/explanation.js` — renders spec §23 JSON shape
- `rating/late-events.js` — classifies + routes per §26 (open period / pre-invoice / post-invoice / closed accounting)
- `rating/rerating.js` — creates adjustment records; never mutates
- `rating/simulator.js` — non-financial simulation service tagged NON-FINANCIAL

### Tests (§120 + R040-R044)
- All 12 rating acceptance tests
- Deterministic rating_hash: same inputs → same hash across runs
- Re-rating creates delta not mutation
- Simulator writes tagged non-financial rows only

---

## Stage 6 — Credit Authorization (spec §127-Stage-6)

**Prerequisite:** Stage 5 exited.

### Migrations
- `160_fin_holds.sql` — holds with 4-state machine
- `161_fin_usage_limits.sql` — usage_limits + limit_counters w/ period_key discipline
- `162_fin_control_matrix.sql` — allow_prepaid_usage / _postpaid / _purchases / _transfers / _refunds / _grants + reason codes

### Services
- `credit/funding-resolver.js` — funding candidate selection with hierarchy + escalation semantics (§62-63)
- `credit/holds.js` — authorize (11-step) / capture (10-step) / void (10-step)
- `credit/hold-expiry-worker.js` — SKIP LOCKED batch, poisoned-hold isolation
- `credit/limits.js` — check-and-consume with breach behavior
- `credit/lot-resolver.js` — deterministic draw order per §39
- `credit/controls.js` — 6-flag control matrix with reason enum

### Tests (§121 + R020-R023)
- All 8 lot acceptance tests
- Hold void restores to exact original lots
- Hold expiry worker handles poisoned holds
- Deterministic lot draw across 1000 randomized inputs

---

## Stage 7 — Funding (spec §127-Stage-7)

**Prerequisite:** Stage 6 exited.

### Migrations
- `170_fin_purchase_intents.sql` — full purchase-intent lifecycle
- `171_fin_grants_transfers.sql`

### Services
- `funding/products.js` — credit products (units + bonus + price + currency)
- `funding/quotes.js`
- `funding/purchase-intents.js` — state machine
- `funding/psp/` — pluggable PSP adapters (Stripe, Airwallex, Areeba, …); confirmation uses UNIQUE(provider, provider_event_id) permanently
- `funding/paid-lots.js` — paid + bonus stored as SEPARATE lots (§51)
- `funding/auto-topup-worker.js` — with cooldowns, caps, failure threshold, suspension

### Tests
- Purchase state machine acceptance
- Paid vs bonus lot separation
- PSP retry idempotency
- Auto top-up never charges inline; never charges twice; respects caps

**Cross-cutting:** the 501'd `/api/{agent,agency}/credits/top-up` endpoints from 7b.1c/17 get UN-501'd here — pointing to the new `funding/purchase-intents` flow.

---

## Stage 8 — Postpaid (spec §127-Stage-8)

**Prerequisite:** Stage 7 exited.

### Migrations
- `180_fin_credit_facilities.sql`
- `181_fin_facility_reservations.sql`
- `182_fin_dunning.sql`

### Services
- `postpaid/facilities.js` — CRUD + status history
- `postpaid/reservations.js` — reserved_minor accounting
- `postpaid/hybrid-resolver.js` — order per §58 (eligible prepaid → committed → other purchased → facility for shortfall)
- `postpaid/capture.js` — reserves → captures → creates receivable + revenue event (8-step)
- `postpaid/direct-spend.js`
- `dunning/cases.js` + `dunning/steps.js` + `dunning/worker.js`

### Tests (§122 + R050-R053)
- All 10 postpaid acceptance tests
- Concurrent facility over-authorization prevented
- Postpaid captured lots remain zero (immediately consumed)
- Partial payment clears correct receivable amount

---

## Stage 9 — Accounting (spec §127-Stage-9)

**Prerequisite:** Stage 8 exited.

### Migrations
- `190_fin_accounting_events.sql` — accounting_events with 10+ event kinds + accounting_policy_version stamp
- `191_fin_revenue_allocation.sql` — revenue_allocation_groups + revenue_allocation_lines

### Services
- `accounting/events.js` — writer
- `accounting/policy-engine.js` — versioned policies with `evaluateFunding/Consumption/Expiry/Refund/PostpaidCapture/WriteOff`
- `accounting/deferred-revenue.js`
- `accounting/receivables.js`
- `accounting/credit-loss.js` — SEPARATE from revenue reversal (§73)
- `accounting/breakage.js` — ON_EXPIRY or PROPORTIONAL_EXPECTED_BREAKAGE
- `tax/service.js` — separate boundary, snapshots on invoice per §75

### Tests (§123 + R060-R063)
- All 9 accounting acceptance tests
- Deferred roll-forward reconciles
- Receivable roll-forward reconciles
- Credit-loss roll-forward reconciles
- No revenue reversal from mere collection failure

---

## Stage 10 — Billing (spec §127-Stage-10)

**Prerequisite:** Stage 9 exited.

### Migrations
- `200_fin_billing_periods.sql` — 7-state state machine
- `201_fin_invoices.sql` — invoice + invoice_line + invoice_tax_line + invoice_adjustment + invoice_payment_allocation
- `202_fin_invoice_sequences.sql` — per (seller_legal_entity, jurisdiction, doc_type, fiscal_context)
- `203_fin_payments.sql` — payments + payment_allocation + unapplied_cash

### Services
- `billing/period-close.js` — 12-step process (§77) as a workflow
- `billing/invoice-assembler.js`
- `billing/invoice-issuer.js` — allocates sequence number ONLY on issue; never reuses
- `billing/credit-note.js` + `billing/debit-note.js`
- `billing/payment-allocation.js`

### Tests (§124 + R070-R073)
- All 7 billing acceptance tests
- Invoice source lines reconcile
- Issued invoice immutable
- Late post-invoice usage → adjustment document
- Void keeps original invoice number

---

## Stage 11 — Vendor Economics (spec §127-Stage-11)

**Prerequisite:** Stage 10 exited (but can start in parallel with Stage 12).

### Migrations
- `210_fin_vendors.sql` — vendors + vendor_products + vendor_rate_cards + vendor_rate_versions
- `211_fin_vendor_usage.sql` — vendor_usage_events + vendor_reported_usage + vendor_cost_estimates + vendor_actual_costs
- `212_fin_vendor_statements.sql`

### Services
- `vendor/registry.js`
- `vendor/usage-ingest.js`
- `vendor/statement-ingest.js`
- `vendor/reconciliation.js` — 6-way variance (A/B/C/D/E/F) w/ variance reason classification (10 codes)
- `vendor/margin.js` — recognized_revenue − attributable_provider_cost = contribution_margin

### Tests (§125 + R080-R083)
- All 5 provider acceptance tests
- Internal-vs-provider usage variance calculated
- Cost rate change respects effective date
- Provider invoice mismatch detected
- Customer charge traceable to provider cost
- Margin doesn't conflate credit units and accounting revenue

---

## Stage 12 — Operations UI (spec §127-Stage-12)

**Prerequisite:** Stage 10 exited (parallel with Stage 11).

### Frontend pages under `web/src/pages/admin/fin/`
- Overview (24 KPIs per §103)
- Tenants (with §104 tenant credit view)
- Usage (drill hierarchy per §105)
- Credits
- Holds
- Facilities
- Contracts
- Pricing (with pricing-simulator UI)
- Invoices
- Vendor Costs (with margin drilldown per §106)
- Reconciliation (runs + drift + resolutions)
- Exceptions (18 types per §107)
- Approvals (maker-checker UI)
- Audit
- Configuration

### Backend enablement
- Everything above already has read-side surfaces in earlier stages; Stage 12 assembles them into a coherent admin UX.

### Tests
- End-to-end §130 traversal tests as automated E2E (require jsdom or Playwright — decision at Stage 12 start)

---

## Stage 13 — Legacy Migration + Cutover

**Prerequisite:** Stage 12 exited AND business decision on which live tenants migrate first.

### Steps
1. Dual-write mode: every `commercial.ledger_entries` write also writes to `fin.ledger_postings` under the new model
2. Backfill historical `commercial.*` data into `fin.*` (with corrections captured as CORRECTION-kind rows)
3. Run parity checks for one full billing period (30 days minimum)
4. Reconciliation reports R090-R092 (TEST/LIVE / tenant / legal-entity contamination checks) green
5. Business sign-off from Finance
6. Cutover: `fin.*` becomes source of truth; `commercial.*` writes stopped; reads redirected to `fin.*` via views
7. Keep `commercial.*` read-only for 90 days as a safety net
8. Deprecate `commercial.*` after 90-day quiet period

### Tests
- Automated dual-write parity check (writes same-shape rows to both, compares nightly)
- Historical replay: run every past `emitUsageEvent()` call through the new stack, verify identical rated result

---

## Cross-cutting concerns (apply to every stage)

### 1. Environments (LIVE/TEST) from day one
Every `fin.*` table carries `environment` NOT NULL. DB constraint on every FK ensures both sides match. No table gets built without this column.

### 2. Business clock
Every stage's services take a `clock` dependency. `BusinessClock.now()` is the only permitted time-of-day source in business logic. Test clock allows arbitrary advancement.

### 3. Actor + reason on every mutation
`ledger_transactions.actor_type + actor_id` populated for every write. No "SYSTEM" without a `reason_code`. Enforced at write API surface.

### 4. Idempotency keys on every mutation route
No mutation endpoint lands without an `Idempotency-Key` header contract per §90.

### 5. Outbox for every side effect
Notifications, PSP callbacks, vendor API calls, and downstream webhook fanout all originate from committed outbox events. Nothing fires from inside a DB transaction.

### 6. Property-based tests at every stage
Random operation sequences for that stage's commands, invariants asserted after each sequence. Sequences are stored + replayable for regressions.

### 7. Reconciliation runs at every stage
Each stage's checks (from R001-R092 subset) run on a schedule. Drift produces exceptions in the queue. Critical drift blocks the affected book / billing close.

---

## Governance

### Every stage begins with
- Written entry criteria (previous stage's exit criteria met + user approval)
- Fresh audit against the affected spec sections
- Test targets and reconciliation checks named explicitly

### Every stage ends with
- All spec sections in scope rated ✅
- All acceptance tests green
- All reconciliation checks green for at least 1 week under simulated load
- Written exit report

### Failure modes and their handling
- A test can't be written → the spec is ambiguous → clarify with user before proceeding
- A reconciliation check can't pass → the design is wrong → stop, revisit deliverables A-H
- Business schedule pressure to skip a stage → refer to §131 ("Do not defer integrity") and escalate to user

### Decision log
`docs/design/fin/DECISION_LOG.md` — every deviation, deferral, or open question captured with date + rationale + who approved.

---

## What I need from you before touching code

Given the scale, before I start Stage 0 I need:

1. **Confirmation of sequencing.** Do you accept the 13-stage sequence, or do you want any stages parallelized / re-ordered given business priority?
2. **Timeline expectation.** The 52-70 week estimate is single-implementer. If parallel implementers are available or the timeline is tighter, I need to know so I can plan resourcing (a proper enterprise ledger with 3 engineers can reasonably finish in 6-9 months; with one it's a year plus).
3. **Legacy handling policy.** Are we prepared to freeze `commercial.*` feature work during the rebuild? If not, I need to know which features will continue landing so I can plan dual-write coverage.
4. **Live-tenant impact policy.** Any live tenants on the current billing system get migrated during Stage 13. If there are none, cutover is safe; if there are, migration itself is a Stage 13 subproject with its own risk profile.
5. **Cost boundary.** Enterprise ledger implementation touches ~50-60 new tables, ~15-20 new backend service modules, and ~15 new admin UI pages. That's real engineering hours. Confirm authorization to proceed at that scale.

**No implementation begins until questions 1-5 are answered.**

---

## Files this plan produces

Once approved, the deliverables land as:

```
docs/audit/BILLING_SPEC_AUDIT_2026-08.md              (done — this audit)
docs/design/BILLING_ENTERPRISE_REBUILD_PLAN.md        (this plan)
docs/design/fin/A_ENTITY_MODEL.md                     (Stage 0)
docs/design/fin/B_STATE_MACHINES.md                   (Stage 0)
docs/design/fin/C_TRANSACTION_MATRIX.md               (Stage 0)
docs/design/fin/D_CONCURRENCY.md                      (Stage 0)
docs/design/fin/E_IDEMPOTENCY.md                      (Stage 0)
docs/design/fin/F_RECONCILIATION.md                   (Stage 0)
docs/design/fin/G_ACCOUNTING_BOUNDARY.md              (Stage 0)
docs/design/fin/H_SECURITY.md                         (Stage 0)
docs/design/fin/DECISION_LOG.md                       (Stage 0 → living)
backend/src/fin/**                                    (Stages 1-11)
backend/src/persistence/migrations/1XX_fin_*.sql      (Stages 1-11)
web/src/pages/admin/fin/**                            (Stage 12)
```

Legacy `backend/src/billing/*` and `commercial.*` schema stay in place until Stage 13 cutover completes.

---

_This plan is executable, not aspirational. Every stage produces production-ready code. Nothing gets shipped that fails the spec's mandatory sections. If a shortcut suggests itself during implementation, the shortcut is prohibited (per §131)._
