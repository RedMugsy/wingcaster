# Deliverable E — Idempotency

**Stage:** 0 (§128)
**Owner:** Agent C
**Date:** 2026-08-18
**Status:** Stage 0 design — **no** `backend/src/**` change, **no** migration
**Depends on:** `A_ENTITY_MODEL.md` §4.3 / §12.2 / §12.3, `DECISION_LOG.md` DL-014 / DL-022 / DL-024 / DL-039
**Closes:** A-Q3 **side** (replay vs once-per-source). A-Q3 itself is closed by DL-014 — this file does **not** add a uniqueness column.
**Coordinates:** `C_TRANSACTION_MATRIX.md` had not landed. Economic-command names match `D_CONCURRENCY.md` §4 / A §4.3 shapes.

---

## 0. Why this file exists

Spec §89–§92 are missing in production (audit). The WhatsApp inbound bug (audit D-1) returned `handled: true` for both "already claimed" and "database error". `emitUsageEvent` used `ON CONFLICT DO UPDATE` on facts (audit A §2 P1). Provider retries (Stripe up to 3 days, Meta 24h) will double-apply anything that is not claimed before side effects.

This file is the claim / replay / reject contract for `fin.idempotency_keys`, permanent economic uniqueness (DL-014), `fin.outbox_events`, and inbound provider events. It does not invent tables. It does not silently remediate `claimProcessedMessage` or `webhook_delivery_log`.

---

## 1. Two layers (do not collapse them)

| Layer | Key | Lifetime | Purpose |
|---|---|---|---|
| **Request idempotency** | `fin.idempotency_keys` `(environment, tenant_id, key)` | `expires_at` default 24h (DL-022). Class `IDEMPOTENCY_24H` (DL-024) | HTTP / worker envelope. Survives client retry of the **same** request |
| **Economic uniqueness** | partial unique indexes on `fin.ledger_transactions` (A §4.3 / DL-014) | **never expires** | One `FUNDING`/`HOLD`/… per source. Outlives the 24h key |
| **Provider uniqueness** | `UNIQUE(provider, provider_event_id)` on `fin.payments` and `fin.purchase_intents` (A §8.1, §10.9) | **never expires** (spec §91 / §129 "provider event dedupe expires" is an automatic-reject) | Stripe / PSP / Meta retries of the same event id |
| **Usage uniqueness** | `UNIQUE(environment, source_system, source_event_id, residency_key)` on `fin.usage_events` | **never expires**. `ON CONFLICT DO NOTHING` (DL-009) | Fact ingest. Not a price, not a ledger move |

A `REFUND` of the same invoice can happen twice (partial). Layer 2 therefore does **not** unique `REFUND` / `ADJUSTMENT`. Those exist only at layer 1 (and layer 3 when a PSP refund event is the source).

A-Q3 side: replay of FUNDING-class shapes is "return the existing tx"; replay of REFUND/ADJUSTMENT is "return the stored HTTP response from `idempotency_keys`". That is the whole side. No new column.

---

## 2. `fin.idempotency_keys` life cycle

A §12.2 columns: `id`, `+env`, `+tenant` (nullable for platform-admin), `key`, `request_fingerprint`, `status`, `response_status`, `response_body`, `expires_at`, `+audit +occ`.

### 2.1 Status machine

```
                 INSERT
                   │
                   ▼
              IN_FLIGHT ──────────────────────────► EXPIRED
               │      │                               ▲
               │      ├─ business/HTTP completed ──► COMPLETED ─► EXPIRED
               │      │
               │      └─ tx aborted / crash ───────► FAILED ────► EXPIRED
               │                                         │
               └──── sweeper: lease exceeded ────────────┘
                         FAILED may retry ──► IN_FLIGHT
```

<!-- OPEN: A §12.2 lists status `IN_FLIGHT / COMPLETED / FAILED` only. DL-022 defines expiry as an error, not a fourth status. The Stage 0 brief requires EXPIRED as a terminal state. DL-039 adds `EXPIRED` to the CHECK. Until Stage 1 ships the CHECK, treat `now() >= expires_at` as EXPIRED even if the stored status lags (sweeper is not a precondition for correctness). -->

| From | To | Who | Meaning |
|---|---|---|---|
| (insert) | `IN_FLIGHT` | claim middleware | Key reserved; economic work not committed |
| `IN_FLIGHT` | `COMPLETED` | same `transaction(fn)` as the economic COMMIT | `response_status` + `response_body` stored. Replay is verbatim |
| `IN_FLIGHT` | `FAILED` | same request on thrown/rollback; or sweeper after lease | No economic commit (or unknown after crash). Same fingerprint **may** re-enter `IN_FLIGHT` |
| `IN_FLIGHT` | `EXPIRED` | sweeper when `now() >= expires_at` | No re-execute. No replay |
| `COMPLETED` | `EXPIRED` | sweeper when `now() >= expires_at` | Stored body is **not** replayed after expiry (DL-022: expired → `IDEMPOTENCY_KEY_EXPIRED`, not silent re-execute **and** not a late replay that hides a 24h+ client bug) |
| `FAILED` | `EXPIRED` | sweeper | Same reject |
| `FAILED` | `IN_FLIGHT` | claim middleware, same fingerprint, `now() < expires_at` | Retry of an aborted attempt |
| `COMPLETED` | anything else | **forbidden** | Trigger: `IF OLD.status = 'COMPLETED' AND NEW.status <> 'EXPIRED' THEN RAISE` |
| `EXPIRED` | anything | **forbidden** | Key is dead. Client must mint a new key |

Lease for stuck `IN_FLIGHT`: derive `updated_at + interval '30 seconds'`. No new column. Sweeper (`FIN_IDEMPOTENCY_SWEEP`, D §7) moves leased-out `IN_FLIGHT` → `FAILED` so the client can retry. Until the sweeper runs, a concurrent claim still sees `IN_FLIGHT` and returns 409.

`expires_at` default: `BusinessClock.now() + interval '24 hours'` (DL-022). Not `CURRENT_TIMESTAMP`.

### 2.2 Fingerprint

```
request_fingerprint = SHA-256( JCS({
  method, path, environment, tenant_id,
  canonical_body,          -- parsed JSON, RFC 8785, no header bag
  economic_source_type,    -- when the route binds one
  economic_source_id
}) )
```

Headers are **not** in the fingerprint except the key itself (which is the row's `key`, not hashed in). `Authorization` / `Idempotency-Key` / `If-Match` changes must not create a new fingerprint. Query-string that is part of the resource identity **is** in `path` (normalized).

### 2.3 Claim algorithm (middleware)

Required header on every economic `POST` / `PUT` that creates or finalises value (`FUND`, `AUTHORIZE`, `CAPTURE`, `VOID`, `DIRECT_SPEND`, `REFUND`, `GRANT`, `TRANSFER`, `ADJUSTMENT`, `MIGRATE`, `ISSUE_INVOICE`, `APPLY_PAYMENT`, `FACILITY_*`, dunning force-steps, recon-resolve-with-money). Optional on GET. Forbidden to "make a GET idempotent" by storing a body — GET has no key row.

Platform-admin routes with `tenant_id` NULL use `UNIQUE(environment, tenant_id, key)` — in Postgres, `UNIQUE` treats NULLs as distinct. **Do not rely on that.**

<!-- OPEN: A §12.2 UNIQUE(environment, tenant_id, key) is wrong for platform-admin (NULL tenant). Need a partial unique: UNIQUE(environment, key) WHERE tenant_id IS NULL plus UNIQUE(environment, tenant_id, key) WHERE tenant_id IS NOT NULL. DL-039 records this. Not a new table. -->

Algorithm, inside the same `transaction(fn)` as D §3 E1:

```
1. Require header Idempotency-Key (non-empty, ≤ 256 chars, visible ASCII).
   Missing → 400 IDEMPOTENCY_KEY_REQUIRED
2. fingerprint = hash(request)
3. INSERT (env, tenant_id, key, fingerprint, status='IN_FLIGHT', expires_at)
   ON CONFLICT (env, tenant_id, key) WHERE tenant_id IS NOT NULL
   DO NOTHING
4. SELECT … FROM fin.idempotency_keys
    WHERE environment=$e AND tenant_id IS NOT DISTINCT FROM $t AND key=$k
    FOR UPDATE
5. Branch on the locked row:

   now >= expires_at
     OR status = 'EXPIRED'
       → 409 IDEMPOTENCY_KEY_EXPIRED
         (DL-022: do not re-execute, do not replay COMPLETED body)

   fingerprint <> request_fingerprint
       → 409 IDEMPOTENCY_FINGERPRINT_MISMATCH
         body: { code, existing_key_status }
         no Retry-After

   status = 'COMPLETED'
       → return stored response_status + response_body VERBATIM
         (same HTTP status, same JSON bytes after serialize)
         header Idempotency-Replayed: true

   status = 'IN_FLIGHT'
       → 409 CONFLICT
         code: IDEMPOTENCY_IN_FLIGHT
         Retry-After: 2
         (integer seconds; bump to 5 if updated_at older than 2s)

   status = 'FAILED'
       → UPDATE status='IN_FLIGHT', request_fingerprint stays,
         proceed as a new attempt

   status = 'IN_FLIGHT' AND we just inserted
       → proceed with the command
6. On command success (still in fn):
     UPDATE status='COMPLETED',
            response_status=$n,
            response_body=$json::jsonb
      WHERE id=$id AND status='IN_FLIGHT'
7. On command throw:
     UPDATE status='FAILED'  — only if this fn still owns the tx;
     if the tx is rolling back, the IN_FLIGHT insert rolls back too
     (first-attempt crash = no row). Sweeper handles "committed
     IN_FLIGHT + dead process" (step-6 never ran, process died
     after COMMIT of a forgotten inner tx — must not happen:
     key update and economic writes are one fn).
```

**One transaction.** If the economic `COMMIT` is separate from the key insert, a crash in the gap either loses the key (retry double-applies — layer 2 must save FUNDING-class) or leaves `IN_FLIGHT` forever. REFUND/ADJUSTMENT have no layer 2: they **must** share the transaction with the key. That is non-negotiable.

`response_body` stores the **public** envelope, not internals. No secrets. Size cap 64 KiB; oversize → store `{ code: 'RESPONSE_TRUNCATED', location: <outbox/audit ref> }` and still replay that stub plus the original `response_status`.

OCC: the key row has `+occ`. Middleware uses `FOR UPDATE`, not If-Match. HTTP PATCH of a key is not a public API.

### 2.4 Verbatim replay

COMPLETED replay sets:

- HTTP status = `response_status` (may be 201, 200, 422, …)
- Body = `response_body`
- `ETag` only if the original response had one **and** it is stored inside `response_body` / a reserved `response_headers` object

<!-- OPEN: A §12.2 has `response_status` + `response_body` and no `response_headers`. Location / ETag on a 201 FUND will not replay unless they live inside the JSON body. Do not add a column in this file; Stage 1 puts `Location` in the JSON envelope or Agent A adds `response_headers JSONB`. -->

Do not re-run rating, posting, or outbox insert on replay. Do not emit a second `financial_audit_events` row for the replay itself (the original commit already audited). Access log may record `idempotency_replayed=true`.

---

## 3. Once-per-source-shape vs replay-via-key (DL-014 / A §4.3)

| shape | Unique per source? | Index | HTTP replay |
|---|---|---|---|
| `FUNDING` | yes | `uq_ledger_tx_once_per_source_shape` | Key replay **or** `23505` → load existing tx, return its representation as if COMPLETED |
| `HOLD` | yes | same | same |
| `VOID` | yes | same | same |
| `CAPTURE` | yes | same | same |
| `DIRECT_SPEND` | yes | same | same |
| `EXPIRY` | yes | same | worker: treat unique-violation as "already expired" |
| `GRANT` | yes | same | same |
| `MIGRATE` | yes | same | same |
| `TRANSFER` | yes, **per book** | `uq_ledger_tx_transfer_per_book` `(environment, economic_source_id, book_id)` | Two rows, one `pair_id`. Replay returns both legs |
| `REFUND` | **no** | none | **`idempotency_keys` only** |
| `ADJUSTMENT` | **no** | none | **`idempotency_keys` only** |

`23505` on a once-per-source index during a **first** claim (key was `IN_FLIGHT` we created) means a concurrent command with a **different** idempotency key already committed that source+shape. That is not a fingerprint mismatch. Response: `409 ECONOMIC_SOURCE_CONFLICT` with the existing `ledger_transactions.id`, or — if the existing tx is visible and the request is a true equivalent — return that tx as success and mark **our** key `COMPLETED` with that representation. Equivalent = same `shape`, `economic_source_*`, `book_id` (and `pair_id` for TRANSFER). Not equivalent (e.g. different `reason_code` / amount) → 409, our key → `FAILED`.

Workers (expiry, renewal) mint keys `system:<worker>:<shape>:<source_id>` with `actor_type=WORKER`. They still take a key row so a replica restart does not double-expire while layer 2 is the backstop for EXPIRY.

---

## 4. Outbox semantics

A §12.3: written in the **same** `transaction(fn)` as the economic effect. Replaces `fireAndForgetNotify` (audit B-8).

### 4.1 Delivery

- **At-least-once.** Publisher (`FIN_OUTBOX_PUBLISH`) reads `PENDING`/`FAILED` where `next_retry_at <= now()` `FOR UPDATE SKIP LOCKED` (A §13 index), attempts the sink, then:
  - success → `PUBLISHED`, `published_at = clock` (first success only)
  - retryable fail → `FAILED`, `attempts += 1`, `next_retry_at = clock + backoff(attempts)`, `last_error_code` set
  - `attempts >= 16` or non-retryable → `DEAD`, `last_error_code` set
- Backoff: `min(2^attempts, 3600)` seconds, equal jitter 0.5–1.5×.
- Metric: `wingcaster_outbox_publish_total{topic,result}`. Alarm on `DEAD` increment and on `FAILED` age > 15 min.

At-least-once means a consumer **will** see duplicates. Publisher crash after sink success and before `PUBLISHED` ⇒ another attempt.

### 4.2 `dedupe_key` contract

```
UNIQUE (topic, dedupe_key) WHERE dedupe_key IS NOT NULL
```

| Topic | `dedupe_key` | Why |
|---|---|---|
| `notification.lifecycle` | `notification:<entity_type>:<entity_id>:<transition>` | One email per contract transition |
| `webhook.stripe.outbound` | not used for inbound; outbound to our customers if any | |
| `ledger.transfer.completed` | `pair:<pair_id>` | One fan-out per pair, not per leg |
| `invoice.issued` | `invoice:<invoice_id>` | |
| `usage.dlq_replay` | `dlq:<dlq_row_id>` | |
| `hold.expired` | `hold:<hold_id>:expired` | |

`dedupe_key` NULL is allowed for intentionally many-shot events (e.g. reminder n of a dunning step — then put `dunning:<case_id>:<step_id>` so the step itself is once). Inserting a second row with the same `(topic, dedupe_key)` is a `23505`: the command treats it as "outbox already recorded" and proceeds. It does **not** fail the economic commit.

### 4.3 Consumer-side idempotency (required)

Every consumer of `fin.outbox_events` must be safe under at-least-once:

1. **Prefer** a consumer-local unique on the business id (`pair_id`, `invoice_id`, `hold_id`), not on `outbox_events.id`.
2. If the sink is an HTTP webhook we send, send `Idempotency-Key: <dedupe_key>` and `outbox_id`.
3. If the sink is email, the provider + template + `dedupe_key` must be unique at the provider or we accept a duplicate send and the template must be phrased as a state ("your contract is ACTIVE"), not an increment ("we added 1 credit").
4. Consumers must **not** create `ledger_transactions`. Value movement is not an outbox side effect. An outbox handler that needs money opens a **new** command with its own idempotency key derived from `dedupe_key`.
5. Reading `PUBLISHED` and re-processing is allowed (replay / ops). The consumer unique is the guard.

Outbox rows are INTENT (`+occ`). Publisher uses `FOR UPDATE SKIP LOCKED`, not If-Match. Retention: `OUTBOX_30D` (DL-024).

---

## 5. Webhook-inbound idempotency

Providers retry. Stripe: up to **3 days** (and some events longer). Meta: typically **24 hours**, 5xx/timeout causes retry. TikTok / X / WhatsApp BSP: similar. A 200 that we sent before committing the claim is how D-1 dropped every WhatsApp message and how a 500-then-success double-charges.

### 5.1 `(provider, provider_event_id)` UNIQUE

Already declared:

- `fin.purchase_intents` — `UNIQUE(provider, provider_event_id) WHERE provider_event_id IS NOT NULL` (A §8.1) — **never expires**
- `fin.payments` — `UNIQUE(provider, provider_event_id)` (A §10.9) — **never expires**

Inbound handler contract:

1. Verify signature first. Failure → **401** (or 400), **not** 200. Audit E-10 silent-200 on missing secret is a live P1; new `fin` handlers must not copy it. (Do not patch `server.js` in Stage 0.)
2. Parse `provider` (`STRIPE` / `META` / `WHATSAPP` / …) and `provider_event_id` (Stripe `evt_…`, Meta `X-Hub-Signature` payload id / `entry[].id`+`time` as documented per adapter).
3. **Claim before side effects.** Insert the economic row (`payments` / `purchase_intents`) with that pair, or a no-op claim (see §5.3 OPEN), in a `transaction(fn)`.
4. Duplicate completed claim → **silent 200** with `{ received: true, duplicate: true }`. Do not re-apply. Do not 409 a provider — they will retry for days and page on-call.
5. Duplicate **in-flight** (row exists, status not terminal — e.g. `purchase_intents.PAYMENT_PENDING` being worked by another replica, or an `idempotency_keys` `IN_FLIGHT` for the derived key `wh:<provider>:<provider_event_id>`) → **409** + `Retry-After: 2` to the **provider**. Stripe will retry; that is correct. Do **not** 200 here — 200 would stop retries while we are still applying.
6. After successful apply: 200 `{ received: true, duplicate: false }`.

Derived request key: `wh:<provider>:<provider_event_id>` stored in `fin.idempotency_keys` with `tenant_id` resolved or NULL. Fingerprint includes the provider payload hash. This gives IN_FLIGHT 409 for the window before the `payments` unique row exists.

### 5.2 Silent 200 vs 409 (normative)

| Observed state | HTTP to provider | Body |
|---|---|---|
| New event, applied in this request | 200 | `{ received: true, duplicate: false }` |
| Unique hit, economic row **terminal** (PAID / FAILED / CANCELED / RECEIVED / ALLOCATED / REVERSED as applicable) | **200** | `{ received: true, duplicate: true }` |
| Unique hit or key `IN_FLIGHT`, work not terminal | **409** | `{ code: 'IDEMPOTENCY_IN_FLIGHT' }` + `Retry-After` |
| Fingerprint mismatch on the derived key (same event id, different payload) | **409** `IDEMPOTENCY_FINGERPRINT_MISMATCH` | Do **not** 200 — this is a provider or proxy bug; page |
| Signature fail / missing secret | **401** | no body leak |
| Handler crash after claim, before apply | row `FAILED` / intent not terminal; provider retries; 409 then 200 | layer 2/3 prevent double apply |

**Never** 200 on "we could not parse / could not persist". That is the D-1 / E-10 class.

### 5.3 Non-economic inbound

Many Stripe events (`customer.updated`, `invoice.upcoming`) and Meta retries do not insert `payments` or `purchase_intents`. A did not declare a general inbound-receipt table. `public.webhook_delivery_log` is frozen for new feature writes.

<!-- OPEN: No fin.* inbound receipt table. Non-economic provider events still need UNIQUE(provider, provider_event_id) + silent-200-on-duplicate. Do not invent fin.webhook_inbound_receipts in this file. Options for Agent A (append a reserved name) or Stage 7: (1) claim a reserved table in A §16b; (2) store a zero-amount payments row — rejected, pollutes AR; (3) use idempotency_keys with tenant NULL and never-expire — rejected, DL-022 is 24h and provider retries can exceed 24h. The UNIQUE on payments/intents is sufficient for money events. Non-money events are OPEN until A claims a name. -->

Until that name exists, Stage 7 money paths use §5.1 only. Non-money handlers may persist in `fin.outbox_events` **inbound** topic only if `dedupe_key = 'in:' || provider || ':' || provider_event_id` and the insert is the claim — that stretches outbox into an inbound log. Prefer A claiming a table.

Usage facts use `fin.usage_events` unique (DL-009) with `ON CONFLICT DO NOTHING` — that **is** silent-success, and it never expires. `webhook.received` telemetry is a usage fact, not a payment.

---

## 6. Middleware placement (Stage 1 / 12)

```
authMiddleware
→ requirePlatformAdmin? → requireExplicitPlatformAdmin? → requireElevated()?
  (audit E1: copy platform-templates guard array on every new admin money route)
→ idempotencyMiddleware        — this file; opens transaction(fn) or joins one
→ ifMatchMiddleware            — D §6; PATCH only
→ handler
```

Rate limit on credit grant / bulk / refund is Agent D / H / Stage 12 (audit E-12). Not specified here beyond: a 429 does **not** insert an `IN_FLIGHT` key (limiter runs first). A 401/403 does not insert a key.

Error envelope (spec §109) is not this file's to invent. Codes this file **names** (stable):

| code | HTTP | retryable |
|---|---|---|
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | no |
| `IDEMPOTENCY_KEY_EXPIRED` | 409 | no |
| `IDEMPOTENCY_FINGERPRINT_MISMATCH` | 409 | no |
| `IDEMPOTENCY_IN_FLIGHT` | 409 | yes (`Retry-After`) |
| `ECONOMIC_SOURCE_CONFLICT` | 409 | no |
| `PRECONDITION_FAILED` | 412 | yes (client re-GET) |
| `IF_MATCH_STAR_FORBIDDEN` | 412 | no |
| `IF_MATCH_WEAK_FORBIDDEN` | 412 | no |
| `IF_MATCH_MALFORMED` | 400 | no |
| `PARTITION_DDL_IN_PROGRESS` | 409 | yes |

---

## 7. Acceptance (real Postgres)

Same posture as A §18. **If a test file name does not appear in the CI postgres job summary, it did not run.**

| # | File | Asserts |
|---|---|---|
| E-T1 | `backend/src/fin/idempotency/keys.test.js` | Insert `IN_FLIGHT` → complete → second request same key+fingerprint returns stored `response_status` + `response_body` **byte-identical**. No second `ledger_transactions` row |
| E-T2 | `backend/src/fin/idempotency/in-flight.test.js` | Second request same key while `IN_FLIGHT` → HTTP 409, `Retry-After` present, `code=IDEMPOTENCY_IN_FLIGHT` |
| E-T3 | `backend/src/fin/idempotency/fingerprint.test.js` | **Mismatched fingerprint** on an existing key → 409 `IDEMPOTENCY_FINGERPRINT_MISMATCH`. Status stays `COMPLETED`/`IN_FLIGHT`. No economic write |
| E-T4 | `backend/src/fin/idempotency/expired.test.js` | `expires_at` in the past → 409 `IDEMPOTENCY_KEY_EXPIRED` even if status is still `COMPLETED`. Sweeper flips to `EXPIRED`. New execute does not run |
| E-T5 | `backend/src/fin/idempotency/failed-retry.test.js` | `FAILED` + same fingerprint + not expired → re-enters `IN_FLIGHT` and may execute once |
| E-T6 | `backend/src/fin/idempotency/completed-immutable.test.js` | `UPDATE … SET status='IN_FLIGHT' WHERE status='COMPLETED'` → trigger reject |
| E-T7 | `backend/src/fin/ledger/once-per-source.test.js` | Two FUNDING inserts same `(env, PURCHASE_INTENT, source_id, FUNDING)` → second `23505`. Handler returns existing tx |
| E-T8 | `backend/src/fin/ledger/refund-not-unique.test.js` | Two REFUND txs same invoice, different idempotency keys, both commit. Same key → replay first only |
| E-T9 | `backend/src/fin/outbox/dedupe-key.test.js` | Second insert same `(topic, dedupe_key)` → `23505`; command still COMMITs economic rows |
| E-T10 | `backend/src/fin/outbox/at-least-once.test.js` | Publisher marks PUBLISHED only after sink ok. Crash fixture: sink ok + status still PENDING → second publish; consumer unique prevents double side effect |
| E-T11 | `backend/src/fin/webhooks/provider-unique.test.js` | Two inserts `fin.payments` same `(provider, provider_event_id)` → unique violation. Handler maps to silent 200 `duplicate: true` |
| E-T12 | `backend/src/fin/webhooks/in-flight-409.test.js` | Concurrent inbound same `provider_event_id`: one applies, the other 409 `IDEMPOTENCY_IN_FLIGHT` (not 200) |
| E-T13 | `backend/src/fin/usage/source-dedup.test.js` | `usage_events` conflict `(env, source_system, source_event_id, residency_key)` → `DO NOTHING`, row unchanged (A §18 #1) |

E-T3 is the fingerprint test the Stage 0 brief named explicitly.

---

## 8. What this file will not do

- Will not add a uniqueness column on `ledger_transactions` (DL-014 / A-Q3 closed).
- Will not invent `fin.webhook_inbound_receipts` or `fin.transfer_intents`.
- Will not change `commercial.*` or `public.webhook_delivery_log`.
- Will not patch `events.js` swallow or WhatsApp `claimProcessedMessage`.
- Will not treat expired keys as "forgotten → new execute" (Stripe-shaped). DL-022 is stricter: expired is an error.

---

## 9. Open items

| ID | Item | Owner |
|---|---|---|
| E-OPEN-1 | `EXPIRED` on the status CHECK; split UNIQUE for NULL `tenant_id` | DL-039 / Stage 1 |
| E-OPEN-2 | `response_headers` vs JSON-only replay of `Location`/`ETag` | Agent A column, or Stage 1 envelope |
| E-OPEN-3 | Non-economic inbound receipt table name | Agent A §16b reservation |
| E-OPEN-4 | Bind command "requires key?" flags to `C_TRANSACTION_MATRIX.md` | Agent B / C when C lands |

A-Q3 is **closed** by DL-014. This file closed the replay side only.
