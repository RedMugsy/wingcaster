# Deliverable B — State machines

**Stage:** 0 (§128)
**Owner:** Agent B
**Date:** 2026-08-18
**Status:** Stage 0 design — not implementation
**Depends on:** `A_ENTITY_MODEL.md` (APPROVED), `DECISION_LOG.md` DL-000…DL-028 (binding), this file adds DL-029…DL-036
**Locks:** A-Q1 (exact permitted transitions for every INTENT status). Agent C (`D_CONCURRENCY`, `E_IDEMPOTENCY`) and Agent D (`F`/`G`/`H`) read this file; they do not rewrite it.
**Does not touch:** `A_ENTITY_MODEL.md` body, D–H, `backend/src/**`, migrations.

Vocabulary is `A_ENTITY_MODEL.md`. Table names and PK types are not renamed. Where a machine needs a column A omitted, this file leaves an `<!-- OPEN: … -->` marker and a Decision Log row — no parallel table.

---

## 0. How to read this file

Every machine below is a **status-machine-only UPDATE** on an INTENT / MUTABLE-header / VERSIONED row. Economic effect (lots, postings, balances) is never a side conversation: if a transition writes value, `C_TRANSACTION_MATRIX.md` names the command and the `ledger_transactions.shape`.

Column pack on every transition row:

| Col | Meaning |
|---|---|
| from → to | Exact `status` literals. Case-sensitive. |
| trigger | Command name (same names as C). |
| actor | Legal `actor_type` set. `actor_id` is always stamped. |
| guard | Predicate that must hold **inside** the row lock. Failure is a stable `code`, not a throw-and-swallow. |
| reason_code | Required (`Y`) or not (`—`). When `Y`, empty/unknown → `REASON_CODE_REQUIRED`. |
| approval | `approval_requests.action_kind` that must be `APPROVED` and unused, or `—`. |
| audit | Writes `fin.financial_audit_events` in the **same** DB transaction (`Y`/`N`). |
| outbox | Topic written in the **same** DB transaction, or `—`. |
| side-effect | Other `fin.*` writes. Never `commercial.*`. |

Illegal transitions are not listed as rows. They return the machine's `*_ILLEGAL_TRANSITION` code with `{from, to, trigger}` in the envelope (spec §109). Counts of “tests written” are not evidence — see §Acceptance.

### 0.1 Actor types (A §1 — closed)

`USER` · `SYSTEM` · `WORKER` · `PSP` · `RECONCILIATION`

- `SYSTEM` without `reason_code` is illegal (rebuild plan cross-cut 3).
- `PSP` is only legal on `purchase_intents`, `payments`, `disputes`, and the outbox topic `webhook.stripe`.
- `RECONCILIATION` is only legal on `reconciliation_*`, `ledger_transactions.shape='ADJUSTMENT'` with `economic_source_type='RECONCILIATION'`, and `accounting_periods` reopen.
- `WORKER` is the only actor that may expire holds, expire lots, tick dunning, publish outbox, or close a billing period on the clock.

### 0.2 OCC and append-only freeze

INTENT and MUTABLE headers: `UPDATE … WHERE id = $1 AND version = $2` (A DL-004). Mismatch → `412 PRECONDITION_FAILED` / `OCC_VERSION_MISMATCH`.

After an invoice / credit-note / debit-note / vendor-statement **ISSUE/FINALIZE**, header mutation is status + paid-fields only (A §10.3). Lines are APPEND_ONLY.

`contract_versions` are VERSIONED. Status + `effective_to` close are the only legal UPDATEs on a version row (DL-029). Components of a `DRAFT` version may be rewritten; `ACTIVE` / `SUPERSEDED` versions are frozen.

### 0.3 Environment and close gates (every command)

1. Row `environment` equals the command environment. Cross-env → `ENV_MISMATCH`.
2. New economic effect against a legal entity whose `accounting_periods.status='HARD_CLOSED'` for `effective_at` → `ACCOUNTING_PERIOD_HARD_CLOSED` (A §9.0). Override path is §18 reopen, not a silent write.
3. `account_controls` flags for the subject must allow the command class (A §3.10). Deny → `CONTROL_DENY` plus the flag name.

### 0.4 Pair-cardinality invariant (R2-1 — this agent's half)

Agent C owns the DB objects (`CHECK pair_id IS NULL OR shape='TRANSFER'`, `UNIQUE(pair_id, book_id)`, deferred exactly-two assertion — DL-025).

**State-machine / command rule, binding now:** a `pair_id` is a two-slot lock. `TransferCredits` inserts **zero or two** `fin.ledger_transactions` rows for that `pair_id` in **one** DB transaction. It MUST NOT insert a third row when `COUNT(*) FILTER (WHERE pair_id = :id)` is already 2 (`TRANSFER_PAIR_COMPLETE`). It MUST NOT commit a 1-leg pair. There is no “add the missing leg later” command. A crashed 1-leg attempt rolls back with the outer transaction. See C §2.

---

## 1. Outbox topic catalogue (Agent D reads this)

A named three topics (`notification.lifecycle`, `webhook.stripe`, `usage.dlq_replay`). Those names are frozen. Everything else is `fin.<aggregate>.<event>`.

**Rule:** the command that mutates the INTENT row writes the outbox row in the same `transaction()`. No worker, PSP adapter, or notification dispatcher inserts an outbox row after commit. I-14: no external I/O inside the financial transaction — the outbox **is** the side-effect.

| Topic | Who fires (command / transition) | Typical consumer | Dedupe key |
|---|---|---|---|
| `fin.hold.authorized` | `AuthorizeHold` OPEN | metrics, limits UI | `hold:{id}` |
| `fin.hold.captured` | `CaptureHold` | accounting policy, notification | `hold:{id}:capture` |
| `fin.hold.voided` | `VoidHold` | notification | `hold:{id}:void` |
| `fin.hold.expired` | `ExpireHold` | notification | `hold:{id}:expire` |
| `fin.lot.issued` | `FundPurchase`, `GrantCredits`, dest `TransferCredits`, `MigrateLot`, refund reversal | credit UI | `lot:{id}` |
| `fin.lot.exhausted` | capture / spend when `remaining_units=0` | credit UI | `lot:{id}:exhausted` |
| `fin.lot.expired` | `ExpireLot` | breakage (G) | `lot:{id}:expired` |
| `fin.lot.frozen` | `FreezeLot` / `UnfreezeLot` | credit UI | `lot:{id}:{status}` |
| `fin.purchase.status` | every `purchase_intents` transition | `notification.lifecycle`, PSP ops | `purchase:{id}:{to}` |
| `fin.ledger.posted` | every command that inserts `ledger_transactions` | recon runner, metrics | `tx:{id}` |
| `fin.transfer.posted` | `TransferCredits` — **once per pair**, not per leg | recon, notification | `pair:{pair_id}` |
| `fin.facility.status` | facility header transitions | notification, dunning | `facility:{id}:{to}` |
| `fin.facility.reservation` | reservation OPEN/CAPTURED/RELEASED/EXPIRED | postpaid capture | `facres:{id}:{to}` |
| `fin.invoice.status` | invoice transitions after DRAFT | delivery, AR, dunning | `invoice:{id}:{to}` |
| `fin.invoice.render` | `IssueInvoice` | PDF/A-3 worker | `invoice:{id}:render` |
| `fin.zatca.submit` | `IssueInvoice` when seller jurisdiction `SA` | ZATCA worker (Stage 10) | `invoice:{id}:zatca` |
| `fin.credit_note.status` | credit-note ISSUE/VOID | AR, notification | `cn:{id}:{to}` |
| `fin.debit_note.status` | debit-note ISSUE/VOID | AR, notification | `dn:{id}:{to}` |
| `fin.payment.status` | `RecordPayment` / allocate / reverse | allocation worker | `pay:{id}:{to}` |
| `fin.billing_period.status` | every period step | close workflow, rating | `bp:{id}:{to}` |
| `fin.dunning.step` | dunning worker / cure | `notification.lifecycle` | `dunning:{case_id}:{step_kind}` |
| `fin.approval.requested` | any command that inserts `REQUESTED` | approvals UI | `apr:{id}` |
| `fin.approval.decided` | `DecideApproval` | executor worker | `apr:{id}:{to}` |
| `fin.contract.status` | contract header transitions | `notification.lifecycle` | `contract:{id}:{to}` |
| `fin.contract.version` | version ACTIVE/SUPERSEDED | rating pin | `cv:{id}:{to}` |
| `fin.accounting_period.status` | soft/hard close, reopen | rating late-class, recon | `ap:{id}:{to}` |
| `fin.reconciliation.run` | run COMPLETED/FAILED | exceptions queue | `recon:{id}:{to}` |
| `fin.reconciliation.resolution` | resolution APPLIED | `account_controls`, close gates | `res:{id}:{action}` |
| `fin.dispute.status` | dispute transitions | payments, AR | `disp:{id}:{to}` |
| `fin.vendor.statement.finalized` | `FinalizeVendorStatement` | vendor recon (F) | `vstmt:{id}` |
| `fin.usage.received` | Stage 2 `ingestUsageEvent` successful INSERT (not dedup) | metering pipeline (Stage 3) | `usage:{residency_key}:{id}` |
| `fin.metering.completed` | Stage 3 `meterPeriod` INSERT of a new ACTIVE `metered_usage` (not hash-equal dedup) | rating pipeline (Stage 5) | `metering:{meterVersionId}:{holderId}:{periodKey}:{computationHash}` |
| `fin.price.created` | Stage 4 `createPrice` | catalog UI | `price:{id}` |
| `fin.price.version` | Stage 4 draft / activate / deprecate | rating pin (Stage 5) | `pv:{id}:{to}` |
| `notification.lifecycle` | any **tenant-visible** transition (see per-row) | dispatcher (replaces `fireAndForgetNotify`, audit B-8) | `{topic_suffix}:{id}` |
| `webhook.stripe` | PSP confirm, refund, dispute inbound **ack path** | Stripe adapter outbound | `stripe:{provider_event_id}` |
| `usage.dlq_replay` | Stage 2 DLQ worker (not a money command) | usage ingest | `dlq:{id}:{attempt}` |

Tenant-visible (must also write `notification.lifecycle`): purchase PAID/FAILED/REFUNDED, invoice ISSUED/VOID, dunning REMIND+, contract SUSPENDED/TERMINATED, facility SUSPENDED, dispute OPEN/LOST.

---

## 2. Approval classes (A §12.1)

A `approval_requests.action_kind` is the **capability bucket**. Thresholds (what is “large”) are Agent G policy. The machine only asks: is there an `APPROVED` row for this `subject_type/id` + `payload_hash` that is not yet `EXECUTED`?

| action_kind | Required on |
|---|---|
| `LARGE_GRANT` | `GrantCredits` (always — below-threshold is SYSTEM auto-approve, DL-034) |
| `LARGE_REFUND` | `RefundPurchase` / `IssueCreditNote` when cash returns to the payer |
| `NEGATIVE_ADJUSTMENT` | `ManualAdjust` with a net decrease of AVAILABLE |
| `FACILITY_OPS` | facility PENDING→ACTIVE, ACTIVE→CLOSED, limit change, PAUSED/SUSPENDED by a USER |
| `BACKDATED_AMENDMENT` | `ActivateContractVersion` / `ActivatePriceVersion` when `effective_from < BusinessClock.now()` |
| `INVOICE_VOID` | ISSUED/PART_PAID → VOID |
| `WRITE_OFF` | → UNCOLLECTIBLE; dunning WRITE_OFF_REVIEW → WRITTEN_OFF |
| `RECONCILIATION_OVERRIDE` | HARD_CLOSED → SOFT_CLOSED; any `BLOCK_*` resolution; recon ADJUSTMENT |
| `MASS_OPERATION` | bulk grant / bulk expire / bulk migrate (N>1 subjects) |
| `PLATFORM_ADMIN_RECOVERY` | out of financial scope; Agent D / H. Listed so B does not reuse the kind. |
| `AUDIT_RETENTION` | out of financial scope; Agent D / H. |

Two distinct `approval_actions.actor_id` values are required when the subject is a `platform_admin` target (A §12.1). Enforcement is H; the table must be able to store them. Single-actor self-approve → `APPROVAL_FOUR_EYES_REQUIRED`.

An `APPROVED` request is consumed exactly once: the economic command sets it `EXECUTED` in the same DB transaction. Replay of the economic command is the idempotency key, not a second EXECUTE.

---

## 3. `fin.holds` — INTENT (A §5.4, spec §40–44)

**Statuses:** `OPEN` · `CAPTURED` · `VOIDED` · `EXPIRED`  
**PK:** `id UUID`  
**Terminal:** `CAPTURED`, `VOIDED`, `EXPIRED` (mutually exclusive).  
**Rebuild stage:** 6. Replaces the missing authorize/capture/void surface (audit A/B-1 lives here: usage fact + hold + postings in **one** `transaction()`).

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `OPEN` | `AuthorizeHold` | USER / SYSTEM / WORKER | §3.1 | Y | — | Y | `fin.hold.authorized` + `fin.ledger.posted` | HOLD tx; lot allocations; optional `facility_reservations` OPEN; `authorization_attempts` AUTHORIZED |
| `OPEN` | `CAPTURED` | `CaptureHold` | USER / SYSTEM / WORKER | status=OPEN, `expires_at > now`, `authorize_tx_id` set, not already captured | Y | — | Y | `fin.hold.captured` + `fin.ledger.posted` | CAPTURE tx; reservation CAPTURED if any; lot EXHAUSTED if remaining=0; postpaid accounting events (G) |
| `OPEN` | `VOIDED` | `VoidHold` | USER / SYSTEM / WORKER | status=OPEN | Y | — | Y | `fin.hold.voided` + `fin.ledger.posted` | VOID tx; exact-lot restore (spec §43); reservation RELEASED if any |
| `OPEN` | `EXPIRED` | `ExpireHold` | WORKER | status=OPEN, `expires_at <= now` | Y (`HOLD_TTL`) | — | Y | `fin.hold.expired` + `fin.ledger.posted` | same restore shape as VOID via `release_tx_id`; SKIP LOCKED batch (C) |

**Illegal (stable codes):** `HOLD_NOT_OPEN`, `HOLD_ALREADY_TERMINAL`, `HOLD_EXPIRED` (capture/void after `expires_at`), `HOLD_CAPTURE_AFTER_VOID`, `HOLD_DOUBLE_CAPTURE` (unique shape CAPTURE per hold — DL-014).

### 3.1 Authorize guards

`account_controls.allow_prepaid_usage` and/or `allow_postpaid_usage` as the resolver requires. Eligible lots per §39 (C §4) cover `units`, or a facility covers the shortfall (`allow_postpaid_usage`, facility `ACTIVE`, reservation + limit). Limit `BLOCK` → `LIMIT_BLOCKED`. Denied attempts still insert `authorization_attempts` (`DENIED` + `denial_code`) — this is the named signal `emitUsageEvent`'s `return null` never was (A §12.4, audit A-2 scoped to Stage 6).

Capture and void restore/consume **the same lots** the authorize allocation named. A capture that cannot find its allocations is `HOLD_ALLOCATION_MISSING` (fail closed, I-16).

---

## 4. `fin.purchase_intents` — INTENT (A §8.1, spec §48–50)

**Statuses:** `CREATED` · `PAYMENT_PENDING` · `PAID` · `FAILED` · `CANCELED` · `REFUNDED`  
**PK:** `id UUID`  
**Terminal:** `CANCELED`, `REFUNDED`. `PAID` is terminal for the intent machine; partial cash-back stays `PAID` and is recorded on reserved `fin.refunds` (A §16b T4). Full return → `REFUNDED`.  
**Rebuild stage:** 7. Un-501's today's top-up.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `CREATED` | `CreatePurchaseIntent` | USER / SYSTEM / WORKER | `allow_purchases`; quote units/minor > 0 | Y | — | Y | `fin.purchase.status` | no ledger yet |
| `CREATED` | `PAYMENT_PENDING` | `SubmitPurchasePayment` | USER / WORKER | provider ∈ {STRIPE,…}; no `provider_event_id` yet | Y | — | Y | `fin.purchase.status` + `webhook.stripe` (if Stripe) | PSP call **after** commit (I-14); reserve row first |
| `CREATED` | `PAID` | `ConfirmPurchase` | USER / SYSTEM | provider ∈ {MANUAL, INVOICE}; invoice path requires issued invoice | Y | — | Y | `fin.purchase.status` + `notification.lifecycle` + `fin.ledger.posted` + `fin.lot.issued` | FUNDING tx + paid lot; companion GRANT tx + bonus lot if quoted (C §5.1) |
| `CREATED` | `CANCELED` | `CancelPurchase` | USER / SYSTEM | no PSP charge started | Y | — | Y | `fin.purchase.status` | — |
| `PAYMENT_PENDING` | `PAID` | `ConfirmPurchase` | PSP / WORKER | `UNIQUE(provider, provider_event_id)` inserts; fingerprint matches quote | Y (`PSP_CAPTURE`) | — | Y | same as CREATED→PAID + `webhook.stripe` | FUNDING + lots; never expire this unique (A §8.1) |
| `PAYMENT_PENDING` | `FAILED` | `FailPurchase` | PSP / WORKER | provider event is a hard decline | Y | — | Y | `fin.purchase.status` + `notification.lifecycle` | no lots |
| `PAYMENT_PENDING` | `CANCELED` | `CancelPurchase` | USER / SYSTEM | PSP not captured; void the PSP intent **via outbox**, not inline | Y | — | Y | `fin.purchase.status` + `webhook.stripe` | — |
| `FAILED` | `PAYMENT_PENDING` | `SubmitPurchasePayment` | USER / WORKER | new PSP attempt; new `provider_event_id` | Y | — | Y | `fin.purchase.status` | — |
| `FAILED` | `CANCELED` | `CancelPurchase` | USER / SYSTEM | — | Y | — | Y | `fin.purchase.status` | — |
| `PAID` | `REFUNDED` | `RefundPurchase` | USER / PSP | cumulative refunds = `quoted_minor`; lots restorable or already expired→compensation lot | Y | `LARGE_REFUND` | Y | `fin.purchase.status` + `notification.lifecycle` + `fin.ledger.posted` | REFUND tx(s); `REFUND_REVERSAL` lots as needed (C §5.7) |

**Illegal:** `PURCHASE_ALREADY_PAID`, `PURCHASE_NOT_PENDING`, `PURCHASE_PROVIDER_EVENT_REUSED` (permanent unique — not an idempotency expire), `PURCHASE_PARTIAL_TO_REFUNDED` (partials do not flip this status).

Auto top-up worker (spec §52) is `CreatePurchaseIntent` + `SubmitPurchasePayment` with `actor_type=WORKER`, `reason_code=AUTO_TOPUP`. It never charges inline (Stage 7 test). Cooldowns/caps are G.

---

## 5. `fin.approval_requests` — INTENT (A §12.1, spec §65)

**Statuses:** `REQUESTED` · `APPROVED` · `REJECTED` · `CANCELED` · `EXECUTED` · `EXPIRED`  
**PK:** `id UUID`  
**Terminal:** `REJECTED`, `CANCELED`, `EXECUTED`, `EXPIRED`.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `REQUESTED` | `RequestApproval` | USER / SYSTEM / WORKER | `action_kind` in A §12.1 (plus DL-034 GRANT-via-LARGE_GRANT); `payload_hash` set | Y | — | Y | `fin.approval.requested` | `approval_actions` append REQUEST |
| `REQUESTED` | `APPROVED` | `DecideApproval` | USER | distinct approver(s); `decision=APPROVE`; four-eyes when required | Y | — | Y | `fin.approval.decided` | `approval_actions` append |
| `REQUESTED` | `REJECTED` | `DecideApproval` | USER | `decision=REJECT` | Y | — | Y | `fin.approval.decided` | `approval_actions` append |
| `REQUESTED` | `CANCELED` | `CancelApproval` | USER / SYSTEM | subject command aborted | Y | — | Y | `fin.approval.decided` | — |
| `REQUESTED` | `EXPIRED` | `ExpireApproval` | WORKER | TTL elapsed (G policy; default 24h) | Y (`APPROVAL_TTL`) | — | Y | `fin.approval.decided` | — |
| `APPROVED` | `EXECUTED` | *the economic command* | USER / SYSTEM / WORKER / RECONCILIATION | `payload_hash` matches the command body; not yet EXECUTED | Y | — | Y | `fin.approval.decided` | happens **inside** the money transaction |
| `APPROVED` | `CANCELED` | `CancelApproval` | USER | not yet EXECUTED; no money moved | Y | — | Y | `fin.approval.decided` | — |
| `APPROVED` | `EXPIRED` | `ExpireApproval` | WORKER | unused APPROVED past TTL | Y | — | Y | `fin.approval.decided` | — |

**Illegal:** `APPROVAL_NOT_REQUESTED`, `APPROVAL_ALREADY_TERMINAL`, `APPROVAL_PAYLOAD_MISMATCH`, `APPROVAL_FOUR_EYES_REQUIRED`, `APPROVAL_SELF_APPROVE`.

SYSTEM may insert `REQUESTED` and immediately `APPROVED`+`EXECUTED` for below-threshold grants (DL-034) — still three status writes (or a single insert already `EXECUTED` with `approval_actions` SYSTEM/AUTO). Prefer insert `EXECUTED` with `created_by_actor_type=SYSTEM` and one `approval_actions` row `decision=AUTO` so the audit trail is one row, not a fake maker-checker.

---

## 6. `fin.dunning_cases` — INTENT (A §8.4, spec §59)

A left `status` to this agent (DL-030). Steps remain APPEND_ONLY on `fin.dunning_steps`.

**Statuses:** `OPEN` · `REMINDING` · `REMIND_ESCALATED` · `CREDIT_PAUSED` · `USAGE_SUSPENDED` · `LEGAL` · `WRITE_OFF_REVIEW` · `CURED` · `WRITTEN_OFF` · `CANCELED`  
**PK:** `id UUID`  
**Terminal:** `CURED`, `WRITTEN_OFF`, `CANCELED`.  
**Rebuild stage:** 8.

Step kinds (A §8.5) map 1:1 onto the non-terminal statuses after `OPEN`: `REMIND` → `REMINDING`, `REMIND_ESCALATED` → `REMIND_ESCALATED`, `PAUSE_NEW_CREDIT` → `CREDIT_PAUSED`, `SUSPEND_USAGE` → `USAGE_SUSPENDED`, `LEGAL_ESCALATION` → `LEGAL`, `WRITE_OFF_REVIEW` → `WRITE_OFF_REVIEW`.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `OPEN` | `OpenDunningCase` | SYSTEM / WORKER | invoice `ISSUED` or `PART_PAID`, `due_at < now`, no open case for invoice | Y (`AR_OVERDUE`) | — | Y | `fin.dunning.step` | — |
| `OPEN` | `REMINDING` | `AdvanceDunning` | WORKER | first step due | Y | — | Y | `fin.dunning.step` + `notification.lifecycle` | insert `dunning_steps` REMIND |
| `REMINDING` | `REMIND_ESCALATED` | `AdvanceDunning` | WORKER | prior step `completed_at` + policy delay | Y | — | Y | same | step REMIND_ESCALATED |
| `REMIND_ESCALATED` | `CREDIT_PAUSED` | `AdvanceDunning` | WORKER | same | Y | — | Y | same | step PAUSE_NEW_CREDIT; `account_controls.allow_purchases=false` (snapshot first — DL-036) |
| `CREDIT_PAUSED` | `USAGE_SUSPENDED` | `AdvanceDunning` | WORKER | same | Y | — | Y | same + `fin.contract.status` if contract suspends | step SUSPEND_USAGE; `allow_prepaid_usage`/`allow_postpaid_usage`=false |
| `USAGE_SUSPENDED` | `LEGAL` | `AdvanceDunning` | WORKER / USER | policy | Y | — | Y | same | step LEGAL_ESCALATION |
| `LEGAL` | `WRITE_OFF_REVIEW` | `AdvanceDunning` | USER / WORKER | policy | Y | — | Y | same | step WRITE_OFF_REVIEW |
| `WRITE_OFF_REVIEW` | `WRITTEN_OFF` | `WriteOffInvoice` | USER | — | Y | `WRITE_OFF` | Y | `fin.dunning.step` + `fin.invoice.status` | invoice → UNCOLLECTIBLE; C §5.14 |
| *any non-terminal* | `CURED` | `CureDunning` | SYSTEM / WORKER / USER | invoice `PAID` or payment covers due | Y (`AR_CURED`) | — | Y | `fin.dunning.step` + `notification.lifecycle` | restore `account_controls` from snapshot (DL-036) |
| *any non-terminal* | `CANCELED` | `CancelDunning` | USER | opened in error; invoice not written off | Y | — | Y | `fin.dunning.step` | restore snapshot if flags were flipped |

**Illegal:** `DUNNING_STEP_SKIP` (WORKER may not jump a kind), `DUNNING_ALREADY_TERMINAL`, `DUNNING_NO_SNAPSHOT` (restrictive step without DL-036 column).

<!-- OPEN: A omitted `dunning_cases.status` enum and `controls_snapshot`. DL-030 + DL-036. Do not stuff snapshot into `dunning_steps.outcome`. -->

---

## 7. `fin.idempotency_keys` — INTENT (A §12.2, spec §89–90)

**Statuses:** `IN_FLIGHT` · `COMPLETED` · `FAILED`  
**PK:** `id UUID`  
**Unique:** `(environment, tenant_id, key)`  
**TTL:** `expires_at` default 24h (DL-022). Replay of an expired key → `IDEMPOTENCY_KEY_EXPIRED`, **not** re-execute.  
**Rebuild stage:** 1. Agent C owns replay / reject / in-flight lock. This table is the machine only.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `IN_FLIGHT` | any mutating command | *caller* | key unused; `expires_at > now` | — | — | Y | — | row insert |
| `IN_FLIGHT` | `COMPLETED` | command success (same tx) | *caller* | fingerprint matches | — | — | Y | — | `response_status` / `response_body` stored |
| `IN_FLIGHT` | `FAILED` | command error (same tx) | *caller* | — | Y (`cmd code`) | — | Y | — | stored error envelope |
| `FAILED` | `IN_FLIGHT` | retry, same key | *caller* | fingerprint **equals**; not expired | — | — | Y | — | Agent C specifies the wait / 409-in-flight |
| `COMPLETED` | `COMPLETED` | replay | *caller* | fingerprint equals; not expired | — | — | N | — | return stored body; **zero** economic writes |

**Illegal:** `IDEMPOTENCY_KEY_IN_FLIGHT` (second caller, same key, still IN_FLIGHT), `IDEMPOTENCY_FINGERPRINT_CONFLICT` (same key, different body), `IDEMPOTENCY_KEY_EXPIRED`, `IDEMPOTENCY_REPLAY_MUTATION` (COMPLETED must not re-enter IN_FLIGHT).

No outbox: this row **is** the replay cache. Audit on first completion/failure only; replays are N.

---

## 8. `fin.outbox_events` — INTENT (A §12.3, spec §92)

**Statuses:** `PENDING` · `PUBLISHED` · `FAILED` · `DEAD`  
**PK:** `id UUID`  
**Terminal:** `PUBLISHED`, `DEAD`.  
**Rebuild stage:** 1. Closes audit B-8 (lost `fireAndForgetNotify`).

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `PENDING` | *owning command* | *owning actor* | written in the money tx | — | — | N | *(this row)* | — |
| `PENDING` | `PUBLISHED` | `PublishOutbox` | WORKER | first successful deliver | — | — | N | — | `published_at` set; `attempts++` |
| `PENDING` | `FAILED` | `PublishOutbox` | WORKER | deliver error; `attempts < max` | Y (`last_error_code`) | — | N | — | `next_retry_at` backoff; `attempts++` |
| `FAILED` | `PENDING` | `PublishOutbox` (claim) | WORKER | `next_retry_at <= now`; SKIP LOCKED | — | — | N | — | — |
| `FAILED` | `DEAD` | `PublishOutbox` | WORKER | `attempts >= max` (default 8 — C may tighten) | Y | — | Y | — | metric + alarm; do not swallow (audit A-2 class) |

**Illegal:** `OUTBOX_ALREADY_PUBLISHED`, `OUTBOX_DEAD_REPLAY` (ops may insert a **new** row with a new id; they must not resurrect DEAD).

Audit is N on the hot path (volume). DEAD is Y — that is the enterprise signal the 42P10 swallow never had.

---

## 9. `fin.reconciliation_runs` — INTENT (A §12.6, spec §95)

A omitted the enum (DL-032).

**Statuses:** `STARTED` · `RUNNING` · `COMPLETED` · `FAILED` · `CANCELED`  
**PK:** `id UUID`  
**Terminal:** `COMPLETED`, `FAILED`, `CANCELED`.  
**Rebuild stage:** 1 (framework), checks filled by F per stage.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `STARTED` | `StartReconRun` | WORKER / USER / RECONCILIATION | no other RUNNING run for same `(environment, scope)` | Y | — | Y | — | — |
| `STARTED` | `RUNNING` | `StartReconRun` (same tx or first check) | WORKER / RECONCILIATION | — | — | — | N | — | `reconciliation_checks` append |
| `RUNNING` | `COMPLETED` | `FinishReconRun` | WORKER / RECONCILIATION | every planned `check_code` has a row | Y | — | Y | `fin.reconciliation.run` | drift rows; OPEN resolutions for DRIFT |
| `RUNNING` | `FAILED` | `FinishReconRun` | WORKER / RECONCILIATION | runner error / check `ERROR` above fail-closed threshold | Y | — | Y | `fin.reconciliation.run` | — |
| `STARTED`/`RUNNING` | `CANCELED` | `CancelReconRun` | USER | not finished | Y | — | Y | `fin.reconciliation.run` | — |

**Illegal:** `RECON_RUN_ALREADY_ACTIVE`, `RECON_RUN_INCOMPLETE` (COMPLETED without all check codes).

<!-- OPEN: A omitted `reconciliation_runs.status` enum. DL-032. -->

---

## 10. `fin.reconciliation_resolution` — INTENT (A §12.6, spec §97)

A has `action` + `resolved_at` + `approval_request_id` and no `status` (DL-033).

**Statuses:** `OPEN` · `PENDING_APPROVAL` · `APPLIED` · `REJECTED`  
**PK:** `id UUID`  
**Terminal:** `APPLIED`, `REJECTED`.  
**Actions (A):** `WARN` · `BLOCK_NEW_ISSUANCE` · `BLOCK_AFFECTED_HOLDER` · `BLOCK_AFFECTED_BOOK` · `BLOCK_BILLING_CLOSE`

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `OPEN` | `FinishReconRun` (per drift) | RECONCILIATION / WORKER | parent check `DRIFT` | Y (`check_code`) | — | Y | — | — |
| `OPEN` | `APPLIED` | `ApplyResolution` | USER / RECONCILIATION | `action=WARN` only | Y | — | Y | `fin.reconciliation.resolution` | exception queue only |
| `OPEN` | `PENDING_APPROVAL` | `ApplyResolution` | USER | `action` is `BLOCK_*` | Y | opens `RECONCILIATION_OVERRIDE` | Y | `fin.approval.requested` | — |
| `PENDING_APPROVAL` | `APPLIED` | `ApplyResolution` | USER / RECONCILIATION | approval EXECUTED in-tx | Y | `RECONCILIATION_OVERRIDE` | Y | `fin.reconciliation.resolution` | write `account_controls` or billing-close gate |
| `PENDING_APPROVAL` | `REJECTED` | `DecideApproval` REJECT or `RejectResolution` | USER | — | Y | — | Y | `fin.reconciliation.resolution` | — |

**Illegal:** `RECON_RESOLUTION_WARN_ONLY` (BLOCK without approval path), `RECON_RESOLUTION_ALREADY_TERMINAL`.

<!-- OPEN: A omitted `reconciliation_resolution.status`. DL-033. `id UUID` assumed PK (A lists columns without declaring PK; same convention as every other table). -->

---

## 11. `fin.billing_periods` — INTENT (A §10.1, spec §76–77)

**Statuses:** `OPEN` · `USAGE_CLOSING` · `USAGE_CLOSED` · `RATING_CLOSED` · `INVOICE_DRAFTED` · `INVOICED` · `FINAL`  
**PK:** `id UUID`  
**Terminal:** `FINAL`. Forward-only except the documented reopen.  
**Rebuild stage:** 10. Distinct from `accounting_periods` (A §9.0).

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `OPEN` | `OpenBillingPeriod` | SYSTEM / WORKER | unique `(billing_account_id, period_key, environment)`; clock in range | Y | — | Y | `fin.billing_period.status` | — |
| `OPEN` | `USAGE_CLOSING` | `CloseBillingPeriod` step 1 | WORKER / USER | `ends_at <= now` | Y | — | Y | `fin.billing_period.status` | late usage still accepted as `PRE_INVOICE` |
| `USAGE_CLOSING` | `USAGE_CLOSED` | step 2 | WORKER | meter worker drained; no IN_FLIGHT rating for this period | Y | — | Y | `fin.billing_period.status` | — |
| `USAGE_CLOSED` | `RATING_CLOSED` | step 3 | WORKER | every `metered_usage` ACTIVE for the period has `rated_usage` | Y | — | Y | `fin.billing_period.status` | — |
| `RATING_CLOSED` | `INVOICE_DRAFTED` | `DraftInvoice` | WORKER / USER | draft invoice exists for this period | Y | — | Y | `fin.billing_period.status` + `fin.invoice.status` | invoice DRAFT |
| `INVOICE_DRAFTED` | `INVOICED` | `IssueInvoice` | USER / WORKER | invoice ISSUED | Y | — | Y | `fin.billing_period.status` + `fin.invoice.status` | see §14 |
| `INVOICED` | `FINAL` | `FinalizeBillingPeriod` | USER / WORKER | invoice not VOID; accounting period at least SOFT_CLOSED or G says period-final independent | Y | — | Y | `fin.billing_period.status` | — |
| `USAGE_CLOSING` | `OPEN` | `ReopenBillingPeriod` | USER | no invoice drafted yet | Y | — | Y | `fin.billing_period.status` | late-class remains OPEN_PERIOD |
| `INVOICE_DRAFTED` | `RATING_CLOSED` | `ReopenBillingPeriod` | USER | draft VOID or discarded; not issued | Y | — | Y | `fin.billing_period.status` | — |

**Illegal:** `BILLING_PERIOD_SKIP`, `BILLING_PERIOD_FINAL`, `BILLING_PERIOD_REOPEN_AFTER_ISSUE` (issued invoices are corrected with credit/debit notes, not by reopening).

12-step close internals (spec §77) are the worker's checklist inside these seven statuses — they are not extra statuses.

---

## 12. `fin.facility_reservations` — INTENT (A §8.3, spec §54–56)

**Statuses:** `OPEN` · `CAPTURED` · `RELEASED` · `EXPIRED`  
**PK:** `id UUID`  
**Terminal:** `CAPTURED`, `RELEASED`, `EXPIRED`.  
**Rebuild stage:** 8. Mirrors `holds`. A reservation without a hold is legal for `DirectSpendPostpaid`.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `OPEN` | `AuthorizeHold` (shortfall) or `ReserveFacility` | USER / SYSTEM / WORKER | facility `ACTIVE`; `SUM(OPEN.reserved_minor)+this <= limit_minor` | Y | — | Y | `fin.facility.reservation` | may set `hold_id` |
| `OPEN` | `CAPTURED` | `CaptureHold` / `DirectSpendPostpaid` / `CaptureFacility` | USER / SYSTEM / WORKER | facility still ACTIVE or G allows capture on PAUSED | Y | — | Y | `fin.facility.reservation` + `fin.ledger.posted` | FACILITY_DRAW lot remaining 0 after capture (Stage 8 test); receivable (G) |
| `OPEN` | `RELEASED` | `VoidHold` / `ReleaseFacility` | USER / SYSTEM / WORKER | — | Y | — | Y | `fin.facility.reservation` | limit exposure down |
| `OPEN` | `EXPIRED` | `ExpireFacilityReservation` | WORKER | `hold` EXPIRED or reservation TTL | Y (`FACILITY_RES_TTL`) | — | Y | `fin.facility.reservation` | — |

**Illegal:** `FACILITY_LIMIT_EXCEEDED`, `FACILITY_NOT_ACTIVE`, `FACILITY_RES_NOT_OPEN`.

---

## 13. `fin.disputes` — INTENT (A §10.9c, spec M6)

**Statuses:** `OPEN` · `EVIDENCE_REQUIRED` · `WON` · `LOST` · `CANCELED`  
**PK:** `id UUID`  
**Terminal:** `WON`, `LOST`, `CANCELED`.  
**Rebuild stage:** 7/10. Chargebacks do **not** rebuild `payments` (DL-019).

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `OPEN` | `OpenDispute` | PSP / WORKER | payment exists; amount ≤ payment | Y | — | Y | `fin.dispute.status` + `webhook.stripe` | payment stays ALLOCATED until LOST |
| `OPEN` | `EVIDENCE_REQUIRED` | `RequestDisputeEvidence` | PSP / WORKER | — | Y | — | Y | `fin.dispute.status` | — |
| `EVIDENCE_REQUIRED` | `OPEN` | `SubmitDisputeEvidence` | USER / WORKER | before `evidence_due_at` | Y | — | Y | `fin.dispute.status` | — |
| `OPEN` or `EVIDENCE_REQUIRED` | `WON` | `DecideDispute` | PSP / WORKER | — | Y | — | Y | `fin.dispute.status` + `notification.lifecycle` | no payment reverse |
| `OPEN` or `EVIDENCE_REQUIRED` | `LOST` | `DecideDispute` | PSP / WORKER | — | Y | `LARGE_REFUND` if cash already remitted and we refund lots | Y | `fin.dispute.status` + `fin.payment.status` + `fin.ledger.posted` | payment → REVERSED (C §5.13); invoice may PART_PAID; lots via REFUND |
| `OPEN` or `EVIDENCE_REQUIRED` | `CANCELED` | `CancelDispute` | PSP / USER | network withdrew | Y | — | Y | `fin.dispute.status` | — |

**Illegal:** `DISPUTE_NOT_OPEN`, `DISPUTE_ALREADY_TERMINAL`, `DISPUTE_EVIDENCE_LATE`.

---

## 14. `fin.contracts` — MUTABLE header (A §7.1, spec §12)

**Statuses:** `DRAFT` · `ACTIVE` · `SUSPENDED` · `TERMINATED` · `EXPIRED`  
**PK:** `id UUID`  
**Terminal:** `TERMINATED`, `EXPIRED`.  
**Rebuild stage:** 4. Replaces `commercial.billing_subscriptions` as SoR (legacy stays until Stage 13).

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `DRAFT` | `CreateContract` | USER | seller + billing account env match | Y | — | Y | — | — |
| `DRAFT` | `ACTIVE` | `ActivateContract` | USER | exactly one `contract_versions.status=ACTIVE`; `starts_at <= now` | Y | `BACKDATED_AMENDMENT` if `starts_at < now` | Y | `fin.contract.status` + `notification.lifecycle` | — |
| `DRAFT` | `TERMINATED` | `TerminateContract` | USER | never activated | Y | — | Y | `fin.contract.status` | — |
| `ACTIVE` | `SUSPENDED` | `SuspendContract` | USER / WORKER | dunning or control | Y | — | Y | `fin.contract.status` + `notification.lifecycle` | `account_controls` usage flags as reason says |
| `SUSPENDED` | `ACTIVE` | `ResumeContract` | USER / WORKER | dunning CURED or explicit | Y | — | Y | `fin.contract.status` + `notification.lifecycle` | restore flags |
| `ACTIVE` | `TERMINATED` | `TerminateContract` | USER | — | Y | — | Y | `fin.contract.status` + `notification.lifecycle` | freeze lots? G; default FROZEN on contract-scoped lots |
| `SUSPENDED` | `TERMINATED` | `TerminateContract` | USER | — | Y | — | Y | same | same |
| `ACTIVE` or `SUSPENDED` | `EXPIRED` | `ExpireContract` | WORKER | `ends_at <= now` | Y (`CONTRACT_END`) | — | Y | `fin.contract.status` + `notification.lifecycle` | expire or freeze remaining lots per G |

**Illegal:** `CONTRACT_NO_ACTIVE_VERSION`, `CONTRACT_ALREADY_TERMINAL`, `CONTRACT_ACTIVATE_WITHOUT_VERSION`.

Header status is **access / commercial life**. Financial restrictions stay on `account_controls` (A §3.4 / §3.10). Do not overload `contracts.status` with `allow_*` flags.

---

## 15. `fin.contract_versions` — VERSIONED (A §7.2, spec §13)

A has no `status` column. User-required machine is `DRAFT` / `ACTIVE` / `SUPERSEDED` (DL-029).

**Statuses:** `DRAFT` · `ACTIVE` · `SUPERSEDED`  
**PK:** `id UUID`  
**Terminal:** `SUPERSEDED`. At most one `ACTIVE` per `contract_id` (enforced with the gist exclude + this machine).  
**Rebuild stage:** 4.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `DRAFT` | `CreateContractVersion` | USER | contract not TERMINATED/EXPIRED | Y | — | Y | — | components writable |
| `DRAFT` | `ACTIVE` | `ActivateContractVersion` | USER | `approved_by_approval_id` set when policy requires; gist exclude vs other versions; `effective_from` set | Y | `BACKDATED_AMENDMENT` if `effective_from < now` | Y | `fin.contract.version` | close previous ACTIVE → SUPERSEDED **in the same tx**; set its `effective_to` |
| `ACTIVE` | `SUPERSEDED` | `ActivateContractVersion` (on the successor) or `SupersedeContractVersion` | USER / SYSTEM | successor ACTIVE in same tx, or contract TERMINATED | Y | — | Y | `fin.contract.version` | `effective_to` set; gist remains valid |

**Illegal:** `CONTRACT_VERSION_NOT_DRAFT`, `CONTRACT_VERSION_OVERLAP` (T9 / DL-023), `CONTRACT_VERSION_MUTATE_ACTIVE` (component write after ACTIVE), `CONTRACT_VERSION_TWO_ACTIVE`.

DRAFT is the only mutable version. `approved_by_approval_id` is set on the way to ACTIVE, not as a separate status.

<!-- OPEN: A omitted `contract_versions.status`. DL-029. Without it the machine is not persistable; do not derive DRAFT from `approved_by_approval_id IS NULL` (a scheduled-but-approved version is not a draft). -->

---

## 16. `fin.invoices` — INTENT then APPEND_ONLY after ISSUE (A §10.3, spec §78–80)

**Statuses:** `DRAFT` · `APPROVED` · `ISSUED` · `PART_PAID` · `PAID` · `VOID` · `UNCOLLECTIBLE`  
**PK:** `id UUID`  
**Terminal:** `VOID`. `PAID` is cash-terminal (corrections are credit/debit notes). `UNCOLLECTIBLE` may return to `PAID` on recovery.  
**Rebuild stage:** 10. Sequence number allocated **only** on ISSUE (spec §80).

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `DRAFT` | `DraftInvoice` | WORKER / USER | period `RATING_CLOSED` or ad-hoc; lines have `source_type/id` (no sourceless lines) | Y | — | Y | `fin.invoice.status` | lines + tax drafts writable |
| `DRAFT` | `APPROVED` | `ApproveInvoice` | USER | totals = sum(lines)+tax; tax_snapshots present | Y | — | Y | `fin.invoice.status` | — |
| `APPROVED` | `DRAFT` | `ReturnInvoiceToDraft` | USER | not issued; no sequence consumed | Y | — | Y | `fin.invoice.status` | — |
| `DRAFT` | `VOID` | `VoidDraftInvoice` | USER | never issued | Y | — | Y | `fin.invoice.status` | no sequence consumed |
| `APPROVED` | `ISSUED` | `IssueInvoice` | USER / WORKER | sequence `UPDATE next_n … RETURNING`; WC-KSA columns if SA (DL-018) | Y | — | Y | `fin.invoice.status` + `fin.invoice.render` + `fin.zatca.submit`? + `notification.lifecycle` | freeze lines; `invoice_number` set; period → INVOICED; **no** `ledger_transactions` (C §6) |
| `ISSUED` | `PART_PAID` | `ApplyPayment` | SYSTEM / WORKER / USER | 0 < allocated < `total_minor` | Y | — | Y | `fin.invoice.status` + `fin.payment.status` | `invoice_payment_allocations` |
| `ISSUED` | `PAID` | `ApplyPayment` | SYSTEM / WORKER / USER | allocated = `total_minor` | Y | — | Y | `fin.invoice.status` + `notification.lifecycle` | same; `CureDunning` if case open |
| `PART_PAID` | `PAID` | `ApplyPayment` | SYSTEM / WORKER / USER | cumulative = total | Y | — | Y | same | same |
| `ISSUED` or `PART_PAID` | `VOID` | `VoidIssuedInvoice` | USER | no remaining allocated cash, or allocations reversed first | Y | `INVOICE_VOID` | Y | `fin.invoice.status` + `notification.lifecycle` | number **kept** (spec §124); credit/debit as G requires |
| `ISSUED` or `PART_PAID` | `UNCOLLECTIBLE` | `WriteOffInvoice` | USER | dunning WRITE_OFF_REVIEW or explicit | Y | `WRITE_OFF` | Y | `fin.invoice.status` | C §5.14 ADJUSTMENT if facility exposure remains |
| `UNCOLLECTIBLE` | `PAID` | `ApplyPayment` (recovery) | USER / WORKER | full recovery | Y (`BAD_DEBT_RECOVERY`) | — | Y | `fin.invoice.status` | reverse write-off accounting (G) |
| `UNCOLLECTIBLE` | `PART_PAID` | `ApplyPayment` (partial recovery) | USER / WORKER | partial | Y | — | Y | `fin.invoice.status` | — |
| `PAID` | `PART_PAID` | `IssueCreditNote` / `ReversePayment` | USER / PSP | note or reverse reduces applied below total | Y | `LARGE_REFUND` if cash out | Y | `fin.invoice.status` | — |

**Illegal:** `INVOICE_NOT_DRAFT`, `INVOICE_SEQUENCE_REUSE`, `INVOICE_VOID_WITH_CASH`, `INVOICE_MUTATE_AFTER_ISSUE` (line UPDATE), `INVOICE_ZATCA_FIELDS_MISSING` (SA at ISSUE).

`IssueInvoice` does **not** mint credits. Prepaid FUNDING already happened on `purchase_intents`. Postpaid receivable is booked at **capture** (G), not at ISSUE.

---

## 17. `fin.credit_notes` / `fin.debit_notes` — INTENT then APPEND_ONLY after ISSUE (A §10.8, spec §81)

A omitted the enum (DL-031). Same machine on both tables.

**Statuses:** `DRAFT` · `APPROVED` · `ISSUED` · `VOID`  
**PK:** `id UUID`  
**Must** reference an **ISSUED** (or later non-VOID) invoice. Unlinked notes are not this product (`commercial.billing_credit_notes` is legacy).  
**Rebuild stage:** 10.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `DRAFT` | `DraftCreditNote` / `DraftDebitNote` | USER | parent invoice issued; cumulative notes ≤ invoice total (credit) | Y | — | Y | — | `invoice_adjustments` draft? no — only on ISSUE |
| `DRAFT` | `APPROVED` | `ApproveNote` | USER | — | Y | `LARGE_REFUND` if credit returns cash | Y | — | — |
| `APPROVED` | `DRAFT` | `ReturnNoteToDraft` | USER | — | Y | — | Y | — | — |
| `DRAFT` or `APPROVED` | `VOID` | `VoidNote` | USER | never issued | Y | — | Y | — | — |
| `APPROVED` | `ISSUED` | `IssueCreditNote` / `IssueDebitNote` | USER / WORKER | sequence for `CREDIT_NOTE` / `DEBIT_NOTE`; parent not VOID | Y | consumed if opened | Y | `fin.credit_note.status` or `fin.debit_note.status` + `fin.ledger.posted`? | C §5.8 / §5.9; `invoice_adjustments` append |
| `ISSUED` | `VOID` | `VoidIssuedNote` | USER | rare; tax jurisdiction allows | Y | `INVOICE_VOID` | Y | same | reversing adjustment; fail closed if jurisdiction forbids (`NOTE_VOID_FORBIDDEN`) |

**Illegal:** `NOTE_PARENT_NOT_ISSUED`, `NOTE_EXCEEDS_INVOICE`, `NOTE_SEQUENCE_REUSE`.

---

## 18. `fin.credit_facilities` — MUTABLE (A §8.2, spec §53)

**Statuses:** `PENDING` · `ACTIVE` · `PAUSED` · `SUSPENDED` · `CLOSED`  
**PK:** `id UUID`  
**Terminal:** `CLOSED`.  
**Rebuild stage:** 8.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `PENDING` | `CreateFacility` | USER | `allow_postpaid_usage` path will need this; limit > 0 | Y | — | Y | `fin.facility.status` | — |
| `PENDING` | `ACTIVE` | `ActivateFacility` | USER | `valid_from <= now`; legal entity open period | Y | `FACILITY_OPS` | Y | `fin.facility.status` | — |
| `PENDING` | `CLOSED` | `CloseFacility` | USER | never used | Y | `FACILITY_OPS` | Y | `fin.facility.status` | — |
| `ACTIVE` | `PAUSED` | `PauseFacility` | USER | no new reservations; OPEN ones remain | Y | `FACILITY_OPS` | Y | `fin.facility.status` | — |
| `PAUSED` | `ACTIVE` | `ResumeFacility` | USER | `valid_to` still open | Y | `FACILITY_OPS` | Y | `fin.facility.status` | — |
| `ACTIVE` | `SUSPENDED` | `SuspendFacility` | WORKER / USER | dunning USAGE_SUSPENDED or control | Y | `FACILITY_OPS` if USER | Y | `fin.facility.status` + `notification.lifecycle` | new authorize shortfall denied (`FACILITY_NOT_ACTIVE`) |
| `SUSPENDED` | `ACTIVE` | `ResumeFacility` | USER / WORKER | dunning CURED or explicit | Y | `FACILITY_OPS` if USER | Y | `fin.facility.status` | — |
| `ACTIVE`/`PAUSED`/`SUSPENDED` | `CLOSED` | `CloseFacility` | USER | no OPEN reservations (capture/release/expire first) | Y | `FACILITY_OPS` | Y | `fin.facility.status` | — |

**Illegal:** `FACILITY_OPEN_RESERVATIONS`, `FACILITY_ALREADY_CLOSED`, `FACILITY_LIMIT_CHANGE_WHILE_CLOSED` (limit edits are UPDATEs on ACTIVE/PAUSED only, same `FACILITY_OPS`, not a status change).

---

## 19. `fin.lots` — MUTABLE remaining_units-via-allocations (A §5.1, spec §35)

**Statuses:** `ACTIVE` · `EXHAUSTED` · `EXPIRED` · `FROZEN`  
**PK:** `id UUID`  
**SoT for spendability.** `remaining_units` is a cache of `granted_units + SUM(lot_allocations.units)` (A §5.3). Status is not inferred from remaining alone: a frozen lot may still have remaining.  
**Rebuild stage:** 1 (table), 6/7 (writers). A-4 second ledger is **not** retired here — Stage 6/7 + 13.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `ACTIVE` | `FundPurchase` / `GrantCredits` / dest `TransferCredits` / `MigrateLot` / refund reversal | *cmd actor* | `granted_units > 0`; `remaining_units=granted_units` | Y | per command | Y | `fin.lot.issued` | ISSUANCE/AVAILABLE postings on the command's tx |
| `ACTIVE` | `EXHAUSTED` | capture / `DirectSpend` / transfer-out / migrate-out | *cmd actor* | `remaining_units` becomes 0 in-tx | — | — | Y | `fin.lot.exhausted` | status flip after allocations |
| `EXHAUSTED` | `ACTIVE` | `VoidHold` / refund restore | *cmd actor* | restore makes `remaining_units > 0` | Y | — | Y | `fin.lot.issued` | — |
| `ACTIVE` | `EXPIRED` | `ExpireLot` | WORKER | `expires_at <= now`; remaining > 0 | Y (`LOT_TTL`) | — | Y | `fin.lot.expired` + `fin.ledger.posted` | EXPIRY tx AVAILABLE→EXPIRED (C §5.6) |
| `ACTIVE` | `FROZEN` | `FreezeLot` | USER / SYSTEM | — | Y | — if contract terminate SYSTEM | Y | `fin.lot.frozen` | not drawable; holds already OPEN stay |
| `FROZEN` | `ACTIVE` | `UnfreezeLot` | USER | contract not TERMINATED | Y | — | Y | `fin.lot.frozen` | — |
| `FROZEN` | `EXPIRED` | `ExpireLot` | WORKER | clock + `expires_at` | Y | — | Y | `fin.lot.expired` + `fin.ledger.posted` | same EXPIRY tx if remaining > 0 |

**Illegal:** `LOT_NOT_DRAWABLE` (`FROZEN`/`EXPIRED`/`EXHAUSTED`), `LOT_REMAINING_MUTATION` (direct UPDATE of `remaining_units`), `LOT_UNEXPIRE` (no EXPIRED→ACTIVE; compensation is a new lot).

`EXHAUSTED`→`FROZEN` is not used. Expired lots are not un-frozen back into spendable units.

---

## 20. `fin.accounting_periods` — INTENT (A §9.0, DL-016)

**Statuses:** `OPEN` · `SOFT_CLOSED` · `HARD_CLOSED`  
**PK:** `id UUID`  
**Terminal:** none forever — HARD_CLOSED may reopen to SOFT_CLOSED only.  
**Rebuild stage:** 1/9. SOX 302/404 close. **Not** `billing_periods`.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `OPEN` | `OpenAccountingPeriod` | USER / SYSTEM | unique `(legal_entity_id, period_key, environment)` | Y | — | Y | `fin.accounting_period.status` | — |
| `OPEN` | `SOFT_CLOSED` | `SoftCloseAccountingPeriod` | USER | `ends_at <= now` | Y | — | Y | `fin.accounting_period.status` | new usage books as adjustment in the **open** period (`late_class` POST_INVOICE / CLOSED_ACCOUNTING) |
| `SOFT_CLOSED` | `HARD_CLOSED` | `HardCloseAccountingPeriod` | USER | recon run COMPLETED with no unresolved `BLOCK_*`; G sign-off checklist | Y | — | Y | `fin.accounting_period.status` | insert trigger on `accounting_events` rejects this period |
| `HARD_CLOSED` | `SOFT_CLOSED` | `ReopenAccountingPeriod` | USER / RECONCILIATION | — | Y | `RECONCILIATION_OVERRIDE` | Y | `fin.accounting_period.status` | A §9.0 — **must** reopen before override events |
| `SOFT_CLOSED` | `OPEN` | `ReopenAccountingPeriod` | USER | no HARD_CLOSED has happened in this row's life **or** G allows; default **forbidden** | Y | `RECONCILIATION_OVERRIDE` | Y | `fin.accounting_period.status` | default code `ACCOUNTING_PERIOD_CANNOT_FULLY_REOPEN` unless G flips |

**Illegal:** `ACCOUNTING_PERIOD_SKIP_TO_HARD` (OPEN→HARD_CLOSED), `ACCOUNTING_PERIOD_HARD_CLOSED` (inserts), `ACCOUNTING_PERIOD_REOPEN_WITHOUT_APPROVAL`.

---

## 21. `fin.vendor_statements` — INTENT then APPEND_ONLY after FINALIZE (A §11.7, spec §86)

**Statuses:** `OPEN` · `FINALIZED`  
**PK:** `id UUID`  
**Terminal:** `FINALIZED`. Lines immutable after FINALIZE.  
**Rebuild stage:** 11.

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `OPEN` | `OpenVendorStatement` | USER / WORKER | one OPEN per `(vendor_id, period_key, environment)` — DL-035 | Y | — | Y | — | lines writable |
| `OPEN` | `FINALIZED` | `FinalizeVendorStatement` | USER / WORKER | `total_minor` = sum(lines) | Y | — | Y | `fin.vendor.statement.finalized` | REVOKE line UPDATE (same posture as invoice ISSUE) |

**Illegal:** `VENDOR_STATEMENT_ALREADY_FINAL`, `VENDOR_STATEMENT_TOTAL_MISMATCH`, `VENDOR_STATEMENT_REOPEN` (corrections are a **new** statement with a distinct `period_key` suffix or a following period — not a status rewind).

<!-- OPEN: A did not UNIQUE `(vendor_id, period_key, environment)`. DL-035 claims it. -->

---

## 22. `fin.payments` — INTENT (A §10.9)

Not in the prompt list; it is INTENT in A and cash commands in C depend on it. Short machine so C does not invent statuses.

**Statuses:** `RECEIVED` · `ALLOCATED` · `REVERSED`  
**PK:** `id UUID`

| from | to | trigger | actor | guard | reason | approval | audit | outbox | side-effect |
|---|---|---|---|---|---|---|---|---|---|
| — | `RECEIVED` | `RecordPayment` | PSP / USER / WORKER | `UNIQUE(provider, provider_event_id)` when provider set | Y | — | Y | `fin.payment.status` | `unapplied_cash +` |
| `RECEIVED` | `ALLOCATED` | `ApplyPayment` | USER / WORKER / SYSTEM | allocations sum = `amount_minor` | Y | — | Y | `fin.payment.status` | invoice status; `unapplied_cash −` |
| `RECEIVED` | `REVERSED` | `ReversePayment` | PSP / USER | nothing allocated, or allocate-reverse first | Y | `LARGE_REFUND` if cash out | Y | `fin.payment.status` | `unapplied_cash −` |
| `ALLOCATED` | `REVERSED` | `ReversePayment` / dispute LOST | PSP / USER | reverse allocations first | Y | `LARGE_REFUND` | Y | `fin.payment.status` + `fin.invoice.status` | invoice PART_PAID/ISSUED |

Partial allocate while remainder sits in `unapplied_cash` keeps status `RECEIVED` until fully allocated (A's three statuses have no `PART_ALLOCATED`). Documented here so C does not add a fourth status.

---

## 23. Stable error codes (transition + command)

Envelope is spec §109 (`code`, `category`, `retryable`, `customer_actionable`, `support_reference`, `safe_message`). Category is not invented per machine: `VALIDATION` · `CONFLICT` · `PRECONDITION` · `INSUFFICIENT` · `CONTROL` · `APPROVAL` · `IDEMPOTENCY` · `CONSERVATION`.

| Code | Category | Typical machine |
|---|---|---|
| `OCC_VERSION_MISMATCH` | CONFLICT | every INTENT/MUTABLE |
| `REASON_CODE_REQUIRED` | VALIDATION | every economic transition |
| `ENV_MISMATCH` | VALIDATION | every |
| `CONTROL_DENY` | CONTROL | authorize, purchase, transfer, grant, refund |
| `ACCOUNTING_PERIOD_HARD_CLOSED` | PRECONDITION | any new economic effect |
| `HOLD_NOT_OPEN` / `HOLD_ALREADY_TERMINAL` / `HOLD_EXPIRED` / `HOLD_DOUBLE_CAPTURE` / `HOLD_ALLOCATION_MISSING` | PRECONDITION | holds |
| `INSUFFICIENT_ELIGIBLE_CREDITS` | INSUFFICIENT | authorize / spend |
| `FACILITY_LIMIT_EXCEEDED` / `FACILITY_NOT_ACTIVE` | INSUFFICIENT | facility |
| `LIMIT_BLOCKED` | CONTROL | usage_limits BLOCK |
| `TRANSFER_PAIR_COMPLETE` | CONSERVATION | TransferCredits third leg |
| `TRANSFER_PAIR_INCOMPLETE` | CONSERVATION | would-be 1-leg commit |
| `TRANSFER_CROSS_POSTING` | CONSERVATION | posting.book_id ≠ tx.book_id (DL-012) |
| `FX_SNAPSHOT_REQUIRED` | VALIDATION | cross-currency pair (DL-015/026) |
| `IDEMPOTENCY_KEY_EXPIRED` / `IDEMPOTENCY_KEY_IN_FLIGHT` / `IDEMPOTENCY_FINGERPRINT_CONFLICT` | IDEMPOTENCY | keys |
| `APPROVAL_PAYLOAD_MISMATCH` / `APPROVAL_FOUR_EYES_REQUIRED` / `APPROVAL_NOT_APPROVED` | APPROVAL | approvals |
| `INVOICE_SEQUENCE_REUSE` / `INVOICE_VOID_WITH_CASH` / `INVOICE_ZATCA_FIELDS_MISSING` | PRECONDITION | invoices |
| `CONTRACT_NO_ACTIVE_VERSION` / `CONTRACT_VERSION_OVERLAP` | PRECONDITION | contracts |
| `LOT_NOT_DRAWABLE` / `LOT_REMAINING_MUTATION` | PRECONDITION | lots |
| `PURCHASE_PROVIDER_EVENT_REUSED` | CONFLICT | purchase_intents |
| `DUNNING_STEP_SKIP` | VALIDATION | dunning |
| `EVENT_KIND_MISMATCH` | VALIDATION | usage ingest (DL-060) |
| `PARTITION_DDL_IN_PROGRESS` | CONFLICT | usage partition ensure (DL-062) |
| `FIN_FILTER_INVALID` | VALIDATION | meter filter DSL (DL-064) |
| `FIN_METER_VERSION_NOT_FOUND` | PRECONDITION | metering pipeline (DL-064) |
| `METERING_LOCK_HELD` | CONFLICT | metering tick / `meterPeriod` (DL-064); retryable — caller skips |
| `BACKDATED_AMENDMENT_REQUIRED` | APPROVAL | activate price/contract version when `effective_from < now` (DL-072) |
| `FIN_PRICE_MODEL_INVALID` | VALIDATION | draft price version model vs children (DL-072) |
| `FIN_PRICE_VERSION_OVERLAP` / `FIN_CONTRACT_VERSION_OVERLAP` | CONFLICT | gist 23P01 / one-ACTIVE unique on activate (DL-070) |
| `FIN_CONTRACT_NO_ACTIVE_VERSION` | PRECONDITION | contract header ACTIVE requires exactly one ACTIVE version (DL-072) |

Agent C may add lock-timeout / serialization codes; they must not reuse these strings for other meanings.

---

## 24. A-Q1 — closed

A §17 A-Q1 asked for “exact permitted transition tables for each INTENT status.” This file is that answer.

| Table (A name) | Class | Statuses locked here |
|---|---|---|
| `holds` | INTENT | OPEN / CAPTURED / VOIDED / EXPIRED |
| `purchase_intents` | INTENT | CREATED / PAYMENT_PENDING / PAID / FAILED / CANCELED / REFUNDED |
| `approval_requests` | INTENT | REQUESTED / APPROVED / REJECTED / CANCELED / EXECUTED / EXPIRED |
| `dunning_cases` | INTENT | DL-030 enum |
| `idempotency_keys` | INTENT | IN_FLIGHT / COMPLETED / FAILED |
| `outbox_events` | INTENT | PENDING / PUBLISHED / FAILED / DEAD |
| `reconciliation_runs` | INTENT | DL-032 enum |
| `reconciliation_resolution` | INTENT | DL-033 enum |
| `billing_periods` | INTENT | OPEN / USAGE_CLOSING / USAGE_CLOSED / RATING_CLOSED / INVOICE_DRAFTED / INVOICED / FINAL |
| `facility_reservations` | INTENT | OPEN / CAPTURED / RELEASED / EXPIRED |
| `disputes` | INTENT | OPEN / EVIDENCE_REQUIRED / WON / LOST / CANCELED |
| `accounting_periods` | INTENT | OPEN / SOFT_CLOSED / HARD_CLOSED |
| `invoices` | INTENT→AO | DRAFT / APPROVED / ISSUED / PART_PAID / PAID / VOID / UNCOLLECTIBLE |
| `credit_notes` / `debit_notes` | INTENT→AO | DL-031 enum |
| `vendor_statements` | INTENT→AO | OPEN / FINALIZED |
| `payments` | INTENT | RECEIVED / ALLOCATED / REVERSED |
| `contracts` | MUTABLE | DRAFT / ACTIVE / SUSPENDED / TERMINATED / EXPIRED |
| `contract_versions` | VERSIONED | DL-029 DRAFT / ACTIVE / SUPERSEDED |
| `price_versions` | VERSIONED | DL-069 DRAFT / ACTIVE / SUPERSEDED |
| `credit_facilities` | MUTABLE | PENDING / ACTIVE / PAUSED / SUSPENDED / CLOSED |
| `lots` | MUTABLE | ACTIVE / EXHAUSTED / EXPIRED / FROZEN |

No other INTENT status string is legal. Agent C/D do not add a status; they open a Decision Log row.

---

## 25. Live P0s — scoped, not remediated

Per DL-011 / A §15. This file does not patch `backend/src/**`.

| Finding | What this machine replaces | Implementation stage |
|---|---|---|
| A/B-1 split `usage_events` INSERT / `recordConsumption` | `AuthorizeHold` / `DirectSpend` writes usage (Stage 2) + hold/lots/postings in one tx | Stage 2 + 6 |
| A-2 swallow / no DLQ | denied auth → `authorization_attempts`; ingest fail → `usage_events_dlq`; outbox DEAD is audible | Stage 2 + 6 |
| A-4 `ai_credit_*` second ledger | consume becomes usage + `AuthorizeHold` against `fin.lots` | Stage 6/7 + 13 |
| C-2 lost update | `+occ` on every machine here | Stage 1 |
| E-3 mutable `audit_log` | every `audit=Y` row is `fin.financial_audit_events` INSERT-only | Stage 1 + H |
| B-8 lost notify | every `outbox` column; `notification.lifecycle` | Stage 1 |
| C-1 pricing PATCH throws | not a state machine; Stage 4 admin on `fin.prices` | Stage 4 |

Historical A-3 / D-1 / D-4 stay on the register. Backfill is Stage 13 (`source_system='backfill_v1'`).

---

## 26. OPEN markers (columns A omitted)

| Marker | DL | Ask |
|---|---|---|
| `contract_versions.status` | DL-029 | persist DRAFT/ACTIVE/SUPERSEDED |
| `dunning_cases.status` enum | DL-030 | A left it to B |
| `credit_notes.status` / `debit_notes.status` | DL-031 | A listed `status` without enum |
| `reconciliation_runs.status` | DL-032 | A listed `status` without enum |
| `reconciliation_resolution.status` | DL-033 | A omitted |
| GRANT source without `fin.grants` | DL-034 | always `APPROVAL_REQUEST`; no new table |
| `vendor_statements` unique + no reopen | DL-035 | UNIQUE(vendor_id, period_key, environment) |
| `dunning_cases.controls_snapshot` | DL-036 | JSONB flag snapshot for CURED restore |

`fin.transfer_intents` is **not** invented. `TRANSFER_INTENT` in C is a command-minted UUID stored as `economic_source_id` (A already named the type). If Agent C needs a lockable parent row, they append a DL — they do not get a silent table from B.

---

## 27. Acceptance — real Postgres, same PR as the machine

Posture is A §18: **if a test file name does not appear in the CI `postgres` job summary, it did not run. Counts in this document are not evidence.** No mocked-DB assertions for any row below. Harness is `withTestDb()` (`backend/src/testing/postgres.js`).

| # | File that must appear in the postgres job | Asserts |
|---|---|---|
| B01 | `backend/src/fin/holds/state-machine.test.js` | legal matrix; `HOLD_NOT_OPEN` on capture-after-void; OCC 412; authorize+capture+void each write `financial_audit_events` + outbox in the **same** committed tx; denied authorize still inserts `authorization_attempts` |
| B02 | `backend/src/fin/holds/restore-lots.test.js` | void restores **exact** allocation set (spec §43); remaining_units recomputes from `lot_allocations` |
| B03 | `backend/src/fin/holds/expiry-worker.test.js` | SKIP LOCKED; poisoned hold isolated; `expires_at` in the past only; actor=WORKER |
| B04 | `backend/src/fin/purchase-intents/state-machine.test.js` | full matrix; `UNIQUE(provider, provider_event_id)` second insert is `PURCHASE_PROVIDER_EVENT_REUSED`; FAILED→PENDING retry; partial refund does not flip REFUNDED |
| B05 | `backend/src/fin/approvals/state-machine.test.js` | EXECUTED consumes once; payload mismatch; four-eyes; SYSTEM AUTO grant path (DL-034) |
| B06 | `backend/src/fin/dunning/state-machine.test.js` | no step skip; CURED restores snapshot (DL-036); WRITE_OFF_REVIEW→WRITTEN_OFF needs `WRITE_OFF` |
| B07 | `backend/src/fin/idempotency/state-machine.test.js` | IN_FLIGHT conflict; fingerprint conflict; expired → `IDEMPOTENCY_KEY_EXPIRED` and **no** second FUNDING; COMPLETED replay writes zero ledger rows |
| B08 | `backend/src/fin/outbox/state-machine.test.js` | PENDING→PUBLISHED sets `published_at`; max attempts → DEAD + audit row; DEAD cannot resurrect |
| B09 | `backend/src/fin/reconciliation/run-state-machine.test.js` | one RUNNING per scope; COMPLETED requires all check codes |
| B10 | `backend/src/fin/reconciliation/resolution-state-machine.test.js` | WARN applies without approval; `BLOCK_*` without approval → rejected; APPLIED writes `account_controls` |
| B11 | `backend/src/fin/billing-periods/state-machine.test.js` | forward-only; reopen after ISSUE rejected; draft invoice required for INVOICE_DRAFTED |
| B12 | `backend/src/fin/facilities/reservation-state-machine.test.js` | over-reserve rejected; capture zeros FACILITY_DRAW remaining (with C) |
| B13 | `backend/src/fin/disputes/state-machine.test.js` | LOST reverses payment; WON does not; does not UPDATE `payments` shape (status only) |
| B14 | `backend/src/fin/contracts/state-machine.test.js` | ACTIVE requires an ACTIVE version; TERMINATED/EXPIRED terminal |
| B15 | `backend/src/fin/contracts/version-state-machine.test.js` | gist overlap; two ACTIVE forbidden; component UPDATE on ACTIVE rejected |
| B16 | `backend/src/fin/invoices/state-machine.test.js` | sequence allocated once on ISSUE; VOID keeps number; line UPDATE after ISSUE insufficient privilege; SA missing ZATCA columns rejected |
| B17 | `backend/src/fin/notes/state-machine.test.js` | credit + debit; exceeds invoice rejected; unlinked note rejected |
| B18 | `backend/src/fin/facilities/state-machine.test.js` | CLOSE with OPEN reservation rejected; USER pause needs `FACILITY_OPS` |
| B19 | `backend/src/fin/lots/state-machine.test.js` | remaining only via allocations; EXPIRED cannot return to ACTIVE; FROZEN not drawable |
| B20 | `backend/src/fin/accounting-periods/state-machine.test.js` | OPEN→HARD_CLOSED rejected; HARD_CLOSED insert of `accounting_events` rejected; reopen requires `RECONCILIATION_OVERRIDE` |
| B21 | `backend/src/fin/vendor-statements/state-machine.test.js` | FINALIZE freezes lines; second OPEN for same period rejected |
| B22 | `backend/src/fin/payments/state-machine.test.js` | RECEIVED with remainder stays RECEIVED; REVERSED after allocate moves invoice back |
| B23 | `backend/src/fin/transitions/illegal-matrix.test.js` | property-style: every status × every trigger not in this file returns the named `*_ILLEGAL_TRANSITION` / specific code; 1000 random illegal pairs |

Each file above is created in the **same PR** as the Stage that implements the machine (Stage 1: B07 B08 B09 B20; Stage 4: B14 B15; Stage 6: B01–B03 B19; Stage 7: B04 B13 B22; Stage 8: B06 B12 B18; Stage 10: B11 B16 B17; Stage 11: B21; B05 with Stage 1 foundation; B10 with F; B23 per stage for the machines that landed). No “we'll test later.”
