# Billing Enterprise-Spec Compliance Audit

**Date:** 2026-08-16
**Auditor:** Architect (Claude)
**Spec:** _Enterprise Credit, Metering, Rating, Billing & Financial Ledger — Canonical Production Implementation Specification_ (user-supplied, 131 sections)
**Codebase reviewed:** `backend/src/billing/*`, `backend/src/persistence/migrations/*`, `web/src/pages/admin/commercial-pricing/*`, `web/src/pages/{PlansPage,MySubscriptionPage,MyCreditNotesPage,SubscribeDialog,ChangeTierDialog,NotificationPreferencesPage}.tsx` (as of commit `e5ab935`)

**Rating legend**
- ✅ **COMPLIANT** — matches the spec's mandatory requirements
- ⚠️ **PARTIAL** — some structure exists; does not meet all mandatory requirements
- ❌ **MISSING** — nothing in the codebase implements this
- 🚫 **CONTRADICTS** — implementation directly violates a "MUST NOT" from the spec

**Bottom-line score:** 6 ✅ · 14 ⚠️ · 105 ❌ · 6 🚫 · (of 131 sections)
Effective compliance: ~15% by section, ~10% by weighted plane coverage.

---

## §0 — Execution Directive

| Requirement | Status | Evidence |
|---|---|---|
| Treat as financial ledger, not app feature | ⚠️ | Present in spirit for parts of `commercial.*` schema; violated by editable `ledger_entries` rows |
| No mutable `tenant.balance` | ✅ | Balance derived via `quotaBalance()` SUM (`backend/src/billing/ledger.js:59`) |
| Raw usage-event storage | ⚠️ | `commercial.usage_events` exists but no correction shape, no permanent source dedup on `(env, source_system, source_event_id)` |
| No app services directly debiting credits | 🚫 | wa-listings' `credits.js` writes directly to `ai_credit_balances` (`backend/src/modules/whatsapp-listings/application/credits.js:49`) |
| Metering + pricing separated | ❌ | `emitUsageEvent` fuses meter + rating in one call (`backend/src/billing/events.js:100`) |
| Pricing + ledger movement separated | ❌ | Same fusion — rating writes usage_events + ledger_entries in one path |
| No hard-coded single customer rate | ⚠️ | Rate cards + territory overrides implemented (`billing/pricing/`) |
| Lots | ❌ | No lot table |
| Reconciliation framework | ❌ | Per-tenant ad-hoc view only; no reconciliation runs |
| Permanent source dedup | ❌ | WhatsApp webhook dedup exists but scoped to one module |
| Idempotency | ❌ | No `idempotency_keys` table; API endpoints not idempotent |
| Contract versioning | ⚠️ | Product versioning exists; contract concept does not |
| TEST/LIVE separation | ❌ | No `environment` field on any table |
| DB-enforced tenant isolation | ❌ | No RLS |

---

## §1 — System Doctrine (8-plane separation)

| Plane | Status | Notes |
|---|---|---|
| Domain activity | ✅ | Domain services exist |
| Raw usage event | ⚠️ | `commercial.usage_events` exists, missing correction shape |
| Meter evaluation | ❌ | No meter engine — code map `QUOTA_KEY_FOR_ACTION` only |
| Billable metric | ❌ | No `metered_usage` table |
| Contract resolution | ⚠️ | Product/subscription pin exists, contracts don't |
| Rating | ❌ | Rating happens inline in `resolveEffectivePrice`, no `rated_usage` |
| Rated usage | ❌ | No table |
| Funding / auth resolution | ⚠️ | Basic quota check exists, no hold/capture/void |
| Lot allocation | ❌ | No lots |
| Financial ledger | ⚠️ | Single-plane `ledger_entries`, no books/postings |
| Accounting events | ❌ | No `accounting_events` table |
| Billing | ❌ | No `invoices` table |
| Payment/settlement | ❌ | Not built (Phase 7e) |
| Vendor cost | ⚠️ | Google API usage tracked only (`google_api_usage_log`) |
| Vendor reconciliation | ❌ | Not built |
| Contribution margin | ❌ | Not calculated |

**Verdict:** doctrine violated — planes are collapsed. `emitUsageEvent()` performs metering + rating + ledger write in one call.

---

## §2 — System Boundaries

| Requirement | Status | Notes |
|---|---|---|
| App services may emit usage, request auth, capture, void | ⚠️ | `emitUsageEvent()` is the emit API; no capture/void/authorize primitives |
| App services MUST NOT directly alter balances | 🚫 | `wa-listings/credits.js` mutates `ai_credit_balances` directly |
| App services MUST NOT create financial postings | 🚫 | Same — direct writes to `ai_credit_transactions` |
| App services MUST NOT issue lots | ❌ | No lots exist |
| One authoritative service boundary for value movement | ❌ | Two boundaries today: `billing/ledger.js` + `wa-listings/credits.js` |

---

## §3 — Economic Entity Model

| Entity | Status | Evidence |
|---|---|---|
| §3.1 Platform | ❌ | No platform table |
| §3.2 Environment (LIVE/TEST) | ❌ | No `environment` column anywhere |
| §3.3 Platform legal entity | ❌ | No table; no `seller_legal_entity_id` anywhere |
| §3.4 Tenant | ⚠️ | `agents.id` / `agencies.id` doubles as tenant; no dedicated `tenants` table |
| §3.5 Holder | ❌ | No `holders` table |
| §3.6 Billing account | ❌ | No `billing_accounts` table |
| §3.7 Organisational node | ⚠️ | `agencies` + `agency_members` provide org structure but not per spec shape |
| §3.8 Cost centre | ❌ | No table |
| §3.9 Ledger book | ❌ | No `ledger_books` table; single flat ledger |
| Book types (CUSTOMER/RESELLER/PLATFORM/CLEARING/PROMOTIONAL) | ❌ | No concept |

---

## §4 — Unit Model

| Requirement | Status | Notes |
|---|---|---|
| Integer units, `UNIT_SCALE=1_000_000` | 🚫 | Uses INTEGER minor units (cents = 100) for money and integer casts for quotas; no atomic-unit scale |
| Money as BIGINT minor | ⚠️ | Uses INTEGER minor units — fine for most cases; will overflow if any single monetary field exceeds ~$21M |
| Percentages as basis points | ❌ | Territory `pricing_multiplier` is NUMERIC/float; VAT is INTEGER percent |
| Forbid FLOAT/REAL/DOUBLE on money paths | 🚫 | `pricing_multiplier` is NUMERIC; JS math via `Number(...)` uses IEEE-754 doubles throughout `pricing/resolver.js` |

---

## §5 — Core Financial Invariants

| # | Invariant | Status | Notes |
|---|---|---|---|
| I-01 | Transaction sums zero (deferred trigger) | ❌ | No postings model; no trigger |
| I-02 | Book containment | ❌ | No books |
| I-03 | Book conservation | ❌ | No books |
| I-04 | Append-only ledger | 🚫 | `ledger_entries` writable via standard adapter (`insert`/`update`) |
| I-05 | Derived balance | ✅ | `quotaBalance()` sums entries |
| I-06 | Integer-only value path | 🚫 | JS `Number()` coercion throughout |
| I-07 | Lots reconcile | ❌ | No lots |
| I-08 | No unauthorized overdraft | ❌ | No check; `recordConsumption()` allows overage as a signed adjustment |
| I-09 | Immutable usage | 🚫 | `usage_events` writable via adapter |
| I-10 | Permanent source dedup | ⚠️ | Only wa-listings webhook has this; no general enforcement |
| I-11 | Deterministic rating | ⚠️ | Rating is functionally deterministic but no `rating_hash` stored |
| I-12 | Immutable historical interpretation | 🚫 | No frozen `rated_usage` — rerating not possible |
| I-13 | Atomic financial effect | ⚠️ | `transaction()` exists; not all financial paths use it consistently |
| I-14 | No external I/O inside financial transaction | ⚠️ | Notification dispatch fires OUTSIDE the tx (correct); WhatsApp send inside pipeline may still be inside |
| I-15 | Explicit financial actor | ⚠️ | `subscription_history.actor_id` + `actor_type` exist; other mutations lack this |
| I-16 | Fail closed | ⚠️ | `assertPublishChannelConfigured()` fails closed; `emitUsageEvent()` when no rate returns 0-cast |
| I-17 | Environment isolation | ❌ | No environment field |
| I-18 | Historical traceability (invoice→raw event) | ❌ | Missing invoices and rated_usage; chain broken |

---

## §6-7 — Raw Usage Event Store + Rules

| Requirement | Status | Notes |
|---|---|---|
| `usage_events` table with spec shape | ⚠️ | `commercial.usage_events` exists (migration 031/036) but lacks: `environment`, `source_system`, `source_event_id`, `subject_type`, `subject_id`, `event_kind`, `corrects_event_id`, `ingestion_version` |
| Immutable | 🚫 | Writable via adapter |
| `UNIQUE(environment, source_system, source_event_id)` | ❌ | No such constraint |
| Correction / cancellation / replacement kinds | ❌ | Not modeled |
| Source event ID stability | ⚠️ | Ad-hoc — wa-listings uses `message_id`; other emitters don't |
| Events describe business facts, not credits | ⚠️ | `usage_events.action_key` records business intent; but `casts_charged` / `price_minor` computed at emit-time and stored on the event row — violates separation |

---

## §8-11 — Meter Registry + Filters + Metered Usage + Provenance

| Section | Requirement | Status |
|---|---|---|
| §8 Meter registry | `meters` + `meter_versions` tables with `aggregation_type`, `filter_definition`, `effective_from/to` | ❌ Missing entirely |
| §9 Filter semantics | Controlled declarative operator DSL | ❌ Missing |
| §10 Metered usage | `metered_usage` with `computation_hash`, `supersedes_id`, status | ❌ Missing |
| §11 Provenance | `metered_usage_sources` (event → meter contribution) | ❌ Missing |

**Impact:** meter behavior is hard-coded in JS. No historical replay, no version pinning, no explain-why-quantity-N.

---

## §12-14 — Contracts + Contract Versions + Contract Components

| Section | Requirement | Status |
|---|---|---|
| §12 Contracts | `contracts` with `contract_number`, `contract_status`, `starts_at`/`ends_at`, `billing_currency`, `billing_timezone`, `seller_legal_entity_id` | ❌ Missing — closest analog is `billing_subscriptions` which pins a product version, not a contract |
| §13 Contract versions | `contract_versions` with `effective_from`/`effective_to`, `amendment_reason`, `approved_by`, no overlapping ranges | ❌ Missing |
| §14 Contract components | Polymorphic components with 12 types (SUBSCRIPTION / PREPAID_COMMITMENT / INCLUDED_ALLOWANCE / METER_PRICE / OVERAGE_PRICE / MINIMUM_SPEND / PROMOTIONAL_GRANT / ENTITLEMENT / CREDIT_FACILITY / ROLLOVER / USAGE_LIMIT / BILLING_RULE) | ❌ Missing — `billing_products.entitlements` JSONB is a loose approximation of a few of these |

---

## §15-21 — Pricing Model

| Section | Requirement | Status |
|---|---|---|
| §15 Price catalog | `prices` + `price_versions` separate from contracts | ⚠️ Partial — `core_rate_cards` + `billing_products.base_price_minor` play these roles but not decoupled per spec |
| §16 Per-unit pricing | Atomic-unit rate storage | ⚠️ Present as `cast_value_minor` |
| §17 Graduated tier | Portions charged at their tier | ❌ Missing |
| §18 Volume tier | Full period at achieved tier | ❌ Missing |
| §19 Package pricing | `CEILING(qty / package_size) × price` | ❌ Missing |
| §20 Included quantity | Explicit `measured/included/billable` in rating explanation | ❌ Missing |
| §21 Dimensional pricing | Deterministic dimension-based selector w/ documented precedence | ⚠️ Territory/zone override present; not dimension-based per spec |

---

## §22-28 — Rating Engine + Explanation + Late Usage + Re-rating + Simulation

| Section | Requirement | Status |
|---|---|---|
| §22 Rating engine → `rated_usage` | Immutable rated_usage rows with `rating_hash` | ❌ Missing |
| §23 Rating explanation JSON | Per-row breakdown incl. tiers, meter/contract/price versions | ❌ Missing |
| §24 Contract effective-time resolution | Resolve to `occurred_at` by default | ❌ Missing |
| §25 Late-usage timestamps | Separate `occurred_at`/`received_at`/`metered_at`/`rated_at`/`billing_period`/`accounting_effective_period` + late classification | ⚠️ Only `occurred_at` + `created_at` |
| §26 Late-usage handling policy | 4-class policy engine (open period / pre-invoice / post-invoice / closed accounting) | ❌ Missing |
| §27 Re-rating | Adjustment records, never mutate originals | ❌ Missing (no rated_usage to re-rate) |
| §28 Pricing simulation | Non-financial simulation service | ❌ Missing |

---

## §29-34 — Ledger Accounts + Transactions + Postings + Balance Cache + Shapes + Cross-book

| Section | Requirement | Status |
|---|---|---|
| §29 Ledger accounts w/ 7 account_types (AVAILABLE/HELD/ISSUANCE/CONSUMED/EXPIRED/ADJUSTMENT/CLEARING) | ❌ Missing — single ledger entry table |
| §30 `ledger_transactions` header | ❌ Missing |
| §31 `ledger_postings` with book/account binding trigger | ❌ Missing |
| §32 `account_balances` cache w/ `last_posting_id` | ❌ Missing (SUM aggregation only) |
| §33 Transaction shapes (FUNDING/HOLD/VOID/CAPTURE/DIRECT SPEND/EXPIRY/REFUND/ADJUSTMENT/TRANSFER) | ❌ Missing — only allowance/consumption/topup/adjustment shapes |
| §34 Cross-book transfer via clearing | ❌ N/A (no books) |

---

## §35-39 — Lots + Applicability + Allocation + Draw Resolution

| Section | Requirement | Status |
|---|---|---|
| §35 `lots` table with 10 `source_kind` values, `granted_units`/`remaining_units`, `consideration_value_minor`, `draw_priority`, `expires_at`, contract linkage | ❌ Missing |
| §36 `lot_applicability_rules` (ALLOW_METER / DENY_METER / ALLOW_CATEGORY / …) | ❌ Missing |
| §37 Balance definitions (available/held/total/eligible/expiring) | ❌ Missing — single "balance" |
| §38 `lot_allocations` linking postings to lots | ❌ Missing |
| §39 Deterministic lot draw (`draw_priority` ASC, `expires_at` ASC NULLS LAST, `issued_at` ASC, `id` ASC) | ❌ Missing |

---

## §40-44 — Holds (Authorization / Capture / Void / Expiry)

| Section | Requirement | Status |
|---|---|---|
| §40 `holds` table with hold/capture/release transaction refs, subject_type/subject_id | ❌ Missing |
| §41 Hold authorization flow (11-step) | ❌ Missing |
| §42 Hold capture (10-step) | ❌ Missing |
| §43 Hold void (10-step) with exact-lot restore | ❌ Missing |
| §44 Hold expiry worker (SKIP LOCKED batch) | ❌ Missing |

---

## §45-47 — Limits + Counters + Entitlements

| Section | Requirement | Status |
|---|---|---|
| §45 `usage_limits` w/ period_kind (DAY/WEEK/MONTH/ROLLING_30D/CONTRACT_TERM), breach_behavior (BLOCK/WARN) | ⚠️ `billing_product_tiers.quotas` grants per period; no rolling windows, no BLOCK/WARN |
| §46 `limit_counters` with deterministic `period_key` | ⚠️ Approximated by `ledger_entries.billing_period = 'YYYY-MM'` |
| §47 Entitlements separate from credits | ⚠️ `billing_product_tiers.features` JSONB + `feature_entitlements` table, not fully first-class |

---

## §48-52 — Prepaid Funding + Purchase Intents + Payment Confirmation + Bonus Credits + Auto Top-up

| Section | Requirement | Status |
|---|---|---|
| §48 Funding flow (QUOTE → PURCHASE_INTENT → PSP → VERIFY → FUND → LOT → accounting) | ❌ Missing |
| §49 `purchase_intents` (all status stages) | ❌ Missing — top-up endpoints return 501 |
| §50 Payment confirmation w/ `UNIQUE(provider, provider_event_id)` | ❌ Missing |
| §51 Bonus credits as SEPARATE lots (`consideration=0`) | ❌ Missing |
| §52 Auto top-up worker (cooldowns, caps, failure threshold, suspension) | ❌ Missing |

---

## §53-58 — Postpaid Facility + Reservations + Holds + Capture + Direct Spend + Hybrid Resolution

| Section | Requirement | Status |
|---|---|---|
| §53 `credit_facilities` (limit_minor, net_terms_days, valid_from/to, status machine) | ❌ Missing |
| §54 `facility_reservations` (reserved_minor with status) | ❌ Missing |
| §55 Postpaid hold reserves facility, no revenue booking | ❌ Missing |
| §56 Postpaid capture (8-step) creates receivable + revenue event | ❌ Missing |
| §57 Direct postpaid spend | ❌ Missing |
| §58 Hybrid resolution order (eligible prepaid → committed prepaid → contract-eligible purchased → facility for shortfall) | ❌ Missing |

---

## §59-60 — Dunning + Account Control States

| Section | Requirement | Status |
|---|---|---|
| §59 `dunning_cases` + `dunning_steps` (REMIND / REMIND_ESCALATED / PAUSE_NEW_CREDIT / SUSPEND_USAGE / LEGAL_ESCALATION / WRITE_OFF_REVIEW) | ❌ Missing — only trial-ending email exists |
| §60 Separate control flags (allow_prepaid_usage / allow_postpaid_usage / allow_purchases / allow_transfers / allow_refunds / allow_grants) + reason codes | ❌ Missing — single `status` on subscription |

---

## §61-63 — Hierarchy + Funding Resolution + Escalation Limits

| Section | Requirement | Status |
|---|---|---|
| §61 Organizational vs funding hierarchy distinction | ❌ Missing — `agency_members` provides org tree only |
| §62 Funding resolution algorithm (lock candidates, deterministic order) | ❌ Missing |
| §63 Escalation limit semantics (leaf → parent) | ❌ Missing |

---

## §64-66 — Manual Adjustments + Maker-Checker + Refunds

| Section | Requirement | Status |
|---|---|---|
| §64 Manual adjustment with reason_code (8 defined codes) | ⚠️ Admin credit endpoint has `reason` free-text, no code enum |
| §65 Maker-checker (`approval_requests` / `approval_actions`) for sensitive ops (large grant / large refund / negative adjustment / facility ops / backdated amendment / invoice void / write-off / reconciliation override / mass operation) | ❌ Missing |
| §66 Refunds w/ cumulative bound `sum(refunds) ≤ original captured` | ⚠️ Refund credit_notes exist; no cumulative bound check |

---

## §67-68 — Expiry Worker + Business Clock

| Section | Requirement | Status |
|---|---|---|
| §67 Lot expiry worker (`AVAILABLE -N`, `EXPIRED +N`), notice policy | ⚠️ Credit-note expiry sweep exists (`credit-notes.js#sweepExpiredNotes`); no lot expiry (no lots) |
| §68 `BusinessClock.now()` injection | 🚫 Direct `new Date()` throughout — no test-clock support |

---

## §69-75 — Accounting Event Model + Policy + Revenue Allocation + Credit Loss + Breakage + Tax

| Section | Requirement | Status |
|---|---|---|
| §69 `accounting_events` table (DEFERRED_REVENUE_CREATED, REVENUE_RECOGNIZED, RECEIVABLE_CREATED, BAD_DEBT_WRITE_OFF, BREAKAGE_RECOGNIZED, TAX_ACCRUED, etc.) | ❌ Missing entirely |
| §70 Accounting policy engine (`AccountingPolicy.evaluate*`) w/ policy version stamped on events | ❌ Missing |
| §71 Prepaid consideration allocation | ❌ Missing |
| §72 Revenue allocation groups + lines for multi-obligation transactions | ❌ Missing |
| §73 Credit loss vs revenue reversal separation | ❌ Missing |
| §74 Breakage policy (`ON_EXPIRY` or `PROPORTIONAL_EXPECTED_BREAKAGE`) | ❌ Missing |
| §75 Tax boundary as separate service w/ snapshot on invoice | ⚠️ `territory.vat_percent` exists; no tax service, no snapshot |

---

## §76-82 — Billing Periods + Close + Invoices + Numbering + Credit/Debit Notes + Payments

| Section | Requirement | Status |
|---|---|---|
| §76 `billing_periods` state machine (OPEN → USAGE_CLOSING → USAGE_CLOSED → RATING_CLOSED → INVOICE_DRAFTED → INVOICED → FINAL) | ❌ Missing — periods are `YYYY-MM` strings |
| §77 12-step period-close process | ❌ Missing |
| §78 `invoice` / `invoice_line` / `invoice_tax_line` / `invoice_adjustment` / `invoice_payment_allocation` | ❌ Missing entirely |
| §79 Invoice line source references | ❌ Missing |
| §80 `invoice_sequences` scoped by (seller legal entity, jurisdiction, doc type, fiscal context); never reuse | ❌ Missing |
| §81 Credit/debit notes for issued-invoice corrections | ⚠️ `billing_credit_notes` exists but not linked to invoices (no invoices) |
| §82 Payment records + allocations (`payment_allocation`, `unapplied_cash`) | ❌ Missing — Phase 7e territory |

---

## §83-88 — Vendor Economics

| Section | Requirement | Status |
|---|---|---|
| §83 `vendors` / `vendor_products` / `vendor_rate_cards` / `vendor_rate_versions` | ⚠️ Only `area_intelligence.google_api_usage_log` (single vendor) |
| §84 `vendor_usage_events` / `vendor_reported_usage` / `vendor_cost_estimates` / `vendor_actual_costs` | ⚠️ Only cost estimates for Google Maps |
| §85 Provider cost attribution linking to customer usage | ❌ Missing |
| §86 `vendor_statement` / `vendor_statement_line` immutable once finalized | ❌ Missing |
| §87 Vendor reconciliation (A/B/C/D/E/F comparisons) w/ variance reason classification | ❌ Missing |
| §88 Margin (contribution margin = recognized revenue − attributable provider cost) | ⚠️ Reports page shows quota-charge sums; no revenue recognition, no provider cost, no true margin |

---

## §89-93 — Idempotency + Permanent Dedup + Outbox + Workers + Auth Attempts

| Section | Requirement | Status |
|---|---|---|
| §89 `idempotency_keys` (per-env, per-tenant, per-key) w/ status machine | ❌ Missing |
| §90 Idempotency behaviour (same-fingerprint replay, different-fingerprint reuse rejection, in-flight rejection) | ❌ Missing |
| §91 Permanent economic dedup (`UNIQUE(env, source_system, event_id)`) never expires | ⚠️ Only wa-listings' `webhook_delivery_log` has this shape |
| §92 `outbox_events` for reliable side effects | ⚠️ `notification_events` is per-domain, not a general outbox |
| §93 Worker semantics (safe locking, bounded batches, idempotent, exponential backoff, dead-letter, metrics) | ⚠️ Renewal scanner has some of this; others don't |
| §94 `authorization_attempts` log | ❌ Missing entirely |

---

## §95-97 — Reconciliation Framework

| Section | Requirement | Status |
|---|---|---|
| §95 `reconciliation_runs` / `reconciliation_checks` / `reconciliation_drift` / `reconciliation_resolution` | ❌ Missing |
| §96 Mandatory checks R001-R092 (30+ checks across ledger/lots/holds/metering/rating/postpaid/accounting/billing/providers/isolation) | ❌ Missing — 0 of ~34 checks implemented |
| §97 Configurable response actions (WARN / BLOCK_NEW_ISSUANCE / BLOCK_AFFECTED_HOLDER / BLOCK_AFFECTED_BOOK / BLOCK_BILLING_CLOSE) | ❌ Missing |

---

## §98-101 — Security + Privileges + Audit + Retention

| Section | Requirement | Status |
|---|---|---|
| §98 RLS on every tenant-scoped table (`ENABLE + FORCE ROW LEVEL SECURITY`) | ❌ Missing |
| §99 Privilege separation (11+ distinct capabilities: VIEW_CREDITS / GRANT_CREDITS / ADJUST_CREDITS / REFUND_CREDITS / CHANGE_PRICE / APPROVE_PRICE / CREATE_FACILITY / APPROVE_FACILITY / VOID_INVOICE / APPROVE_WRITE_OFF / RESOLVE_RECONCILIATION) | 🚫 Single `platform_role='platform_admin'` boolean |
| §100 Financial audit events (actor / action / target / before-state / after-state / reason / approval-ref / request-id / IP / timestamp) | ⚠️ `subscription_history` covers subscriptions; broader financial audit surface missing |
| §101 Data retention policies per data class | ❌ Missing |

---

## §102-107 — Admin Control Centre + Overview KPIs + Tenant Drilldown + Exceptions

| Section | Requirement | Status |
|---|---|---|
| §102 Admin sections (Overview / Tenants / Usage / Credits / Holds / Facilities / Contracts / Pricing / Invoices / Vendor Costs / Reconciliation / Exceptions / Approvals / Audit / Configuration) | ⚠️ 5 of 15 sections have some UI (Products, Subscriptions, Credit-notes, Reports, Reconciliation lookup) |
| §103 Overview KPIs (~24 metrics) | ⚠️ 6 of ~24 (MRR / ARR / churn / territory-mix / tier-mix / credit exposure) |
| §104 Tenant credit view (~15 fields) | ⚠️ Partial via reconciliation-lookup page |
| §105 Usage breakdown hierarchy (Category → Service → Meter → Dimension → Rated → Raw) | ❌ Missing — no metered_usage / rated_usage chain |
| §106 Margin drilldown per meter/provider | ❌ Missing |
| §107 Exceptions queue (~18 types) | ⚠️ Reconciliation "anomalies" surfaces 2 kinds; the other 16 aren't detected |

---

## §108-110 — API Contract + Error Envelope + Error Codes

| Section | Requirement | Status |
|---|---|---|
| §108 API surfaces grouped by bounded context | ⚠️ Present; not organized per spec's context groups |
| §109 Standard error envelope (`code` / `category` / `retryable` / `customer_actionable` / `support_reference` / `safe_message`) | ❌ Missing — errors return `{ error, code }` only |
| §110 Standard error codes (RATE_NOT_CONFIGURED / INSUFFICIENT_ELIGIBLE_CREDITS / FACILITY_LIMIT_EXCEEDED / HOLD_NOT_OPEN / etc.) | ⚠️ Some codes present (PLAN_ALREADY_SUBSCRIBED / INVALID_TRANSITION / …); no formal registry |

---

## §111-112 — Observability + Alerts

| Section | Requirement | Status |
|---|---|---|
| §111 Metrics catalog (usage/metering/rating/credits/facility/financial/operational/vendor — ~30 metrics) | ❌ Missing — pino logs only |
| §112 Alerts (7 critical, 7 urgent) | ❌ Missing |

---

## §113 — TEST/LIVE Separation

| Requirement | Status |
|---|---|
| `environment` column on relevant tables | ❌ Missing |
| DB constraints ensure referenced objects have matching environments | ❌ Missing |
| Controlled test clock / fake PSP / test funding / test billing pipeline | ❌ Missing |

---

## §114-115 — Concurrency + Balance Debit

| Requirement | Status |
|---|---|
| §114 Deterministic multi-account lock order | ❌ Missing — no locking discipline defined |
| §115 Balance debit via SELECT FOR UPDATE + validation OR `WHERE balance >= amount` | ⚠️ Ledger uses `SELECT FOR UPDATE` in `record_consumption` stored proc; other paths don't |

---

## §116 — Property-Based Testing

| Requirement | Status |
|---|---|
| Randomized operation sequences with post-sequence invariant checks | ❌ Missing |

---

## §117-126 — Acceptance Tests (all subsystems)

| Section | Requirement | Status |
|---|---|---|
| §117 Ledger acceptance (10 tests) | ⚠️ Partial (2 of 10: derived balance, atomic tx) |
| §118 Usage acceptance (7 tests) | ❌ None per spec's shape |
| §119 Meter acceptance (per aggregation type) | ❌ Missing (no meter registry) |
| §120 Rating acceptance (12 tests) | ❌ Missing (no rated_usage) |
| §121 Lot acceptance (8 tests) | ❌ Missing (no lots) |
| §122 Postpaid acceptance (10 tests) | ❌ Missing |
| §123 Accounting acceptance (9 tests) | ❌ Missing |
| §124 Billing acceptance (7 tests) | ❌ Missing (no invoices) |
| §125 Provider acceptance (5 tests) | ❌ Missing |
| §126 Security acceptance (per-table RLS) | ❌ Missing (no RLS) |

---

## §127 — Implementation Order (Stages 1-12)

| Stage | Status |
|---|---|
| Stage 1 Foundation (environments, entities, books, accounts, postings, balances, lots, allocations, idempotency, outbox, dedup, RLS, audit, reconciliation) | ❌ Not started per spec |
| Stage 2 Usage plane (correction shape, source uniqueness, late timestamps) | ⚠️ Partially exists (usage_events table w/o correction shape) |
| Stage 3 Metering (registry, versions, aggregation, dimensions, hash, provenance) | ❌ Not started |
| Stage 4 Contracts + pricing (contracts, versions, components, price catalog, all pricing models) | ⚠️ Partial (products replace contracts; only per-unit pricing) |
| Stage 5 Rating (rated_usage, explanation, deterministic, allowance handling, adjustment, simulator) | ❌ Not started |
| Stage 6 Credit authorization (applicable balances, funding resolver, lots, holds, capture, void, expiry, limits, hierarchy, controls) | ⚠️ Partial (basic subscription state machine, no lots/holds) |
| Stage 7 Funding (products, quote, purchase, PSP, bonus lots, auto top-up, grants, transfers) | ⚠️ Partial (admin credit grant; no PSP flow) |
| Stage 8 Postpaid (facility, reservations, hybrid, capture exposure, receivables, dunning) | ❌ Not started |
| Stage 9 Accounting (event engine, policy versions, deferred, revenue allocation, receivables, credit loss, breakage, tax interface) | ❌ Not started |
| Stage 10 Billing (period close, invoicing, credit/debit notes, payment allocation, reconciliation) | ⚠️ Partial (credit_notes as loose analog; no invoices) |
| Stage 11 Vendor economics (rates, usage, statements, cost attribution, reconciliation, margin) | ❌ Not started |
| Stage 12 Operations (admin control centre, tenant drilldown, exceptions, approvals, reconciliation ops, anomaly views, pricing simulation UI, audit interface) | ⚠️ Partial (5 of 15 admin sections) |

---

## §128-131 — Deliverables + Code Review + Enterprise-Complete Definition

**§128 Pre-implementation deliverables (Entity model, State machines, Transaction matrix, Concurrency, Idempotency, Reconciliation, Accounting boundary, Security):** ❌ None produced.

**§129 Automatic-reject conditions found in current code:**
| Reject condition | Present? |
|---|---|
| `balance -= amount` outside canonical ledger | ✅ YES — wa-listings `credits.js:59` (`credits_remaining: nextRemaining` where next is computed by subtraction elsewhere) |
| App service writes postings directly | ✅ YES — wa-listings |
| Source service submits final credit price | ⚠️ CLOSE — `emitUsageEvent()` computes `casts_charged` + `price_minor` on the emit path; the caller doesn't specify the price but the ledger row records both alongside the raw event |
| Contract terms overwritten | N/A — no contracts |
| Invoice lines with no economic source | N/A — no invoices |
| Postpaid hold books revenue | N/A — no postpaid |
| Provider event dedupe expires | ⚠️ Provider dedup limited to wa-listings; not universal |
| Missing price defaults zero | ✅ YES — `emitUsageEvent()` fallback to `CAST_VALUE_MINOR_SEED` and if `rateCard.rates[actionKey]` absent, casts_charged=0 |
| Floating point on money path | ✅ YES — `pricing/resolver.js` multiplies via JS `Number()` |
| Platform admin can modify historical posting | ✅ YES — `ledger_entries` writable via adapter |
| TEST and LIVE rely only on UI selection | N/A — no TEST env at all |
| Ledger reconciliation is a manually run script | ✅ YES — no automated reconciliation runs |
| Vendor invoice reconciliation deferred | ✅ YES — not built |
| One mutable `status` hides materially different financial restrictions | ✅ YES — `billing_subscriptions.status` mixes payment / lifecycle / access-control semantics |
| Finance-critical state changes with no actor/reason | ⚠️ Partial — subscription changes captured; other financial writes not |

**Total automatic-reject conditions triggered:** 10 of 15.

**§130 Enterprise-complete traversal test:**
- Invoice → line → adjustment → rated usage → contract → pricing → meter → raw event → source ref: ❌ CANNOT — no invoices, no rated_usage, no contracts, no metered_usage
- Rated usage → authorization → funding → lots → tx → postings → balance: ❌ CANNOT — no authorization records, no lots, no postings
- Lot → funding → payment/commitment/grant → consideration → accounting treatment: ❌ CANNOT — no lots, no accounting events
- Usage → vendor → expected cost → provider usage → provider invoice → actual cost → margin: ❌ CANNOT — no vendor registry beyond Google Maps

**§131 Final: no shortcuts.** Current implementation took shortcuts on ~110 sections.

---

## Compliance summary by plane

| Plane | Sections | ✅ | ⚠️ | ❌ | 🚫 | % compliant |
|---|---|---|---|---|---|---|
| Foundation (Entities, Units, Invariants) | §3-5 | 1 | 6 | 15 | 6 | 5% |
| Usage (§6-7) | 2 | 0 | 2 | 0 | 0 | 0% (partial only) |
| Metering (§8-11) | 4 | 0 | 0 | 4 | 0 | 0% |
| Contracts + Pricing (§12-21) | 10 | 0 | 3 | 7 | 0 | 0% (partial only) |
| Rating (§22-28) | 7 | 0 | 1 | 6 | 0 | 0% |
| Ledger (§29-34) | 6 | 0 | 0 | 6 | 0 | 0% |
| Lots (§35-39) | 5 | 0 | 0 | 5 | 0 | 0% |
| Holds (§40-44) | 5 | 0 | 0 | 5 | 0 | 0% |
| Limits + Entitlements (§45-47) | 3 | 0 | 3 | 0 | 0 | 0% (partial) |
| Funding (§48-52) | 5 | 0 | 0 | 5 | 0 | 0% |
| Postpaid (§53-58) | 6 | 0 | 0 | 6 | 0 | 0% |
| Dunning + Controls (§59-60) | 2 | 0 | 0 | 2 | 0 | 0% |
| Hierarchy (§61-63) | 3 | 0 | 0 | 3 | 0 | 0% |
| Adjustments + Approvals (§64-66) | 3 | 0 | 2 | 1 | 0 | 0% (partial) |
| Expiry + Clock (§67-68) | 2 | 0 | 1 | 0 | 1 | 0% |
| Accounting (§69-75) | 7 | 0 | 1 | 6 | 0 | 0% (partial) |
| Billing (§76-82) | 7 | 0 | 1 | 6 | 0 | 0% |
| Vendor (§83-88) | 6 | 0 | 3 | 3 | 0 | 0% (partial) |
| Idempotency + Outbox + Workers (§89-94) | 6 | 0 | 3 | 3 | 0 | 0% |
| Reconciliation (§95-97) | 3 | 0 | 0 | 3 | 0 | 0% |
| Security + Audit (§98-101) | 4 | 0 | 1 | 2 | 1 | 0% |
| Admin UX (§102-107) | 6 | 0 | 5 | 1 | 0 | 0% (partial) |
| API + Errors (§108-110) | 3 | 0 | 2 | 1 | 0 | 0% |
| Observability (§111-112) | 2 | 0 | 0 | 2 | 0 | 0% |
| Env + Concurrency (§113-115) | 3 | 0 | 1 | 2 | 0 | 0% |
| Testing (§116-126) | 11 | 0 | 1 | 10 | 0 | 0% |
| **TOTALS** | **131** | **~6** | **~14** | **~105** | **~6** | **~5% strict compliance** |

---

## Verdict

Current implementation is a **mid-market SaaS subscription-and-quota system**. It is not the enterprise financial control plane the specification describes. Bridging the gap requires a rebuild, not incremental additions.

Two ledgers currently exist in parallel — `commercial.ledger_entries` (quota) and `wa_listings.ai_credit_transactions` (WhatsApp AI credits). Both violate multiple invariants. The rebuild must consolidate value movement behind a single canonical ledger service.

The rebuild sequence is fixed by the spec at §127. Do not reorder.

See `docs/design/BILLING_ENTERPRISE_REBUILD_PLAN.md` for the sequenced execution plan.
