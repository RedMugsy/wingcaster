# Pre-rebuild audit — Wingcaster backend

**Date:** 2026-08-17
**Written by:** Claude Opus 4.7
**For:** the four Cursor agents starting the enterprise billing rebuild
**Purpose:** enterprise-grade risk register before you touch the codebase — findings that must be visible to the rebuild team, not remediated by it

---

## Why this document exists

The transcript preceding this audit surfaces a pattern the codebase has been suffering from silently: **tests exist and tests run are entirely different things**, and the gap gets papered over by counts in documents. Between commit `b9c868d` (CI landed) and commit `85f7537` (CI first went green), the postgres job never once executed. The moment it did, four production bugs surfaced — one of which meant the app couldn't boot at all. Another meant billing telemetry had never persisted a single row since Phase 7a. Another meant every inbound WhatsApp message had been silently dropped as a duplicate.

The rebuild you are starting cannot afford the same posture. **Verify the check runs, not just that it's written.** This document is the risk surface an enterprise-grade team would want visible on day one — not to slow you down, but to make sure you're not building on quicksand.

Scope: `backend/src/`. Frontend is out of scope for this audit — it was covered by RTL + axe in Phases 7f/2 and platform-notifications 5b.

**What this document is NOT:** a remediation list. Where a finding cites a live bug, it is named and the exact file:line is given, but the fix is your call. Some findings are architectural (the rebuild will replace the surface); some are urgent (must land before you start); some are hygiene (log for later).

---

## Severity legend

- **P0** — live bug in production code, blocks trust in the surface. Fix before Stage 0 signs off.
- **P1** — enterprise-grade gap. Must be resolved by end of the affected rebuild stage.
- **P2** — hygiene / documentation / test-debt. Log against the appropriate stage's punch-list.

---


## At-a-glance — P0 register the Cursor agents must see first

Nine P0 findings across the five audits. Two are **historical** (fixed on `main` but the reconciliation still owes evidence). Seven are **live** (present in the tree at the moment this document is written). Read the full audit section for each before touching adjacent code.

| # | Live/Historical | Finding | Section | File:line |
|---|---|---|---|---|
| A/B-1 | LIVE | `emitUsageEvent` splits the `usage_events` INSERT from `recordConsumption` outside any transaction — every metered action can leave the ledger silently out of sync with the audit table | A §2/§3, B §2 | `backend/src/billing/events.js:135, 141-150` |
| A-2 | LIVE | `emitUsageEvent` swallows every DB failure with no metric / DLQ / alarm — this is exactly how the 42P10 partition bug hid for a full phase | A §3 | `backend/src/billing/events.js:153-156` |
| A-3 | HISTORICAL | `commercial.usage_events` has zero rows between Phase 7a and `5fccd71`; not recoverable from `commercial.*` alone — needs reconstruction from `conversation_messages`, `activity_log`, `distributions` | A §4 | fix commit `5fccd71` |
| A-4 | LIVE (doctrine) | `wa_listings.ai_credit_balances` is a second ledger — its consume path never emits into `usage_events` | A §5 | `backend/src/modules/whatsapp-listings/application/credits.js` |
| C-1 | LIVE | Every PATCH under `/api/admin/pricing/*` throws at runtime — 9 call sites in `cities.js`, `zones.js`, `territories.js`, `core-rate-cards.js` use the wrong DAL signature `update(coll, {id}, changes)` | C §1 | `cities.js:83`, `zones.js:81, 104`, `territories.js:134, 141`, `core-rate-cards.js:87, 103, 107` |
| C-2 | LIVE | Read-modify-write is not serialisable anywhere — no version column, no `SELECT … FOR UPDATE`, no `If-Match`; concurrent admin edits silently clobber | C §5 | `backend/src/persistence/postgres-adapter.js:219` (read before `BEGIN` at `:232`) |
| D-1 | HISTORICAL | WhatsApp inbound silently dropped for the entire pre-`5fccd71` window; reconstruction path documented but not executed | D §1 | fix commit `5fccd71`, replay recipe D§Runbook-A |
| D-4 | HISTORICAL | Google Maps budget cap was disabled for the entire Phase 6 window; unbounded spend possible | D §5 | fix commit `c2e6240`; runbook D§Runbook-C |
| E-3 | LIVE | `audit_log` has no DB-level `REVOKE UPDATE, DELETE`, no hash-chain, and `ON DELETE SET NULL` on `agent_id` — actor attribution is destructible; a compromised app role can rewrite history without leaving a trace | E §7, E3 | `backend/src/persistence/migrations/009_audit_activity.sql:3-16` |

The two Audit E P0s (E1 — `POST /api/admin/users/:id/promote` not step-up gated; E2 — `POST /api/admin/audit-log/retention` not step-up gated) were **remediated in the same commit that publishes this audit** (see the 7f/3 scope-completion patch below). `phase-7f3-wiring.test.js` now covers both routes.

---

## Audit A — Billing telemetry (usage_events)

Scope: `commercial.usage_events`, `emitUsageEvent` / `emitUsageEventAsync`, the DAL insert path that persists them, and the `ai_credit_balances` shadow ledger. Reviewed at HEAD (fix commit `5fccd71` is in the tree).

### 1. Inventory — call sites, phase, actionKey

Every `emitUsageEvent(Async)` site currently on `main` (18 total):

| File:line | actionKey | Phase (product) |
|---|---|---|
| `backend/src/server.js:1672` | `listing.created` | Phase 1 legacy (properties CRUD), instrumented in 7a |
| `backend/src/server.js:4273` | `ai.chat.turn` (quantity 2) | Phase 6 (Contact 360 regenerate) |
| `backend/src/server.js:5548` | `publish.meta.instagram` / `publish.meta.facebook` / `publish.linkedin` / `publish.tiktok` / `publish.x.link` / `publish.x.plain` | Phase 5 (distributions) |
| `backend/src/server.js:5937` | `webhook.received` (channel=instagram) | Phase 2 webhooks, instrumented in 7a |
| `backend/src/server.js:6036` | `webhook.received` (channel=facebook) | Phase 2 |
| `backend/src/server.js:6097` | `webhook.received` (channel=tiktok) | Phase 2 |
| `backend/src/server.js:6157` | `webhook.received` (channel=x) | Phase 2 |
| `backend/src/server.js:6452` | `ai.classification` (manual) | Phase 3 (comment inbox) |
| `backend/src/conversations/orchestrator.js:269` | `message.in.*` via `IN_ACTION_KEY[channel]` | Phase 3 |
| `backend/src/conversations/orchestrator.js:279` | `ai.classification` (rules) | Phase 3 |
| `backend/src/conversations/orchestrator.js:759` | `message.out.whatsapp.utility` / `message.out.whatsapp.marketing` (and channel variants) | Phase 3 |
| `backend/src/modules/comment-router/handlers.js:344` | `ai.reply.drafted` | Phase 4 (auto-reply) |
| `backend/src/modules/social-cards/index.js:300` | `render.template.premium` or `render.template.standard` | Phase 5 |
| `backend/src/modules/listings-ai/routes.js:82` | `ai.description.generated` | Phase 5b |
| `backend/src/modules/listings-ai/routes.js:106` | `ai.description.failed` | Phase 5b |

Notable absences (P1 gaps in the telemetry catalog itself, see §3):
- **No emitter for `avm.report`, `score.property.fresh`, `staging.ai_image`, `listing.active_day`**, yet these appear in `QUOTA_KEY_FOR_ACTION` (`events.js:172-185`). Ledger consumption for those quotas is currently dead code.
- **No emitter for `publish.rpa`** despite quota mapping.
- `ai_credit_*` (wa_listings module) never crosses into `usage_events` at all (see §5).

### 2. Post-fix correctness — end-to-end trace

`emitUsageEvent` (`backend/src/billing/events.js:49`) resolves subscription, territory/zone, then calls `resolveEffectivePrice` (`backend/src/billing/pricing/resolver.js:102`) which returns `{ casts_charged, price_minor, cogs_estimate_minor, rate_card_version, cast_value_minor, territory_id, zone_id }`. The event object is built at `events.js:112-134`, with the critical partition-key defense at `events.js:129`:

```js
territory_id: cost.territory_id || territoryId || PLATFORM_TERRITORY_ID,
```

`insert('usage_events', event)` dispatches to the Postgres adapter at `backend/src/persistence/postgres-adapter.js:170`. The table mapping now declares `conflictColumns: ['id', 'territory_id']` (`backend/src/persistence/table-mapper.js:144`). The adapter resolves this at `postgres-adapter.js:195`:

```js
const conflictCols = isLegacy(mapping) ? ['collection', 'id'] : (mapping.conflictColumns || ['id'])
```

Updatable columns exclude the conflict key (`:199`), so `territory_id` cannot be reassigned on conflict — this prevents Postgres from attempting to move a row between partitions, which would fail with `ERROR: new row for relation ... violates partition constraint`. Emitted SQL is:

```sql
INSERT INTO "commercial"."usage_events"
  ("id","tenant_id",...,"territory_id","zone_id","metadata","billing_period","occurred_at",
   "created_at","updated_at","data")
VALUES ($1, $2, ...)
ON CONFLICT ("id", "territory_id")
DO UPDATE SET "tenant_id" = EXCLUDED."tenant_id", ... (every column except id, territory_id)
```

**Verdict: correct.** `(id, territory_id)` matches the PRIMARY KEY declared in migration 031, `territory_id` is guaranteed non-null (either resolved, or `PLATFORM_TERRITORY_ID` at app layer, or the column DEFAULT `__platform__` from migration 036 as belt-and-braces), and the `__platform__` partition is bound (migration 036 lines 43-52). The two integration tests in `backend/src/billing/usage-events-partition.test.js` verify both paths: routed-through-emitter (`:20-46`) and raw SQL with DEFAULT (`:54-82`).

One subtle concern (P2): the ON CONFLICT branch is DO UPDATE, not DO NOTHING. `id` is a fresh UUID per emit, so real conflicts are astronomically unlikely — but if a caller ever supplies an idempotency key as `id`, retries will silently overwrite prior fields (including `occurred_at`, `billing_period`, `price_minor`). For an event-sourced telemetry table this is the wrong semantic; `DO NOTHING` would be correct.

### 3. Silent-failure risk

`events.js:153-156`:

```js
} catch (err) {
  injectedLogger?.error({ err, actionKey, tenantId, country }, 'pricing failure — event NOT persisted')
  return null
}
```

Failures hidden today:
- **Pool / network errors** (`ECONNRESET`, pool exhaustion, PG restart 57P01) — no retry, no DLQ, no metric.
- **Missing partition** — if a territory is materialised in `territories` but its partition DDL never ran (e.g. `ensureUsageEventsPartition` racy on boot, or a territory created directly in SQL), inserts fall to `usage_events_default`; that still works, but explicit `territory_id = <new-code>` with **no partition** raises `23514` and is swallowed.
- **Missing rate-card version** — `resolveEffectivePrice` at `resolver.js:123` calls `getRateCardByVersion(pinnedRateCardVersion)`; if the subscription pins a version that was deleted, this throws and no event is written.
- **`resolveActiveSubscription` throws** — DB blip during subscription lookup kills the event even though a rate-0 telemetry-only write would have been useful.
- **`recordConsumption` throws (`events.js:142`)** — happens AFTER the usage_events INSERT. On failure the outer `catch` swallows, but the usage_events row already committed → ledger drift between `usage_events` and `ledger_entries`. There is no transactional boundary wrapping both writes.
- **Logger not yet wired** — `injectedLogger` is null until `createBillingModule` runs (`billing/index.js:40`). Any emit before that point loses even the error line.

Enterprise-grade posture:
1. **Structured error codes returned to caller** — `{ ok: false, code: 'PRICING_MISS' | 'PARTITION_MISSING' | 'DB_ERROR', err }`. `emitUsageEventAsync` remains fire-and-forget, but callers who want to log/retry can await `emitUsageEvent`.
2. **Dead-letter table** `commercial.usage_events_dlq` (unpartitioned, same shape + `error_code`, `error_message`, `attempts`). A background worker replays.
3. **Metrics**: Prometheus `wingcaster_usage_event_emit_total{result="ok|drop|dlq"}` — a silent drop today is invisible; that is exactly how this bug shipped.
4. **Alarm on drop-rate > 0** for any non-`webhook.received` action, wired to on-call.
5. **Transactional bracket** around `insert('usage_events')` + `recordConsumption` when a `quotaKeyForAction` is present. The DAL already exposes `transaction(fn)` (`postgres-adapter.js:302`).
6. **Bounded in-memory queue with backpressure** in front of the DB — telemetry should never contend with the request-serving pool.

### 4. Historical gap — is it recoverable?

**No, not from application state alone.** Between Phase 7a introduction of `emitUsageEvent` and commit `5fccd71` (2026-08-16), Postgres returned `42P10 "there is no unique or exclusion constraint matching the ON CONFLICT specification"` on every insert attempt; the `catch` at `events.js:153` swallowed it and returned null. The row was never in the DB and never in a queue.

Reconstruction options, ranked by fidelity:

- **HTTP access logs** (nginx/CloudFront/Fly.io/whatever fronts the API) → can attribute `listing.created`, publish actions, contact-360 regenerate, manual reclassify. Route + method + user JWT sub is enough. **Requires log retention ≥ gap window.**
- **`activity_log` table** (`logActivity` calls surround most billable actions in `server.js`) → confirms occurrence, missing cost fields but reconstructable via re-running `resolveEffectivePrice` against the historical rate card version.
- **`conversation_messages`** → every `message.in.*` and `message.out.*` is recoverable by direction + `sent_by_agent_id` + timestamp. This is the largest volume and the highest fidelity source.
- **Meta / X / TikTok webhook receipts** → the source events for `webhook.received`; upstream keeps 7-30 days.
- **WhatsApp BSP invoices** (360dialog / Meta Cloud API) → source of truth for `outbound_whatsapp` category + destination; use for reconciliation.
- **Stripe / HubSpot / Meta Insights** → useful for revenue/CAC reconciliation, not for per-action metering.

Enterprise-grade posture for an irrecoverable telemetry gap on a paid service:
1. **Formal disclosure to the rebuild team and to any billed customers** — RCA doc with start/end timestamps, categories affected, and reconciliation method (or its absence). For SOC2/GDPR-touching orgs this is a documented control failure.
2. **Reconstruction pass** using the `conversation_messages` + `activity_log` + `distributions` tables to backfill `usage_events` rows tagged `metadata.reconstructed_at`, `metadata.source: 'backfill_v1'`, using the rate card version that was active at each event's timestamp. Store the reconstruction script in `backend/scripts/backfill-usage-events.js` for audit.
3. **Financial impact model**: run `mrrByTerritory` and quota-overage calculations against the reconstructed set to size any customer credit or write-down needed.
4. **Credit note anyone who was under-quota'd during the gap** rather than clawback anyone who over-consumed — this is the defensible posture.
5. **Preserve raw evidence** (access logs, webhook receipts) in cold storage for the audit trail. Do not delete until reconciliation ADR is signed off.

### 5. Related surface — `wa_listings.ai_credit_balances`

Confirmed separate ledger, no bridge:

- Tables live in `public` schema, not `commercial` (`backend/src/persistence/table-mapper.js:390-391`).
- Balance/txn CRUD entirely inside `backend/src/modules/whatsapp-listings/application/credits.js` (top-up, reserve, consume, refund flows at `:49`, `:74`, `:94`).
- **Zero `emitUsageEvent` or `usage_events` references anywhere under `modules/whatsapp-listings/`.** A tenant burning 100 AI credits generating listings produces no row in `commercial.usage_events` and no row in `commercial.ledger_entries`.
- Reporting (`admin-routes.js:84-85`) aggregates `ai_credit_transactions` directly.

Enterprise implication: the platform has two disjoint metering systems. Revenue reporting from `commercial.*` misses all wa_listings AI spend; wa_listings' spend is not gated by any billing plan quota; a tenant on the free tier can drain credits with no `casts_charged` accounting. Handover flag is correct — this is a **single-ledger doctrine violation**. Correct posture: retire `ai_credit_*` and have `credits.consume(...)` call `emitUsageEvent({ actionKey: 'ai.description.generated', ... })` + `recordConsumption` against a `wa_listing_ai_credits` quota key, with the balance projected from the ledger.

### Risk register

| Risk | Severity | Evidence | Recommended action |
|---|---|---|---|
| Silent swallow of DB failure — will re-hide the next partition/PK bug the same way | **P0 — live design defect** | `backend/src/billing/events.js:153-156` — no metric, no DLQ, no alarm | Return structured error result; add `usage_event_emit_total{result}` metric; alarm on drop-rate > 0 |
| No transactional bracket between `usage_events` INSERT and `recordConsumption` — ledger drift on partial failure | **P0** | `backend/src/billing/events.js:135` then `:142`, no `transaction(fn)` wrapper | Wrap both writes in `transaction(fn)` from `postgres-adapter.js:302` |
| Historical telemetry gap between Phase 7a rollout and `5fccd71` is unrecoverable from `commercial.*` | **P0** | Fix commit message; `events.js:153` swallow | Reconstruct from `conversation_messages` / `activity_log` / webhook receipts; formal RCA + customer credit note pass |
| `ai_credit_balances` is a second ledger, not funnelled through `usage_events` | **P0 — doctrine violation** | `backend/src/modules/whatsapp-listings/application/credits.js`; zero `emitUsageEvent` refs in module | Retire `ai_credit_*`; route consume via `emitUsageEvent` + `recordConsumption` |
| Quota keys `avm.report`, `score.property.fresh`, `staging.ai_image`, `listing.active_day`, `publish.rpa` mapped but never emitted → dead quota code | **P1** | `backend/src/billing/events.js:172-185` vs. inventory in §1 | Wire emitters at the product surfaces or delete the map entries with a note |
| `ON CONFLICT ... DO UPDATE` on an append-only telemetry table — future idempotency-key reuse will silently overwrite prior facts | **P1** | `backend/src/persistence/postgres-adapter.js:201-203` | For `usage_events` specifically, force `DO NOTHING`; add a mapping flag `conflictBehavior: 'ignore'` |
| `injectedLogger` is null until `createBillingModule` runs → any pre-boot emit silently drops with no log line | **P2** | `backend/src/billing/events.js:26,62,154` | Initialise with `pino` at import time or fall back to `console` unconditionally |
| Pool-exhaustion / DB restart takes down telemetry with no backpressure; contends with request path | **P2** | Same pool for API + telemetry (`postgres-adapter.js:44-65`) | Bounded in-memory queue in front of insert; separate pool for `telemetry` if volume warrants |
| Rate-card version pinned on a subscription can be deleted, killing every subsequent event for that tenant | **P2** | `backend/src/billing/pricing/resolver.js:123-125` throws | Fallback to active rate card + warn; or hard-forbid deletion of a referenced rate-card version |
| Territory-partition race: territory created via SQL without `ensureUsageEventsPartition` → 23514 on insert, silently swallowed | **P2** | `backend/src/billing/pricing/index.js:21` export exists but not enforced | Enforce partition-exists check inside `emitUsageEvent`; alarm; auto-create if missing |

---

## Audit B — Transaction boundaries

Scope: Wingcaster backend at `E:\Projects\WingCaster-restore\backend\src\`.
Baseline: `transaction(fn)` in `backend/src/persistence/postgres-adapter.js` threads a pg client through `findAll/findOne/insert/update/remove/query` via `AsyncLocalStorage` (commit `c2e6240`, Phase 7b.1c/18). Ambient client lookup: `runLogged` line 111 uses `currentTxClient() || getPool()`.

### 1. Custom-client sweep (raw `getPool()` / `new Pool()` / `client.query()` outside `transaction(fn)`)

Every non-test hit was reviewed. Nothing in the production path performs a write against a raw pool client outside `transaction()`.

| File:line | What it does | Verdict |
|---|---|---|
| `backend/src/persistence/postgres-adapter.js:44,47,111,227,310` | The adapter itself. `update()` intentionally opens its own BEGIN when there is no ambient client (line 227). | Correct by design. |
| `backend/src/persistence/migrations/runner.js:42,50,63` | Migration runner — `pool.connect()` for `LOCK TABLE ... IN ACCESS EXCLUSIVE` semantics during boot. | Correct; migrations only. |
| `backend/src/billing/products/renewal-scanner.js:162-172` | Holds one raw pool client for the process lifetime to keep `pg_try_advisory_lock` alive across ticks (`lockClient`). No writes, no transaction escape. | Correct — an advisory lock must survive across many transactions, so it *has* to live on its own client. |
| `backend/src/server.js:820` | `getPool().query('SELECT 1 AS ok')` liveness probe. | Read-only, safe. |
| `backend/src/persistence/{dal,postgres-adapter,tenant-migration,generated-columns,transaction}.test.js`, `backend/src/testing/postgres.js`, `backend/src/modules/whatsapp-listings/tests/pipeline-integration.test.js`, `backend/src/billing/usage-events-partition.test.js`, `backend/src/e2e/*.test.js` | Test infra creates its own pools/admin clients. | Not a shipping concern. |

**Result:** no P0 escape from the ambient-transaction mechanism in shipping code.

### 2. Missing-transaction sweep — sequences that should be atomic but aren't

**P0 — LIVE BUG: `emitUsageEvent` splits a billed write from its ledger consumption.** `backend/src/billing/events.js:112-150`. The function inserts a `usage_events` row and then, only for quota-metered actions, calls `recordConsumption(...)` (which is its own `transaction()`). If the network drops or the ledger insert throws between the two, the tenant is charged in `usage_events` but their quota balance is not debited — invoice reconciliation understates consumption. `emitUsageEventAsync` (line 163) is called fire-and-forget from HTTP handlers, so there is no caller-side compensation either. Enterprise billing cannot ship this way.

```js
await insert('usage_events', event)                    // financial write
// ...
if (quotaKeyForAction && cost.casts_charged > 0 && active?.subscription?.id) {
  await recordConsumption({ ... })                     // separate transaction
}
```

**P1 — subscription state changes without their audit row.** `backend/src/billing/products/lifecycle.js`: `cancelSubscription` (444-488), `expireSubscription` (494-519), `pauseSubscription` (521-549), `markPastDue` (616-640), `resolvePastDue` (646-670). Each does a raw `query('UPDATE commercial.billing_subscriptions SET status = ...')` and then calls `recordEvent()` to append to `billing_subscription_history`. If `recordEvent` throws (or the process dies between the two `await`s), the row-of-truth for a subscription changed with no audit-log entry — legally significant. Contrast the correctly-wrapped `createSubscription` (248), `endTrial` (335), `renewSubscription` (397), `resumeSubscription` (579), and `migrateSubscription` (764).

**P1 — `consumeRecoveryToken` attempts counter is TOCTOU-racy.** `backend/src/server.js:868-907`. Reads the token via `findOne`, then does an `update()` to bump `attempts`. No row lock, no transaction. Two concurrent redemptions can both observe `attempts = N` and both write `N+1` (each update is atomic but they clobber). The `max_attempts` lockout is defeated under parallel attack. Compare `redeemChallenge` in `backend/src/auth-2fa.js:178-276`, which correctly uses `SELECT ... FOR UPDATE` inside `transaction(async (client) => ...)`. Auth surface, so P1.

**P1 — `issueRecoveryToken` revoke-then-insert not atomic.** `backend/src/server.js:835-866`. Bulk-revokes old issued tokens, then inserts the new record. On insert failure the user is locked out of the recovery flow (old token revoked, no new token) until a support intervention.

**P1 — `createTerritory` / `updateTerritory` span schemas without a transaction.** `backend/src/billing/pricing/territories.js:76-113` inserts into `public.territories` (row #1), then into `commercial_territories` (row #2), then best-effort creates a partition. Line 116-143 mirrors the pattern for updates. Territory rows carry pricing multipliers and VAT — enterprise billing correctness. Financial surface, P1.

```js
await insert('territories', pub)
// ...
await insert('commercial_territories', commRow)
// ...
await ensureUsageEventsPartition(pub.id, code).catch(() => {})
```

**P1 — `deleteContactData` is not atomic across 10 tables.** `backend/src/server.js:3620-3634`. GDPR right-to-erasure endpoint (`DELETE /api/contacts/:id`, line 3636). Ten sequential `remove()` calls across `conversation_messages`, `conversations`, `inquiries`, `viewings`, `tasks`, `opportunities`, `contact_notes`, `campaign_enrollments`, `campaign_messages`, `contacts`. Partial failure leaves an orphan graph that no longer satisfies the erasure guarantee promised to the caller.

**P1 — `issueUserOtp` remove+insert+sendOtp not wrapped.** `backend/src/server.js:1373-1389`. Remove pending, insert new, then external `sendOtp`. If insert fails after remove, the user has nothing pending; if `sendOtp` fails after insert, an OTP row with no delivery sits in the table. Recoverable by re-request but no idempotency guard.

**P2 — `createChallenge` DELETE+INSERT not atomic.** `backend/src/auth-2fa.js:125-146`. Nested inside `redeemChallenge` (which does open a transaction) it's fine, but standalone callers like `/api/auth/step-up` (line 514-556) hit it unwrapped. Impact is a fleeting race where the user's previous challenge is gone but the new one isn't yet.

**P2 — `PUT /api/properties/:id` updates two tables outside a transaction.** `backend/src/server.js:1697-1699`. Updates `canonical_properties` then `properties`. Partial failure leaves visibility flags out of sync with the property row.

### 3. Cross-schema transactions

The codebase uses cross-schema transactions extensively and — where they exist — correctly. Postgres supports this within a single connection and the current ambient-client machinery makes it work end-to-end. Confirmed successful multi-schema transactions:

- `backend/src/identity.js:35-146` — `users` + `agents` + `tenants` + `tenant_memberships` (all `public`).
- `backend/src/auth-2fa.js:367-391, 421-471` — `users` + `user_backup_codes` + `auth_challenges` (all `public`).
- `backend/src/billing/products/lifecycle.js:248, 335, 397, 579, 764` — `commercial.billing_subscriptions` + `commercial.ledger_entries` + `commercial.billing_credit_notes` + `commercial.billing_subscription_history`.
- `backend/src/modules/property-valuation/application/recalculation-job-service.js:150-173` — `market_pricing.recalculation_jobs` under `FOR UPDATE SKIP LOCKED`; correct claim-worker pattern.

**The one violation is `createTerritory` / `updateTerritory` (`backend/src/billing/pricing/territories.js`)** which spans `public` and `commercial` without a transaction. See §2, P1.

No transaction spans schemas that are on separate databases — everything is one Postgres instance. Should the rebuild ever put `market_pricing` or `area_intelligence` on a separate database (read replica, warehouse tier), every current cross-schema transaction breaks silently.

### 4. Test coverage of the `transaction()` invariant

File: `backend/src/persistence/transaction.test.js` (143 lines, 4 tests).

Covered:

1. `insert()` inside `transaction()` rolls back on throw (lines 12-49). Verifies from an independent pool.
2. `insert()` + `update()` inside `transaction()` commit together (51-79).
3. Nested `transaction()` reuses the outer client, no BEGIN-on-BEGIN error (81-114).
4. Raw `query()` inside `transaction()` sees writes from `insert()` — read-your-own-writes (116-142).

Not covered:

- **`remove()` under a transaction.** No test proves a nested `remove()` is scoped to the ambient client. It uses the same `runLogged()` path so it works by inspection, but the invariant is not test-enforced.
- **`update()`'s own BEGIN/COMMIT branch.** `postgres-adapter.js:227-274` opens a transaction when there is *no* ambient client (multi-row update atomicity). No test exercises that branch failing mid-way. A regression that broke it would only surface as silent partial updates.
- **`update()` throwing mid-loop inside an ambient transaction** (updater fn throws on row 3 of 5). Nothing proves the outer rollback catches it.
- **AsyncLocalStorage leakage across concurrent transactions.** No test starts two `transaction()` calls interleaved on different async paths and asserts each sees only its own client. If `txStorage.run(...)` ever regresses to a global, only concurrency exposes it.
- **`findAll()` read-your-own-writes.** The RYOW test uses raw `query()`; `findAll` isn't asserted to see uncommitted writes.
- **Connection release on nested-transaction throw** — that the outer client is released and the pool isn't leaked when an inner throw propagates.

`backend/src/persistence/postgres-adapter.test.js:131-137` and `backend/src/persistence/dal.test.js:120-134` cover happy-path `transaction()` at a smoke-test level, not the ALS invariant.

### 5. Sagas / distributed-transaction shape

Every place where an external side effect could survive a rollback (or the rollback of the outer transaction leaves the side effect in place with no compensation):

- **Post-commit notifications for lifecycle events** — `backend/src/billing/products/lifecycle.js:310-314`. `fireAndForgetNotify` runs *after* the transaction commits, so state is safe, but an in-process crash between commit and dispatch drops the notification permanently (no persisted intent-to-send). Enterprise: promote to a **transactional outbox** — write a `notification_outbox` row inside the same `transaction()`, worker drains it with at-least-once retries.
- **Notification dispatcher does not retry** — `backend/src/billing/notifications/dispatcher.js:49-138`. Writes `notification_events`, attempts each channel inline, records `notification_deliveries` outcome. On `failed`, the row is marked and never revisited. No retry worker sweeps deliveries. Enterprise: retry with backoff and DLQ.
- **Bannerbear render → DB write → usage event** — `backend/src/modules/social-cards/index.js:286-307`. `renderSocialCardMatrix()` calls the paid Bannerbear API, *then* `insert('social_cards', ...)`, *then* `emitUsageEventAsync`. Bannerbear-side render is already billed to Wingcaster; if the insert throws, Wingcaster has paid Bannerbear and cannot bill the tenant. And `emitUsageEventAsync` has its own P0 gap (§2). Enterprise: use Bannerbear webhook + idempotency key; reserve a `render_reservation` row *before* the API call, mark it `paid` on webhook.
- **WhatsApp publish pipeline** — `backend/src/modules/whatsapp-listings/application/pipeline.js:449-501`. Sequence: `sessions.transition(PUBLISHING)` (DB), `adapter.createListing/updateListing` (DB), `updateModule(DRAFTS, ..., PUBLISHED)` (DB), `publishToSocial` which inserts a `distributions` row in state `pending_retry` (correct outbox shape), then `sendWhatsAppReply` (external). If the WhatsApp reply fails, the DB state is already committed — user got no confirmation but their listing is live. Acceptable; the `pending_retry` distributions table *is* the outbox for social. The confirmation reply itself has no retry.
- **Comment router handlers** — `backend/src/modules/comment-router/handlers.js:33-42, 82-91`. `orchestrator.sendOutboundMessage()` (external Meta/TikTok/WhatsApp call, which itself commits DB rows on success) then `outcomes` are appended and eventually persisted via `recordRoutingOutcome` in `router.js`. If the routing insert fails after the external send, we've sent a reply we can't audit. Rare, but audit trails matter for compliance.
- **Recovery-token email** — `backend/src/server.js:835-866` issues the token row, an outer handler mails it. Rollback of the caller after email send would strand a valid-looking token in the user's inbox. Not currently reproducible under §2's fix, but the shape is fragile.
- **Consumer notifications *do* have a retry table** — `consumer_notification_retries` (server.js:2967-3040) — but it is ad-hoc and does not generalise to the platform-notifications rebuild.

### Risk register

| # | Risk | Severity | Evidence | Recommended action |
|---|---|---|---|---|
| 1 | Usage event billed but never debited from tenant ledger | **P0 — LIVE BUG** | `backend/src/billing/events.js:135, 141-150` — `insert('usage_events')` then separate `recordConsumption()` outside any wrapping transaction; `emitUsageEventAsync` is fire-and-forget | Wrap the pair in one `transaction()`; make the fire-and-forget path idempotent (insert-once via `source_event_id`); add invoice-time reconciliation assertion (usage rows must have matching ledger consumption or an explicit "unmetered" flag). |
| 2 | Subscription status change with no audit row | P1 | `lifecycle.js` `cancelSubscription:444`, `expireSubscription:494`, `pauseSubscription:521`, `markPastDue:616`, `resolvePastDue:646` — raw `query('UPDATE ...')` then `recordEvent()` without `transaction()` | Wrap each state-transition action in `transaction()` matching the pattern already used by `createSubscription`, `endTrial`, `renewSubscription`, `resumeSubscription`, `migrateSubscription`. |
| 3 | Recovery-token lockout defeated under concurrent redemption | P1 | `server.js:868-907` `consumeRecoveryToken` reads then updates `attempts` without row lock | Rewrite in the shape of `auth-2fa.js` `redeemChallenge` — `transaction()` + `SELECT ... FOR UPDATE`. |
| 4 | Recovery-token issuance can leave user locked out | P1 | `server.js:842-864` revoke-then-insert not wrapped | Wrap `revoke old` + `insert new` in one `transaction()`. |
| 5 | Territory row orphaned across `public` / `commercial` on partial failure | P1 | `billing/pricing/territories.js:76-113, 116-143` — cross-schema writes without transaction | Wrap in `transaction()`; partition creation can stay outside (advisory). |
| 6 | GDPR right-to-erasure partial deletion | P1 | `server.js:3620-3634` `deleteContactData` — 10 sequential `remove()` calls unwrapped | Wrap the whole function in `transaction()`. |
| 7 | OTP issuance atomicity + no idempotency on transport failure | P1 | `server.js:1373-1389` `issueUserOtp` | Wrap remove+insert in `transaction()`; if `sendOtp` throws after commit, mark the row `undeliverable` so it isn't returned to the redeem path. |
| 8 | Lifecycle notifications lost on crash between commit and dispatch | P1 | `lifecycle.js:310` `fireAndForgetNotify`; `billing/notifications/dispatcher.js` has no retry sweeper | Adopt **transactional outbox** — write a `notification_outbox` row inside the same lifecycle transaction; separate worker drains with at-least-once retries and dead-letter. This also unblocks Stripe/webhook fan-out for the billing rebuild. |
| 9 | Bannerbear paid render lost on DB insert failure | P1 | `modules/social-cards/index.js:286-307` — external render then `insert('social_cards')` then `emitUsageEventAsync` | Reserve a `social_card_render` row *before* calling Bannerbear (idempotency key = row id). Bannerbear webhook completes the row. Usage event fires on webhook, not on the sync path. |
| 10 | Notification deliveries never retried after failure | P1 | `billing/notifications/dispatcher.js:127-138` — `markFailed` and stop | Add a delivery-retry worker (scheduler already exists in `renewal-scanner.js` as the advisory-lock pattern to copy). |
| 11 | Cross-schema writes assume one Postgres — will break silently on split | P2 | Every `transaction()` today spans `public` and `commercial` (identity.js, auth-2fa.js, lifecycle.js) | For enterprise: define a schema-locality policy or introduce a saga layer before splitting DBs. Document that current `transaction()` is single-connection-only. |
| 12 | `createChallenge` DELETE+INSERT not atomic | P2 | `auth-2fa.js:140-144`, called by `/api/auth/step-up` unwrapped | Wrap in `transaction()`. |
| 13 | Property + canonical update not atomic | P2 | `server.js:1697-1699` | Wrap in `transaction()`. |
| 14 | Test coverage gap: `remove()`, `update()`'s own BEGIN branch, ALS concurrency isolation, connection release on nested throw | P2 | `persistence/transaction.test.js` — 4 tests, listed §4 | Add: (a) rollback-scopes-remove, (b) update() opens+commits its own BEGIN when no ambient, (c) two concurrent `transaction()` invocations see isolated ambient clients, (d) client is released on nested throw, (e) `update()`'s inner loop failure rolls back parent. |

### One-line recommendations for the rebuild team

- Ban `insert()` + `update()` / `insert()` + `recordConsumption()` in the same function unless wrapped in `transaction()`. Add an ESLint custom rule if practical.
- Introduce a `notification_outbox` and `webhook_outbox` collection before wiring Stripe. Every billing state transition writes to the outbox in the same transaction; a scheduler (mirror of `renewal-scanner.js`'s advisory-lock pattern) drains at least once with idempotency keys.
- For paid external calls (Bannerbear, Stripe, WhatsApp templates), reserve a DB row *before* the API call and use its id as the provider idempotency key.
- Document that `transaction()` is single-database-single-connection. If the rebuild plans to split databases, put a saga coordinator on the roadmap now, not after.

---

## Audit C — DAL `update()` semantics

Scope: every `update('collection', ...)` call site under `backend/src/`, checked against the DAL contract in `backend/src/persistence/postgres-adapter.js` (`update`, lines 215-277) and the column mapper in `backend/src/persistence/table-mapper.js`.

Post-fix `2b94047`, the DAL only writes columns actually present on the updater's returned record (`c in row`, adapter line 249). That correctly closes the "NULL over DEFAULT" hole for the common `(coll, filter-fn, updater-fn) => ({ ...current, ...patch })` shape. But it does NOT close five other holes that this audit surfaces below.

---

### 1. Full sweep of `update()` shapes

**Signature the DAL actually implements:** `update(collection, filterFn, updaterFn)` — `filterFn` is passed to `Array.prototype.filter` inside `findAll` (adapter line 219, plus `postgres-adapter.js` `findAll` line 163: `return filter ? items.filter(filter) : items`). Both arguments MUST be functions.

**Shape distribution across the 123 sites** (grep summary):

| Shape | Count | Safe? |
|---|---|---|
| `(x) => ({ ...x, …patch })` — inline spread of the record | ~85 | Yes |
| `() => next` with `next = { ...existing, …patch }` built above | 10 | Yes (checked all 10) |
| `() => row` — deliberate full replacement, `row` enumerates every column | 3 | Yes (`closed-transactions.js:153`, `role-routes.js:76`, `admin-routes.js:285`, all preceded by an explicit rebuild) |
| `(coll, {id}, changesObject)` — **wrong signature, argument is not a function** | 12 | **NO — throws at runtime, P0 LIVE BUG** |

**No `filterFn(existing)` returned an object that dropped a mapped column silently.** Every `() => next` block was preceded by `const next = { ...record, ... }`, so mapped columns not touched by the patch are re-supplied unchanged. Spread source in each was the correct record.

**But one entire family of writes is broken:**

### P0 — LIVE BUG: pricing admin PATCH/POST endpoints all throw

Files (all in `backend/src/billing/pricing/`):

- `cities.js:83` — `await update('pricing_cities', { id }, changes)`
- `cities.js` — inherited by `updateCity`, `deactivateCity`, `assignCitiesToZone`
- `zones.js:81` — `await update('pricing_zones', { id }, changes)`
- `zones.js:104` — `await update('pricing_zones', { id: r.id }, { is_default: false, updated_at: … })` (inside `ensureSingleDefault`)
- `territories.js:134` — `await update('commercial_territories', { id }, changes)`
- `territories.js:141` — `await update('territories', { id }, pubChanges)`
- `core-rate-cards.js:87` — `await update('core_rate_cards', { id }, changes)`
- `core-rate-cards.js:103` — `await update('core_rate_cards', { id: active.id }, { is_active: false, … })`
- `core-rate-cards.js:107` — `await update('core_rate_cards', { id }, { is_active: true, … })`

Every one of these passes an OBJECT literal where the DAL expects a filter FUNCTION. At runtime, `items.filter({ id: 'xxx' })` throws `TypeError: … is not a function` inside `findAll`, and the `updater` object is never even reached. The routes that exercise these (`registerPricingRoutes` mounted from `billing/index.js:68`, routes defined in `billing/pricing/routes.js:58, 67, 107, 147, 188` etc.) are effectively **dead PATCH endpoints**:

- `PATCH /api/admin/pricing/rate-cards/:id`
- `POST /api/admin/pricing/rate-cards/:id/activate`
- `PATCH /api/admin/pricing/territories/:id`
- `PATCH /api/admin/pricing/zones/:id`
- `PATCH /api/admin/pricing/cities/:id`
- `POST /api/admin/pricing/cities/bulk-assign-zone`
- `DELETE /api/admin/pricing/{territories,zones,cities}/:id` (they call the same update functions to soft-deactivate)

`phase-7f3-wiring.test.js:115-149` only verifies these routes reject un-elevated requests. It never exercises a successful update path, which is why this went unnoticed. **Every admin operation on Territories, Zones, Cities, and Core Rate Cards is broken in production today.** This is directly the surface area the enterprise billing rebuild is about to inherit.

### 2. Multi-hop `next` construction — anything that drops or staleness

Reviewed the 10 `() => next` sites plus the ~15 nontrivial function-body updaters. All correctly:

1. Spread from the record read within the same request (not a captured older snapshot from a prior handler).
2. Compute `updated_at` fresh (`nowIso()` / `new Date().toISOString()`) rather than trusting `patch.updated_at`.
3. Do not accidentally drop `data`. (`data` is stripped by `fromRow`, line 678, and re-generated by `toRow`, line 652; callers cannot cause data-JSONB loss through `next` since `toRow` sets `data: item` unconditionally.)

**One subtle sharp edge, not a bug:** `admin-routes.js:283` writes `data: { ...existing.data, ...(req.body.data || {}) }`. `existing.data` is always `undefined` post-`fromRow`, and the whole thing is overwritten by `toRow`'s `data: item` on the way out. The write does nothing. Cosmetic, but confusing to a rebuild reader.

### 3. Untyped-column risk — columns callers use that are NOT in `TABLE_MAP`

The DAL's `toRow` (`table-mapper.js:649`) puts anything not enumerated in `mapping.columns` into the `data` JSONB blob. `fromRow` merges it back on read (`{ ...data, ...row }`, line 677), so the JS surface still sees it — but no SQL query, index, foreign key, or migration constraint can touch it. Concrete drift found:

| Collection | Fields written but NOT mapped → silently in JSONB |
|---|---|
| `campaigns` | `description`, `tags_filter`, `target_channel`, `created_by` |
| `message_templates` | `usage_count` |
| `opportunities` | `notes` |
| `saved_searches` | `user_id`, `alert_enabled`, `alert_channel`, `alert_frequency`, `last_alert_run_at`, `last_match_count` (mapper's `agent_id` is used as `user_id` by callers — divergent naming) |
| `tasks` | `completed_by` |
| `inquiries` | `first_response_at`, `assigned_to`, `lost_reason`, `closed_at`, `stage` (mapper has `stage` — actually mapped; others not) |
| `auth_recovery_tokens` | `revoked_at`, `revoked_reason`, `expired_at`, `blocked_at`, `last_attempt_at`, `used_at`, `used_meta`, `max_attempts`, `issued_ip`, `issued_user_agent` |
| `conversations` | `ai_watching`, `ai_watch_started_at` |
| `conversation_messages` | `category`, `sentiment`, `category_confidence`, `category_source`, `category_matched_rule`, `category_updated_at`, `is_hidden`, `hidden_reason`, `hidden_at` |
| `distributions` | `engagement_counts` |
| `profile_followers` | `entity_type`, `entity_id`, `status`, `followed_at` (mapper only has `follower_id`, `following_id` — **entire feature lives in JSONB**) |
| `consumer_automation_checkpoints` | `checkpoints`, `last_run_at` (mapper has `checkpoint_type`, `last_evaluated_at`, `cursor` — **mapper is out-of-sync with actual usage; every mapped column stays NULL**) |
| `properties` | `views`, `clicks`, `last_synced_at`, `photos`, `amenities`, `ungroup_override` (last one written to `canonical_properties` at `server.js:1697`) |
| `agents` | `rating`, `review_count`, `agency_name` |

**P1 — Silent JSONB drift.** For most enterprise billing/reporting use cases, hidden JSONB fields are hostile: they can't be indexed cheaply, can't be constrained, and admin SQL joins simply return NULL. The mapper needs a formal audit + backfill migration before rebuild.

**P1 — Two "phantom mappings" where the mapper columns are entirely unused:** `profile_followers` and `consumer_automation_checkpoints`. Every DB row has NULL in the mapped columns and the real state hidden in `data`. This will confuse any reporting query.

### 4. Patch semantics — what the codebase actually does

The dominant pattern (`{ ...current, ...patch }` with an `allowed = [...]` whitelist) is a **field-mask update** — closer to JSON Merge Patch (RFC 7396) but without the `null = delete` semantic. There is no code that treats explicit `null` differently from "field not present": both write the value through. That means an API client sending `{"phone": null}` DOES clear the phone (correct RFC 7396), while `{}` leaves it alone (correct RFC 7396). Callers that don't want that must gate on `patch.phone !== undefined` — most do (`campaigns.js:205`, `tasks.js:90`, `opportunities.js:121`), but `identity.js:151-158` (`updateUser`) does NOT — it splats the entire patch, so `updateUser(id, { role: null })` will write NULL over the role. **P2 — inconsistent PATCH discipline.**

No endpoint documents or advertises Merge-Patch semantics in its content-type or OpenAPI; clients cannot tell whether `null` means "clear" or "no-op" from the outside. This is fine at MVP; unacceptable at enterprise billing scale.

### 5. Concurrent-update / lost-write risk

**P0 — Lost updates by design across every `update()` call.** `postgres-adapter.js:219` reads the record via `findAll` **before** `BEGIN` (line 232). Two concurrent admins editing the same product / territory / template each read the same snapshot, each spread `{ ...current, ...their-patch }`, and the second commit clobbers the first's fields — because the second's `current` snapshot didn't include the first's changes.

There is NO version column, NO `SELECT ... FOR UPDATE`, NO ETag / `If-Match` header, NO `updated_at` guard in the `WHERE` clause anywhere in the codebase. Every write is `UPDATE … WHERE id = $n` (adapter lines 257-265).

Impact scenarios that will hit enterprise billing:
- Two ops admins editing the same `billing_products` row: last-write-wins silently drops entitlements changes.
- A pricing edit and a status toggle on the same `commercial_territories` row: one gets overwritten.
- Rate-card activation racing a rate-card metadata edit: activation flag can be reverted.

---

### Risk register

| # | Risk | Severity | Evidence | Recommended action |
|---|---|---|---|---|
| C1 | Pricing admin update() calls use wrong signature; every PATCH throws | **P0 — LIVE BUG** | `cities.js:83`, `zones.js:81, 104`, `territories.js:134, 141`, `core-rate-cards.js:87, 103, 107` | Rewrite each to `update(coll, r => r.id === id, r => ({ ...r, ...changes }))` OR add an overload in `postgres-adapter.js:update` that accepts `(filter: object, changes: object)`. Add integration tests that actually exercise a successful update path. |
| C2 | Read-modify-write is not serializable; concurrent updates silently clobber each other | **P0** | `postgres-adapter.js:219` reads before `BEGIN` at line 232; no version/etag/`FOR UPDATE` anywhere | Add optimistic-concurrency column (`version bigint` or `row_version uuid`) to every mutable table, include it in the `UPDATE ... WHERE id = $n AND version = $m` clause, return 409 on mismatch. Expose as `If-Match: "<etag>"` on PATCH endpoints. |
| C3 | 14+ tables have caller-written fields that don't exist in `TABLE_MAP` — silently JSONB | **P1** | See table above | Audit each mapping against actual writer sites; add real columns + migrations for fields used in filters, sorts, or reports; keep only truly free-form fields in `data`. |
| C4 | Two mappings (`profile_followers`, `consumer_automation_checkpoints`) are fully out of sync — mapped columns are NULL in every row | **P1** | `platformModel.js:347`, `server.js:3078-3096` vs. `table-mapper.js:355, 399` | Either fix the mapping to match reality OR migrate the JSONB back into typed columns. Do NOT leave for enterprise. |
| C5 | `identity.js:151` `updateUser` splats caller-supplied patch without whitelist — allows callers to clobber mapped columns via explicit `null` | **P2** | `identity.js:151-158` | Add an `allowed` whitelist matching the other updaters in the codebase, OR document JSON Merge Patch semantics globally. |
| C6 | Patch semantics vary by endpoint (whitelist vs. splat vs. deliberate full replace); no header/content-type advertises which | **P2** | `campaigns.js:205` (whitelist) vs. `identity.js:151` (splat) vs. `closed-transactions.js:153` (full replace) | Standardise on one pattern per endpoint class; document with `Content-Type: application/merge-patch+json` (RFC 7396) where applicable; consider RFC 6902 (JSON Patch) for the billing admin surfaces that need atomic array edits (rate-card `rates`, product `entitlements`). |
| C7 | `admin-routes.js:283` `data: { ...existing.data, ...(req.body.data || {}) }` is a no-op — `existing.data` is always undefined post-`fromRow`, and `toRow` overwrites it | P3 (cosmetic) | `modules/property-valuation/interface/admin-routes.js:283` | Delete the line; add a lint rule that flags writes to a `data` field on hydrated records. |

### Enterprise-grade patch recommendations

1. **Adopt RFC 7396 (JSON Merge Patch) as the default** for admin PATCH endpoints. Advertise via `Content-Type: application/merge-patch+json`. `null` means clear, absent means leave-alone. Requires: every updater must discriminate `undefined` from `null` (most already do; `identity.js:updateUser` doesn't).
2. **Adopt RFC 6902 (JSON Patch)** for surfaces that need atomic list-element edits — specifically `billing_products.entitlements`, `billing_product_tiers.quotas`, `core_rate_cards.rates`. Merge Patch cannot express "add one entitlement without resending the whole map"; enterprise ops teams will demand this.
3. **Optimistic concurrency**: add `version bigint NOT NULL DEFAULT 1` to every table that is human-editable from the admin console (products, tiers, territories, zones, cities, rate cards, message templates, tenants, subscriptions). Bump in a trigger. Expose as strong `ETag` on GET; require `If-Match` on PATCH; return 412 Precondition Failed on mismatch (or 409 Conflict with the current server representation).
4. **Move read-modify-write inside the transaction**: rework `postgres-adapter.js:update` so the `SELECT` happens under `SELECT … FOR UPDATE` inside the same `BEGIN`. Even without ETags this eliminates the same-process race.
5. **Kill the JSONB fallback** (`legacy_collections`) for anything the billing rebuild touches. Every "silently in JSONB" column above is a future migration cost and a reporting blind spot.

---

## Audit D — Phase 1-6 legacy + WhatsApp dedup fallout

Scope: Phase 1 (auth/listings) through Phase 6 (area-intelligence, property-valuation → Google). Enterprise-billing rebuild starts ~T+6h.

---

### 1. WhatsApp inbound fallout (Phase 4.6)

**Bug**: `backend/src/modules/whatsapp-listings/infrastructure/db.js:61-79` (`claimProcessedMessage`). Fixed in `5fccd71`. The DAL's `query()` resolves to a rows array, not a pg result object; pre-fix code read `result.rows` / `result.rowCount` — both `undefined` — so every message returned `{ claimed: false }`, which `webhook.js:68-70` treats as "already deduped" (returns `handled: true, reason: 'deduplicated'`). Because the module reports `handled: true`, the top-level `POST /api/webhooks/whatsapp` at `server.js:5710-5711` also short-circuits (`if (moduleHandled) continue`). Neither `pipeline.ingest` nor the orchestrator's `ingestInboundMessage` ran. No `conversation_messages` row, no classifier, no router, no `activity_log` type `whatsapp_inbound_message`.

**Reconstruction paths** (fidelity order):
1. `wa_listings.processed_messages` (`011_wa_listings.sql`, mapped `table-mapper.js:409`). The INSERT executed server-side, so rows for every distinct `message_id` exist. Anti-join against `wa_listings.sessions/drafts` isolates dropped messages.
2. `public.webhook_delivery_log` (`032_webhook_delivery_log.sql`, provider `'whatsapp'`) — written at `server.js:5681` via the **correct** `claimWebhookDelivery()` at `server.js:5632-5642` (`rows.length === 1`). Corroborating.
3. Meta Graph API webhook delivery log — Meta retains ~30 days per app in the developer console.

**Tenant-visible lies**: none — no ack, no receipt UI, no notification was ever surfaced. Silent from the tenant side; only ops could have noticed empty `sessions`.

**Posture**: reconstruct drop list from the anti-join, notify affected tenants via a dedicated `platform-notifications` template, disclose the outage window. Replay must not double-charge (see §4).

---

### 2. Other inbound paths — same bug?

**No.** Facebook Messenger, Instagram DM/comment, TikTok, X, SMS, email all dedup via `claimWebhookDelivery(provider, externalId)` at `server.js:5632-5642` — same pattern but uses `rows.length === 1` correctly. Sites: `server.js:5681, 5791, 5859, 5936, 6035, 6096, 6156`. Only the WhatsApp listings module owned the second, buggy layer.

The top-level WhatsApp route defers to the module first (`server.js:5687`) and only runs the orchestrator for events the module did not handle — that coupling turned a wrong-dedup bug into a full-orchestrator bypass. Fragile (D2 below).

---

### 3. Comment classifier + router hidden state

Classifier + router live downstream of `ingestInboundMessage` (`orchestrator.js:233-292`). Facebook/Instagram/TikTok/X reach ingest and ran normally. WhatsApp did not, so nothing was classified/routed for WhatsApp during the bug window.

- **Polluted state**: none — the code path never wrote `conversation_messages`, `comment_routings`, or classifier metadata for WhatsApp.
- **Under-counted state**: Command Center escalations (`server.js:6479+`) — hot-lead/complaint SLAs never fired for WhatsApp inbound. `activity_log` type `whatsapp_inbound_message` missing → dashboard gaps.
- The retro-classifier backfill at `server.js:6606-6643` cannot recover WhatsApp because raw content was never persisted; it only handles public comment channels.

---

### 4. Social publishers — billing-invisible window (Phase 7a → 5fccd71)

`emitUsageEvent` swallowed every DAL error at `billing/events.js:135, 153-156`. `commercial.usage_events` is LIST-partitioned by `territory_id` with PK `(id, territory_id)`; the adapter's default `ON CONFLICT (id)` matched no constraint → Postgres 42P10 → error caught, `null` returned. Fix in `5fccd71` via `table-mapper.js:136-152` (`conflictColumns: ['id', 'territory_id']`).

Action-key surface the rebuild must reconcile:

| actionKey | Emitter | Site |
| --- | --- | --- |
| `publish.meta.instagram|facebook`, `publish.linkedin`, `publish.tiktok`, `publish.x.plain|link` | Social publisher (Phase 4) | `server.js:5540-5553` |
| `render.template.standard|premium` | Social cards + Bannerbear (5/5.5) | `modules/social-cards/index.js:297-306` |
| `ai.description.generated|failed` | listings-ai (Phase 3) | `modules/listings-ai/routes.js:83, 107` |
| `ai.reply.drafted` | comment-router handlers (4.7b) | `modules/comment-router/handlers.js:344-352` |
| `ai.chat.turn` | Contact 360 regen (4.8) | `server.js:4273-4278` |
| `ai.classification` | orchestrator + manual reclass | `orchestrator.js:280`; `server.js:6452` |
| `message.in.*` (rate-0 telemetry) | orchestrator inbound (4.6b/c) | `orchestrator.js:269` |
| `message.out.*` (WA utility/marketing, meta_dm, sms, email, x_dm) | orchestrator outbound | `orchestrator.js:746-767` |
| `webhook.received` | Meta/TikTok/X webhook receipt | `server.js:5937, 6036, 6097, 6157` |
| `listing.created` | Property create | `server.js:1672-1677` |

Zero rows exist in `commercial.usage_events` for any of these between `8d256fd` (Phase 7a emit wiring) and `5fccd71`. Recovery source-of-truth: `distribution_jobs`, `social_cards`, `conversation_messages`, `activity_log`, `wa_listings.ai_usage_logs`. Quota-bounded keys (`billing/events.js:172-185`) require a rebuild-team decision on whether to consume ledger balance during backfill.

---

### 5. Neighborhood Valuator + Google budget (Phase 6)

**Bug**: `modules/area-intelligence/application/google-service.js:34-55` — `logUsage()` destructured only camelCase, but `google-client.js:62-71` fires the callback snake_case (`cost_estimate_usd`, `request_count`, `response_status`, `error_message`). Every row in `area_intelligence.google_api_usage_log` had `cost_estimate_usd = NULL` from Phase 6 launch until `c2e6240`. `getMonthlySpend()` (line 57-65) sums the column → always 0 → `isOverBudget()` always false → the refresh worker (`google-refresh-worker.js:25, 56, 263`) and `fetchPlacesForArea/DistancesForArea` ran with the $500/mo cap disabled.

**Reconstruction**: `google_api_usage_log` rows preserve `operation` + `endpoint`. Recompute cost with the same mapping at `google-client.js:76-80` (`/place/nearbysearch → $0.017`, `/distancematrix → $0.005`, else `$0.001`). Truth-source for validation: Google Cloud Console → Billing → Reports by SKU. Delta = free-tier absorption + rate drift.

**Enterprise pattern for the rebuild**:
1. Record cost intent **before** the network call — write the row with the endpoint-mapped estimate, update on completion. Callback shape bugs then cannot zero out cost.
2. Enforce the cap in a Postgres function under `SERIALIZABLE`; no JS-side arithmetic on a nullable column.
3. Emit each Google call as a `commercial.usage_events` row (`actionKey: 'api.google.places'`, cost in `cogs_estimate_minor`) — unifies vendor spend with billing telemetry.
4. Two-threshold enforcement: soft (80% → email ops) and hard (100% → throw). Currently only hard.
5. `NOT NULL` + `CHECK (cost_estimate_usd >= 0)` so the shape bug becomes an INSERT error, not a silent zero.

---

### 6. Test coverage — Phase 1-6 vs Phase 7*

Total backend test files: **71**. Classifying by dominant subject:
- **Phase 1-6: 16 files** (6 whatsapp-listings, 9 property-valuation, 2 area-intelligence, 1 listings-ai routes, scattered lib tests).
- **Phase 7*: 55 files** (billing/, e2e/, auth-*, persistence/, platform-templates/, phase-7f3, tenant-*).

Real-Postgres-gated (uses `TEST_DATABASE_URL` / `withTestDb` / `skipIfNoPostgres`): **29 files total**. Of those, only **3 are Phase 1-6**: `whatsapp-listings/tests/atomic-claim.test.js` (fix-guard for the dedup bug), `whatsapp-listings/tests/pipeline-integration.test.js`, `area-intelligence/tests/google-budget.test.js` (fix-guard for the Google bug).

**13 of 16 Phase 1-6 test files (~81%) live only in the mocked-DAL lane.** That's exactly why both DAL-shape bugs shipped: a mock cannot distinguish "insert but misread rowCount" from "insert then read correctly."

**Zero coverage across the entire codebase** (grep of identifier in `*.test.js` returns nothing): `conversations/orchestrator.js` (~900 LOC, critical path for every inbound provider), `modules/comment-router/**`, `lib/comment-classifier.js`, `modules/social-cards/**`, `lib/notifications/{facebook,instagram,tiktok,x,linkedin,sms}.js`.

---

### Risk register

| # | Risk | Severity | Evidence | Recommended action |
|---|---|---|---|---|
| D1 | WhatsApp inbound silently dropped Phase 4.6 → 5fccd71 | **P0 — HISTORICAL (fixed)** | `whatsapp-listings/infrastructure/db.js:61-79` | Reconstruct from `processed_messages` anti-join; notify affected tenants via `platform-notifications`; do not double-charge on replay |
| D2 | Top-level WhatsApp webhook trusts module's `handled: true` — the module returned `handled: true` for `deduplicated`, `feature_disabled`, `not_agent_sender` regardless of real state | **P1 — LIVE** | `server.js:5710-5711`, `webhook.js:60-92` | Have the module return outcome codes distinct from `handled`; top-level should call orchestrator on any non-success outcome |
| D3 | `usage_events` INSERT silently failed for every meterable action Phase 7a → 5fccd71 | **P0 — HISTORICAL (fixed)** | `billing/events.js:135,153-156`; `table-mapper.js:136-152`; commit `5fccd71` | Backfill from `distribution_jobs`, `social_cards`, `conversation_messages`, `activity_log`, `wa_listings.ai_usage_logs` |
| D4 | Google Maps budget cap disabled; unbounded spend Phase 6 → c2e6240 | **P0 — HISTORICAL (fixed)** | `google-service.js:34-55` (destructure shape mismatch) | Backfill via endpoint mapping; reconcile against Google Cloud Console; add NOT NULL + CHECK; enforce cap via DB function |
| D5 | Comment classifier + router have **zero automated test coverage** | **P1** | grep of `orchestrator/classifyByRules/comment-router` in `*.test.js` returns nothing | Add real-Postgres tests for `ingestInboundMessage` × 6 providers + rules-stage classifier goldens |
| D6 | WhatsApp outbound window classification does full-collection `findAll` scan on `conversation_messages` per send | **P1 — perf + correctness** | `orchestrator.js:749-755` | Replace with indexed SQL; misclassification here mis-bills utility vs marketing |
| D7 | `emitUsageEventAsync` swallows all errors silently — rebuild will get no signal on future partition/PK misalignment | **P2** | `billing/events.js:153-156` | Add `usage_event_persist_failure` counter + alert; keep swallowing to preserve fire-and-forget contract |
| D8 | 81% of Phase 1-6 test files are unit-only; both shipped bugs were DAL-shape bugs invisible to mocks | **P1** | 3/16 Phase 1-6 test files use `TEST_DATABASE_URL` | Require a real-Postgres integration test for every net-new DAL interaction |
| D9 | `webhook.received` emits `tenantId: 'platform'` — no per-tenant attribution on inbound telemetry | **P2** | `server.js:5937, 6036, 6097, 6157` | Resolve tenant from `event.to` (page_id / IG business account) before emitting |
| D10 | Meta X-Hub-Signature verification duplicated between top-level and module; dev path silently skips signature check | **P2** | `webhook.js:32-34` (`NODE_ENV !== 'production'` bypass) | Consolidate on `lib/webhook-verify.js`; make dev bypass require an explicit env flag |
| D11 | `wa_listings.processed_messages` accumulates forever — no TTL / partition | **P2** | migration 011; no retention referenced | Add partitioned retention (drop partition >90d) before scale-up |
| D12 | `google_api_usage_log.cost_estimate_usd` is `NUMERIC(10,6)` with no NOT NULL — enabled the silent-NULL bug | **P1** | migration 023 line 211 | Add NOT NULL + CHECK constraints |

---

### Reconciliation runbooks

**A. WhatsApp inbound replay**
```sql
SELECT pm.message_id, pm.from_number, pm.processed_at
FROM wa_listings.processed_messages pm
LEFT JOIN wa_listings.sessions s ON s.data->>'last_message_id' = pm.message_id
LEFT JOIN wa_listings.drafts   d ON d.data->>'source_message_id' = pm.message_id
WHERE s.id IS NULL AND d.id IS NULL
  AND pm.processed_at < '<5fccd71-deploy-timestamp>';
```
Then request replay from Meta or surface a "we may have missed a message from you" prompt via `sendWhatsAppText`.

**B. Usage-event backfill** — priority: (1) `publish.*` from `distribution_jobs WHERE status='published'`; (2) `render.template.premium` from `social_cards` where engine `bannerbear`; (3) `ai.reply.drafted` from `conversation_messages` where `suggested_reply IS NOT NULL`; (4) `ai.chat.turn` from `activity_log type='contact_lead_summary_regenerated'`; (5) `message.out.whatsapp.*` from outbound `conversation_messages`. Window: `8d256fd` → `5fccd71`.

**C. Google spend reconciliation**
```sql
UPDATE area_intelligence.google_api_usage_log
   SET cost_estimate_usd = CASE
       WHEN operation LIKE '/place/nearbysearch%' THEN 0.017
       WHEN operation LIKE '/distancematrix%'    THEN 0.005
       ELSE 0.001 END
 WHERE cost_estimate_usd IS NULL;
```
Sum by month, compare to Google Cloud Console → Billing by SKU.

---

**Hand-off**: the three P0-historical bugs are fixed on `main`. Missing: (a) the reconciliation runbooks above, (b) the §5 Google budget pattern, (c) real-Postgres integration tests for Phase 1-6 code paths (D5, D8). None blocks the Phase 7* rebuild directly — but replacing the DAL, partition strategy, or webhook verifier without carrying these lessons forward will re-open the same silent-drop bug class.

---

## Audit E — Auth + security surface

Scope: `backend/src/auth.js`, `backend/src/auth-2fa.js`, `backend/src/server.js`, `backend/src/billing/**`, `backend/src/notifications/platform-templates/routes.js`, `backend/src/lib/{authz,credentials,validation,webhook-verify,logger}.js`, `backend/src/persistence/table-mapper.js`. Reviewed against the current post-`82cf3ef` / post-`860f578` / post-`f2a4997` / post-`16a` state.

---

### 1. Rate limiting — coverage inventory

The only two limiters are declared in `backend/src/server.js:442-462`:

```
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: RATE_LIMIT_GENERAL_MAX, ... })  // 200/15m in prod
const authLimiter    = rateLimit({ windowMs: 15 * 60 * 1000, max: RATE_LIMIT_AUTH_MAX, ... })     // 20/15m in prod
```

Mounted at `server.js:464-467`:

- `app.use(generalLimiter)` — every route (per-IP).
- `app.use('/api/auth', authLimiter)` — login/register/password/recovery/2FA.
- `app.use('/api/inquiries', authLimiter)`.
- `app.use('/api/agents/:id/reviews', authLimiter)`.

**Gaps that matter for enterprise billing.** None of the following have any per-account or tighter per-IP limiter — they only inherit the 200/15-min generalLimiter, and a single tenant sharing one egress IP will exhaust that for the whole tenant:

- `POST /api/admin/billing/credit` (`billing/routes.js:196`) — mints ledger credit.
- `POST /api/admin/billing/subscriptions/bulk-{cancel,expire,migrate,pause,resume}` (`billing/products/routes.js:501-556`).
- `POST /api/admin/billing/credit-notes/bulk-issue` (`billing/products/routes.js:567`).
- `POST /api/admin/message-templates/:id/test-send` (`notifications/platform-templates/routes.js:316`) — sends real email through the SES/Postmark provider.
- `POST /api/admin/users/:id/promote` (`server.js:3683`) — grants `platform_role`.
- All pricing / territory / rate-card mutations (`billing/pricing/routes.js`, `billing/products/routes.js`).
- OAuth token exchange at `POST /api/social-channels/oauth/:platform/callback` (`server.js:4820+`).

**`trust proxy` is off unless FORCE_HTTPS is on.** `server.js:470-476`:

```
if (isProduction && process.env.FORCE_HTTPS === 'true') {
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false)
```

If deployed behind Railway's proxy without `FORCE_HTTPS=true`, `req.ip` is the proxy's IP and both limiters collapse to a single global bucket. Rate-limit key is unreliable at deploy time.

Additionally, both limiter handlers log `req.ip` only; there is no per-account counter, so a distributed low-and-slow attack on `/api/auth/login` from ten IPs bypasses the 20-req budget entirely (NIST 800-63B §5.2.2 requires per-account throttling).

---

### 2. JWT posture

`auth.js:26-28`:

```
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}
```

- **No refresh flow.** The 7-day access token IS the session. There is no `/api/auth/refresh` endpoint (grep `refresh_token` in `server.js` returns only OAuth-provider tokens at 4944/4964).
- **No revocation list.** Revocation is done exclusively via `token_version` bumps. This is fine as a design but every JWT is a bearer credential live for up to 7 days after theft.
- **`token_version` is bumped** on:
  - password reset (`server.js:1211`), password change (`server.js:1248`), account recovery (`server.js:1331`).
  - TOTP disable (`auth-2fa.js:446`).
  - `updatePlatformRole` (`identity.js:171-181`, side effect in `jsonb_set`).
- **Not bumped** on:
  - `POST /api/admin/billing/credit` and every other admin mutation — but that is by design.
  - **TOTP _enable_** (`auth-2fa.js:365-391`) — a new second factor is bound but other sessions are not evicted. Every session that existed before the enrolment stays valid without ever being challenged. Compare with disable (line 446). This is a **P1 asymmetry**.
  - **Credential rotation** (`POST/PUT/DELETE /api/my-connections`, `server.js:5077-5170`) — even though these are `requireElevated`-gated, changing an OAuth token does not evict outstanding sessions elsewhere.
- **Fallback secret in non-prod.** `auth.js:19-21` still uses `'dev-jwt-secret-change-me'`. Any staging environment that forgets `JWT_SECRET` and does not set `NODE_ENV=production` is trivially forgeable. `credentials.js` was tightened to throw hard in the same situation; `auth.js` should match.

---

### 3. Session fixation / CSRF / XSS

Bearer-in-header design eliminates classic CSRF; the risk shifts to XSS. Findings:

- **CSP allows `'unsafe-inline'` for scripts** at `server.js:412`:

  ```
  scriptSrc: ["'self'", "'unsafe-inline'"],
  ```

  This defeats the CSP's XSS mitigation almost entirely — a single reflected `<script>` sink will execute. **P1 for enterprise posture** (OWASP ASVS 14.4.1 requires a nonce-based or hash-based script-src).

- **Template preview iframe.** `web/src/components/platform-templates/PreviewPane.tsx:116-186` renders admin-authored HTML via `iframe.srcdoc` with `sandbox=""` — no `allow-scripts`, no `allow-same-origin`. Correctly quarantined. This is the highest-risk XSS surface on the admin console and it is contained.

- No `dangerouslySetInnerHTML` or `.innerHTML =` in the web frontend (`grep` across `web/` returns zero hits).

---

### 4. Secret sprawl and log hygiene

Secrets required at runtime (production-must-be-set): `JWT_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `META_APP_SECRET`, `TWILIO_AUTH_TOKEN`, `TIKTOK_WEBHOOK_SECRET`, `X_WEBHOOK_SECRET`, `X_OAUTH_CLIENT_SECRET`, `TIKTOK_CLIENT_SECRET`, `AZURE_CLIENT_SECRET`, `DATABASE_URL`.

- Only `CREDENTIALS_ENCRYPTION_KEY` throws hard on absence (`credentials.js:26-32`). `META_APP_SECRET`, `TWILIO_AUTH_TOKEN`, etc. are wrapped by `requiredWebhookSecret(...)` which throws inside the webhook handler — but the handler catches and returns 200 (`server.js:5768-5772`), which is a **P1** design mismatch: a misconfigured secret silently succeeds the webhook rather than surfacing.

- `logger.js` is bare pino with no redaction paths. `pino` supports `redact:['req.headers.authorization', '*.password_hash', '*.token', '*.secret']` and this is not configured. Nothing today logs the Authorization header directly, but the very next `logger.error({ err, req })` will spill it.

- `server.js:7837`: health endpoint returns `client_secret_present: Boolean(process.env.AZURE_CLIENT_SECRET)` — boolean only, safe.

- Dev-only recovery-token leakage: `server.js:6993-6998` returns `_dev_recovery_token` in the admin approve response when `!isProduction`. Guarded by the env check; verify the check is not defeated by `NODE_ENV` being unset.

---

### 5. Password policy

`lib/validation.js:29-64`:

```
export const registerSchema = z.object({ ..., password: z.string().min(6).max(128), ... })
export const passwordResetSchema  = z.object({ ..., password:     z.string().min(10).max(128) })
export const passwordChangeSchema = z.object({ ..., new_password: z.string().min(10).max(128) })
```

- **Min-length mismatch.** Registration accepts 6 chars, reset/change require 10. A user registering today with `abc123` cannot change to `abc123` later. Almost certainly unintentional and directly contradicts NIST 800-63B §5.1.1.2 (min 8 chars for user-chosen).
- **No breach-list check** (`have-i-been-pwned` API or local rockyou-lite). NIST 800-63B §5.1.1.2 recommends this.
- **No composition strength check** (entropy / zxcvbn score).
- **No password history / reuse ban** — reset is a bare `bcrypt.compareSync` against the current hash only (`server.js:1243`). SOC2 CC6.1 in a controlled environment usually requires prohibiting reuse of the last N.
- **bcrypt cost mismatch.** Registration uses cost 10 (`server.js:958`), reset/change use cost 12 (`server.js:1210, 1247, 1330`). Legacy accounts stay on 10 forever unless they change password. Enterprise target 12 minimum; ideally re-hash on login.

---

### 6. Account recovery

Flow spans `server.js:1273-1355` (self-service request/complete) and `server.js:6957-7026` (admin approve/reject).

Positives:
- Tokens are `randomBytes(32)`, stored as SHA-256 hash (`server.js:827-864`), 30-minute TTL, max 10 attempts, single-use.
- `revokeOutstandingRecoveryTokens` supersedes older tokens on issue.
- Requires an admin to move a case from `pending_review` to `approved` before a token is minted.
- `compromised_session_reset_at` is stamped and `token_version` bumped on completion (`server.js:1331-1337`), evicting all existing sessions.

Gaps:
- **No special path for `platform_admin` recovery** — a single platform admin can approve and complete another platform admin's recovery unilaterally. There is no four-eyes / two-admin approval, and the recovery reviewer is the same role tier as the target (`server.js:6957-7000`). **P1 for a platform admin population > 1.**
- **`/api/admin/account-recovery/:caseId/approve` is not `requireElevated`-gated** (`server.js:6957`). A hijacked-but-unelevated admin session can approve recovery for any account and then use the leaked `_dev_recovery_token` in non-prod, or trigger the (still-unimplemented) real delivery in prod. **P1.**
- **No admin-triggered "lock account without email"**. The only way an admin can stop a stolen account is to disable it via a promote/demote flow or to change `updated_at` — there is no `POST /api/admin/users/:id/revoke-sessions` that just bumps `token_version` and freezes the row. Enterprise IR requires that primitive.

---

### 7. Audit log integrity

`persistence/migrations/009_audit_activity.sql:3-16`:

```
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  agency_id TEXT REFERENCES agencies(id) ON DELETE SET NULL,
  type TEXT, action TEXT, entity_type TEXT, entity_id TEXT,
  ip TEXT, user_agent TEXT, metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

Findings:
- **No triggers or table-level `REVOKE UPDATE, DELETE FROM audit_log`.** Anyone with the application role can `UPDATE audit_log SET ...` and covered by nothing.
- **`ON DELETE SET NULL` on `agent_id`.** Deleting the actor row nulls their audit rows' `agent_id`, breaking attribution. Enterprise audit trail needs `ON DELETE NO ACTION` or a denormalised copy of `actor_email` on write. **P1.**
- **`POST /api/admin/audit-log/retention`** (`server.js:3664`) mass-deletes rows older than `AUDIT_LOG_RETENTION_DAYS` (default 365, min 1, max 3650). It is `requirePlatformAdmin`-only, **not `requireElevated`-gated** — a hijacked-but-unelevated admin can wipe the audit trail. **P0 — enterprise audit tamper vector.**
- **No hash-chain / tamper evidence.** No `prev_hash` column, no external append-only store (e.g. AWS QLDB, or a WORM S3 bucket), no signed batches. SOC2 CC6.6 accepts an application-level control here only if combined with restricted DB-role write access.
- **Admin only sees `activity_log`, not `audit_log`.** `GET /api/admin/audit-log` at `server.js:3653` actually returns `activity_log`, not `audit_log`. The billing credit grant writes to `audit_log` (`billing/routes.js:232`), so it is invisible to the admin console. Confusing naming and a **P1 observability hole**.

---

### 8. OWASP Top 10 quick pass

**A01 — Broken access control.**
- `/api/admin/users/:id/promote` at `server.js:3683` is `requirePlatformAdmin` only, **not `requireElevated`**. A hijacked platform-admin session can grant `platform_role` to any user (or self-elevate a compromised second admin). **P0 — LIVE BUG.** Compare with `/api/admin/message-templates/*` which correctly demand `requireExplicitPlatformAdmin + requireElevated()`.
- `/api/admin/submissions/:id/{approve,reject}` at `server.js:6888,6922` also lack `requireElevated`. Lower impact but same asymmetry.
- `/api/admin/comment-classifier/run` at `server.js:685` calls `isPlatformAdmin` inline instead of using `requirePlatformAdmin` middleware (functional-equivalent, style drift only).
- Tenant boundary is defended by `lib/authz.js` `assertOwns(kind, ...)` (`lib/authz.js:50-61`) which walks agency memberships. Uses `NotFoundError` (404) instead of 403 to avoid leaking existence — good. Covers 8 resource kinds; property/contact/opportunity/task/viewing/campaign/distribution/conversation. However, **billing routes never call it** — `/api/billing/usage` (`billing/routes.js:116-128`) filters by `req.user.id`, meaning "one tenant per user id." That collapses agency-shared billing. Rebuild target.

**A03 — Injection.**
- Grep for `` `SELECT ...${` `` outside test files: only `notifications/platform-templates/service.js:375` builds a WHERE clause. Reviewed — clauses use `?` placeholder swapped to `$N`, values pushed to `params`. Safe.
- Only unparameterised interpolation is `CREATE DATABASE ${testDbName}` in test scaffolding — not reachable from the app.
- `migrations/runner.js:68` interpolates `migrationsTable` — hard-coded constant. Safe.
- No `child_process` / shell calls in the request path.

**A08 — Software / data integrity.**
- Webhook handlers (`/api/webhooks/{whatsapp,sms,email,instagram,facebook,tiktok,x}`) each call the correct `verify*Signature` helper from `lib/webhook-verify.js` and reject via `rejectInvalidWebhook`. All signatures use `timingSafeEqual`; TikTok/SendGrid include the timestamp window guard (`webhook-verify.js:13-22`, 300-second default).
- BUT: the WhatsApp handler at `server.js:5768-5772` swallows any thrown error and returns 200 with the error in the body. That means a signature-verify failure that happens to throw (e.g. missing `META_APP_SECRET`) returns 200 to the sender instead of 401. **P1**.
- SMS/Email/Instagram/Facebook/TikTok/X handlers are structured similarly — audit each for the same silent-200 pattern.
- No end-user-installable modules; no arbitrary URL fetch outside the SSRF-guarded `assertPublicDestination` in `modules/whatsapp-listings/infrastructure/ai/shared.js`.

---

### Risk register

| # | Risk | Severity | Evidence | Recommended action |
|---|------|----------|----------|--------------------|
| E1 | Platform-role promotion is not step-up-gated | **P0 — LIVE BUG** | `server.js:3683` — `app.post('/api/admin/users/:id/promote', authMiddleware, requirePlatformAdmin, ...)` | Add `requireElevated()` and `requireExplicitPlatformAdmin` (matching platform-templates pattern). |
| E2 | Audit-log retention endpoint can wipe history without step-up | **P0** | `server.js:3664` — retention `POST` is `requirePlatformAdmin` only; deletes rows older than N days. | `requireElevated()`; consider requiring two-admin approval or moving retention out of the API into a Cron job with SST secret. |
| E3 | `audit_log` has no DB-level append-only enforcement; `ON DELETE SET NULL` breaks attribution | **P1** | `migrations/009_audit_activity.sql:3-16` | Grant only `INSERT, SELECT` to the app role; store `actor_email_snapshot` denormalised; enable a hash-chain (`prev_hash sha256`) or ship to WORM. Aligns with SOC2 CC6.6 / CC7.2. |
| E4 | Account-recovery approval unilaterally granted by a single platform admin, no step-up | **P1** | `server.js:6957` | `requireElevated()`; introduce a "two-admin approval required for platform_admin targets" rule; store approver diversity in the case row. NIST 800-63B §6.1.2. |
| E5 | Registration password minimum is 6 chars, mismatched with 10-char reset/change | **P1** | `lib/validation.js:33` vs `lib/validation.js:58,63` | Raise registration to `min(12)`, adopt zxcvbn score>=3 or HIBP breach-list. NIST 800-63B §5.1.1.2. |
| E6 | bcrypt cost 10 for signup vs 12 for reset — legacy accounts stay at 10 forever | **P1** | `server.js:958` vs `server.js:1210,1247,1330` | Unify at 12+; opportunistically re-hash on successful login when cost < target. |
| E7 | CSP `'unsafe-inline'` in `script-src` defeats CSP XSS defence | **P1** | `server.js:412` | Move to nonce-based CSP; remove `'unsafe-inline'`. OWASP ASVS 14.4.1. |
| E8 | 7-day JWT is entire session; no refresh, no revocation list | **P1** | `auth.js:27` | Introduce short-lived access token (15 min) + rotating refresh token bound to `token_version` + a `session_id` row for explicit revoke-by-ID. NIST 800-63B §7.1. |
| E9 | Enabling TOTP does not bump `token_version` (only disabling does) | **P1** | `auth-2fa.js:365-391` vs `auth-2fa.js:446` | Bump `token_version` inside the transaction on enable — new second factor should evict any pre-enrolment session. |
| E10 | Silent-200 on webhook errors hides misconfigured secrets | **P1** | `server.js:5768-5772` (WhatsApp); mirror pattern in other webhooks | Return 401 on `WEBHOOK_SECRET_MISSING` and 500 on genuine bugs; keep 200 only after successful signature verify. |
| E11 | Rate limits are per-IP only; no per-account throttle; `trust proxy` off by default | **P1** | `server.js:442-476` | Add per-account key on login/step-up (`keyGenerator: req => req.body.email || req.ip`); always set `trust proxy` for the deploy env. NIST 800-63B §5.2.2. |
| E12 | No rate limit on billing credit grant, bulk operations, template test-send, admin promote | **P1** | `billing/routes.js:196`, `billing/products/routes.js:501+`, `platform-templates/routes.js:316`, `server.js:3683` | Attach a tighter limiter (`max: 10 / 5m` per admin) to admin-mutation surfaces. |
| E13 | Dev `JWT_SECRET` fallback in `auth.js` while `credentials.js` throws hard | **P1** | `auth.js:19-21` vs `credentials.js:26-32` | Match `credentials.js`: throw hard, require env in every environment; tests already set the env. |
| E14 | `logger.js` has no redaction paths — a single `logger.error({req})` will leak Authorization header | **P2** | `lib/logger.js:1-11` | Configure `pino({ redact: ['req.headers.authorization', '*.password_hash', '*.token*', '*.secret*', 'req.headers.cookie'] })`. |
| E15 | `GET /api/admin/audit-log` reads `activity_log`, hiding writes made to `audit_log` (billing credit grant) | **P2** | `server.js:3653-3661` vs `billing/routes.js:232` | Fix reader to union both tables or rename endpoint / tables to remove the confusion. |
| E16 | No admin primitive to freeze a stolen account without email access | **P2** | grep of `revoke-sessions|freeze|lock-account` returns 0 hits | Add `POST /api/admin/users/:id/revoke-sessions` that bumps `token_version` + writes an `audit_log` row + is `requireElevated`-gated. Enterprise IR expects a one-click session-kill. |
| E17 | OAuth token exchange on `/api/social-channels/oauth/:platform/callback` has no dedicated rate limit and no per-user throttle | **P2** | `server.js:4850+` | Same limiter as bulk-ops. Also verify PKCE / state binding covers replay. |

---

### Enterprise-grade recommendations mapped to standards

- **NIST 800-63B §5.1.1.2 / §5.2.2** — raise password minimums, add HIBP breach-list check, enforce per-account throttling (E5, E11).
- **NIST 800-63B §7.1** — short-lived access token + refresh (E8).
- **OWASP ASVS 14.4.1** — CSP nonce-based, remove `'unsafe-inline'` (E7).
- **OWASP ASVS 8.3.4** — mask sensitive data in logs; add pino redact paths (E14).
- **OWASP ASVS 3.5.3** — bind session invalidation to security-sensitive events (TOTP enable) (E9).
- **SOC2 CC6.1** — password reuse ban; consistent bcrypt cost with opportunistic upgrade (E6).
- **SOC2 CC6.6 / CC7.2** — audit-log tamper evidence and integrity monitoring (E3).
- **SOC2 CC6.3** — least-privilege DB role; app role must not hold `UPDATE, DELETE` on `audit_log` (E3).

The two items that must be visible to the rebuild team before they start writing billing endpoints:

1. **E1 (P0)** — every new admin surface must be constructed via `[authMiddleware, requirePlatformAdmin, requireExplicitPlatformAdmin, requireElevated()]` guard array. Copy the `platform-templates/routes.js:175` pattern. The `phase-7f3-wiring.test.js` inventory needs the new routes added or it will drift silently.
2. **E3 (P0/P1)** — the billing rebuild will write a lot of `audit_log` rows; agree the append-only + tamper-evidence model NOW before schema is set, not after.

---

---

## Cross-cutting recommendations

### Enterprise-grade test discipline going forward

The 17-run silent-CI-failure history is the single most important lesson from this codebase. Every rebuild stage should:

1. **Ship its gated tests as part of the same PR as the feature.** No "we'll add e2e later" — the transcript shows that "later" means "never runs."
2. **Verify the gated tests actually execute in CI.** After merging, check the postgres job green output for the test file names you added. If they aren't in the run summary, they didn't run.
3. **Track "tests written" and "tests exercised in CI" as separate metrics.** The handover mislabeled this for months.
4. **Prefer real-Postgres to mocked-Postgres for anything that touches persistence.** The gap between how pg behaves and how a mock behaves is where the four live bugs hid.

### Enterprise-grade error handling

`emitUsageEvent` swallows exceptions and returns null. `runElevated` catches step-up 401s but re-throws everything else. `claimProcessedMessage` returned `{claimed:false}` for both "already-claimed" and "database error" — indistinguishable to the caller.

The rebuild should adopt structured error shapes:
- Every error carries a stable `code` (Microsoft-Graph-style, e.g. `USAGE_EVENT_INSERT_FAILED`, `LEDGER_INSUFFICIENT_BALANCE`).
- The catch-and-swallow pattern is banned outside a narrow set of documented fire-and-forget sites, each with a named alerting hook.
- Every silent failure needs a dead-letter queue OR a "this cost you $N of telemetry data" observability signal.

### Enterprise-grade observability

There is no current mechanism for "how many usage events did we drop today?" or "how many step-up prompts were cancelled by admins?" Both are enterprise-grade must-haves. Stage 1 of the rebuild should install a structured metrics surface (Prometheus / OTLP / similar) so silent failures become impossible in the first place.

---

## Operational actions still on the user (blockers to full function)

Copied forward from the 2026-08-16 handover so the rebuild team has one source of truth:

1. **`CREDENTIALS_ENCRYPTION_KEY`** on Railway — TOTP enrolment 503s until set. Also encrypts marketplace OAuth tokens. **Never rotate once users enrol.**
2. **Corrupt local folder swap** — `E:\Projects\Real Estate Companion` corrupt; healthy clone at `.new`. User needs to close editors + swap.
3. **Rotate Railway Postgres password** — leaked in chat 2026-08-14, never rotated.
4. **Persistent upload storage** — Railway containers ephemeral, still on local disk.
5. **Confirm `/health` is the Railway healthcheck path.**
6. **`ApplicationAccessPolicy`** in Exchange Online — optional defence-in-depth, parked as "ship first, add later."

---

## Sign-off

This document is a starting point, not an ending point. If any of the findings below turn out to be wrong on closer inspection, that itself is worth capturing — the reasoning process is more valuable than any single verdict.

Cursor agents: read your assigned Stage 0 deliverables first, then this audit, then start building. Do not skip either.

---

## Stage 0 resolution

Original findings above are unchanged. This section is the audit trail of what Stage 0 did with them — not a rewrite.

### Stage 0 / Agent A (entity model) — 2026-08-18

**Delivered:** `docs/design/fin/A_ENTITY_MODEL.md`, `docs/design/fin/DECISION_LOG.md` (scaffold), `docs/design/fin/STAGE_0_AGENT_SPLIT.md`. User confirmed this agent owns A; B–D own B+C, D+E, F+G+H.

**Addressed in design (not in code):**

| Finding | How the entity model scopes it | Implementation stage |
|---|---|---|
| A/B-1 usage INSERT split from `recordConsumption` | `fin.usage_events` is facts-only; value movement is `ledger_transactions` + postings + lots in one DB transaction | Stage 2 + Stage 6 |
| A-2 swallow / no metric / no DLQ | `fin.usage_events_dlq` + `fin.authorization_attempts` + named metric | Stage 2 |
| A-4 second ledger (`ai_credit_*`) | Single-ledger doctrine: lots + postings only; wa_listings consume becomes usage + authorize | Stage 6/7 + Stage 13 |
| C-2 lost updates | `+occ` / `version` on every MUTABLE table; APPEND_ONLY has no UPDATE | Stage 1 |
| E-3 `audit_log` mutable, SET NULL attribution | `fin.financial_audit_events` INSERT/SELECT, hash-chain, `actor_email_snapshot` | Stage 1 + Agent D `H_SECURITY` |

**Deferred (still LIVE in `commercial.*` / current app code — do not silently patch):**

| Finding | Why deferred |
|---|---|
| A/B-1, A-2 | Replacing `emitUsageEvent` now would write more `commercial.*` rows against a frozen schema. The rebuild path is `fin.usage_events`. |
| A-4 | Retiring `ai_credit_*` before lots exist would drop the only working WA-listings credit UX. |
| C-1 (9 pricing PATCH endpoints throw) | Owned by Stage 4 (`fin.prices` admin). A success-path real-Postgres test is mandatory when that surface is born. A drive-by DAL-signature fix on `commercial.*` is out of Stage 0 scope. |
| C-2 on the existing DAL | Adapter-wide `FOR UPDATE` / If-Match is Stage 1 foundation work on `fin.*` writers, not a silent `postgres-adapter.js` rewrite in this PR. |
| E-3 on `public.audit_log` | New money paths use `fin.financial_audit_events`. REVOKE on the legacy table is Agent D / Stage 1, not this deliverable. |
| A-3, D-1, D-4 (historical) | Reconstruction runbooks stay in Audit D. Execution is Stage 13 backfill (`source_system='backfill_v1'`) plus ops. Zero live tenants (handover §2.4) — no customer credit-note pass until there is a customer. |
| E1, E2 | Already remediated in `16beece`. New admin surfaces must copy the 7f/3 guard array; that is a Stage 12 (and any earlier admin) constraint, not a Stage 0 code change. |

**Not in Agent A scope:** B–H documents, any `backend/src/**` change, any migration.

**Stage 0 is not signed off** until the user reviews all eight deliverables. No `fin.*` implementation until then.

### Stage 0 / Agent A revision R1 — 2026-08-18

Review "approve with revisions" applied in-place to `A_ENTITY_MODEL.md` + `DECISION_LOG.md` DL-012…DL-024. Still **no code**.

| Review item | Disposition |
|---|---|
| M1 composite FK on `usage_events` children | Fixed in §6.1 / §6.6 / §11.4. DL-021 |
| M8 cross-book rule | Strict same-book; paired txs; CLEARING is an account_type. DL-012 |
| A-Q3 uniqueness matrix | Closed. Partial unique + TRANSFER-per-book. DL-014 |
| A-Q7 residency_key | Closed. `= platform_legal_entities.residency_key`. DL-013 |
| M2 accounting_periods | Added §9.0. DL-016 |
| M3 FX snapshots + rounding | Added §9.0b; residual → ADJUSTMENT/FX_ROUNDING. DL-015 |
| M4 tax_treatment | Added on `tax_snapshots`. DL-017 |
| M5 ZATCA/Peppol invoice columns | Added on `invoices`. DL-018 |
| M6 payment_methods + disputes | Added §10.9b/c. DL-019 |
| M7 price_tiers + price_dimensions | JSONB rating surfaces removed. DL-020 |
| T1–T9 | T6/T8/T9 in schema now; T1–T5/T7 reserved §16b. DL-022…024 |

### Stage 0 / Agent A — R1 QA sign-off + R2 nits — 2026-08-18

QA verified R1 against the files and **APPROVED** Agent A for downstream B–H work. Four residual nits do not change declared tables; captured as DL-025…DL-028:

| Nit | DL | Owner |
|---|---|---|
| R2-1 TRANSFER pair integrity (`CHECK` + unique pair/book; exactly-two deferred) | DL-025 | Agent C transaction matrix |
| R2-2 FX stamp mechanism (trigger, not prose) | DL-026 | Agent C |
| R2-3 GDPR erasure vs FINANCIAL_7Y | DL-027 / A-Q9 | Agent D / H |
| R2-4 SEPA/BACS mandate metadata on vault | DL-028 | Stage 8 (columns reserved now) |

### Stage 0 / Agent B (state machines + transaction matrix) — 2026-08-18

**Delivered:** `docs/design/fin/B_STATE_MACHINES.md`, `docs/design/fin/C_TRANSACTION_MATRIX.md`. Decision Log DL-029…DL-036 appended (not rewritten). Split file and A–H bodies other than the log + this subsection were not edited. **No `backend/src/**` and no migrations.**

**Addressed in design (not in code):**

| Finding | How B/C scope it | Implementation stage |
|---|---|---|
| A/B-1 usage INSERT split from `recordConsumption` | `AuthorizeHold` / `DirectSpend` write hold/lots/postings in one DB transaction with Stage 2 usage ingest. Denied auth still inserts `authorization_attempts` | Stage 2 + 6 |
| A-2 swallow / no metric / no DLQ | Ingest fail → `usage_events_dlq` (A). Outbox `FAILED`→`DEAD` is audited and alarmed. No command returns null on DB error | Stage 1 (outbox) + 2 + 6 |
| A-4 second ledger (`ai_credit_*`) | Consume becomes usage + `AuthorizeHold` against `fin.lots`. Single-ledger doctrine (DL-006) restated; `ai_credit_*` not patched | Stage 6/7 + 13 |
| C-2 lost updates | Every INTENT/MUTABLE machine is `UPDATE … WHERE version = $n`; mismatch → `OCC_VERSION_MISMATCH` / 412 | Stage 1 |
| E-3 `audit_log` mutable | Every `audit=Y` transition inserts `fin.financial_audit_events` in the money tx. Legacy `public.audit_log` untouched | Stage 1 + H |
| B-8 lost `fireAndForgetNotify` | B §1 topic catalogue; every money command writes `outbox_events` in the same tx. `notification.lifecycle` / `webhook.stripe` / `usage.dlq_replay` names frozen from A | Stage 1 |
| R2-1 TRANSFER pair integrity | C §1.1: command inserts 0 or 2 legs; `TRANSFER_PAIR_COMPLETE` on a third; no “add the missing leg” repair. Agent C still owns CHECK / UNIQUE(pair,book) / deferred exactly-two (DL-025) | Stage 1 (`ledger/transactions.js`) + C |
| R2-2 FX stamp | C §2: snapshot on both pair legs + all postings; residual is ADJUSTMENT **account** posting `FX_ROUNDING` on the dest tx, not a third leg. Trigger remains Agent C (DL-026) | Stage 1 + C |

**A-Q1:** closed. B §24 locks every INTENT (and the listed MUTABLE/VERSIONED) status alphabet. C §5 locks every command that mints `ledger_transactions` (shape, source, lots, hold, idempotency subject, outbox, audit, approval). C §6 lists commands that must **not** mint a tx (`IssueInvoice`, `ApplyPayment`, …).

**Columns A omitted — Decision Log, not silent tables:**

| DL | Column / rule | Why |
|---|---|---|
| DL-029 | `contract_versions.status` | DRAFT/ACTIVE/SUPERSEDED cannot be derived safely |
| DL-030 | `dunning_cases.status` enum | A left it to B |
| DL-031 | credit/debit note status enum | A listed `status` without values |
| DL-032 | `reconciliation_runs.status` enum | same |
| DL-033 | `reconciliation_resolution.status` | A omitted; `resolved_at` is not a machine |
| DL-034 | GRANT source = `APPROVAL_REQUEST` only; bonus inside FUNDING | no `fin.grants` table |
| DL-035 | vendor_statements UNIQUE(vendor, period, env); no reopen | A omitted |
| DL-036 | `dunning_cases.controls_snapshot` | CURED must not clobber a human freeze |

**Deferred (still LIVE — do not silently patch):**

| Finding | Why deferred |
|---|---|
| A/B-1, A-2, A-4 | Replacement writers are Stage 2/6/7. Patching `events.js` / `credits.js` now would write more `commercial.*` |
| C-1 pricing PATCH throws | Not a state machine. Stage 4 `fin.prices` admin + success-path real-Postgres test |
| C-2 on `postgres-adapter.js` | OCC is specified for `fin.*` writers in Stage 1, not a silent DAL rewrite |
| E-3 REVOKE on `public.audit_log` | Agent D / H |
| A-3, D-1, D-4 (historical) | Stage 13 backfill. Zero live tenants — no customer credit-note pass |
| E1, E2 | Already remediated in `16beece`. New admin surfaces copy the 7f/3 guard array |

**Test discipline (handover §3.1 / A §18):** B §27 and C §10 name the `backend/src/fin/**/*.test.js` files that must appear in the CI **postgres** job summary. Counts are not evidence. No mocked-DB conservation or transition tests.

**Not in Agent B scope:** A body, D–H, any `backend/src/**` change, any migration, remediating the seven live P0s.

**Stage 0 is not signed off** until the user reviews all eight deliverables.

### Stage 0 / Agent C (concurrency + idempotency) — 2026-08-18

**Delivered:** `docs/design/fin/D_CONCURRENCY.md`, `docs/design/fin/E_IDEMPOTENCY.md`. Decision log append-only: **DL-037** (R2-1 deferred pair cardinality), **DL-038** (R2-2 FX-stamp trigger), **DL-039** (`EXPIRED` + NULL-tenant unique on `idempotency_keys`), **DL-040** (`+occ` drift / `invoice_sequences` exception). Signed Agent C. Did **not** rewrite DL-025…DL-028 (Agent A reservations).

**A-Q2:** closed. Total lock order is `ledger_book_id ASC → account_type_rank → account_id ASC`, then facilities, lots (`holder_id`, `draw_priority ASC`), holds, `facility_reservations`, `dunning_cases`. Paired TRANSFER locks both books in `book_id ASC`. Hold expiry uses `SELECT … FOR UPDATE SKIP LOCKED` plus book `NOWAIT` so it cannot invert the order against CAPTURE.

**A-Q3 side:** closed without a new uniqueness column (DL-014 stands). FUNDING-class shapes are once-per-source; REFUND / ADJUSTMENT replay only via `idempotency_keys`.

**Addressed in design (not in code):**

| Finding | How D/E scope it | Implementation stage |
|---|---|---|
| C-2 lost-write (`postgres-adapter.js:219` before `BEGIN`) | Every MUTABLE/INTENT `fin.*` table: `version` + BEFORE UPDATE trigger; PATCH `If-Match: "<version>"` → **412** + current representation. `fin.*` writers `SELECT … FOR UPDATE` **inside** `transaction(fn)` | Stage 1 foundation on `fin.*` writers — **not** a silent adapter rewrite in this PR |
| B-8 fire-and-forget notify / no outbox | `fin.outbox_events` at-least-once, `UNIQUE(topic, dedupe_key)`, consumer-side unique on the business id | Stage 1 |
| B §4 RYOW / ALS gaps | `transaction(fn)` one client; D §8 + D-T11 asserts `findOne` RYOW and nested reuse | Stage 1 |
| A §2 P1 `ON CONFLICT DO UPDATE` on facts | Unchanged: usage unique is `DO NOTHING` (DL-009). Ledger once-per-source is a different unique | Stage 2 / Stage 1 |
| D-1 / E-10 silent-200 inbound | Provider unique `(provider, provider_event_id)` never expires. Duplicate **terminal** → silent 200. Mid-flight → 409 + `Retry-After`. Signature fail → 401, never 200 | Stage 7 (money); do not patch `server.js` now |
| R2-1 3-leg TRANSFER | DL-025 CHECK + UNIQUE + DL-037 deferred `count(*) = 2` | Stage 1 (`103_fin_ledger_transactions_postings.sql`) |
| R2-2 FX stamp as prose | DL-038 deferred trigger joining counterpart book currency | Stage 1 (same migration) |

**Deferred (still LIVE — do not silently patch):**

| Finding | Why deferred |
|---|---|
| C-2 on the existing DAL | Adapter-wide read-before-BEGIN remains. Stage 1 replaces the *writer path for `fin.*`*, not `commercial.*` `update()` in this PR (DL-011) |
| C-1 pricing PATCH throws | Stage 4 `fin.prices` admin; success-path real-Postgres test required then |
| A/B-1, A-2, A-4 | `fin.usage_events` + lots; not `events.js` / `ai_credit_*` |
| E-3 on `public.audit_log` | `fin.financial_audit_events` + Agent D REVOKE |
| D-1 WhatsApp `claimProcessedMessage` | Historical + live module coupling (D-2) — not a Stage 0 code change |
| E-10 webhook silent-200 | New `fin` handlers follow E §5; legacy `server.js` stays until that surface is replaced |

**`B_STATE_MACHINES.md` / `C_TRANSACTION_MATRIX.md`:** not landed at write time. D §4 command ids follow A §4.3 shapes + the Stage 0 plan list. When B/C land, bind names; do not invent a parallel vocabulary (`D-OPEN-1`).

**Not in Agent C scope:** A/B/F/G/H body text, any `backend/src/**` file, any migration, `commercial.*` changes.

**Test discipline:** D §12 and E §7 name the gated files. If a name does not appear in the CI **postgres** job summary, it did not run. Named brief tests: `occ-tenants.test.js`, `advisory-lock.test.js`, `transfer-pair.test.js` (3-leg), `fx-stamp.test.js`, `fingerprint.test.js`.

**Stage 0 is not signed off** until the user reviews all eight deliverables. No `fin.*` implementation until then.

### Stage 0 / Agent D (reconciliation + accounting boundary + security) — 2026-08-18

**Delivered:** `docs/design/fin/F_RECONCILIATION.md`, `docs/design/fin/G_ACCOUNTING_BOUNDARY.md`, `docs/design/fin/H_SECURITY.md`. Decision Log appends DL-041…DL-048. No `backend/src/**` and no edits to A/B/C/E body text. B/C had not landed at write time.

**Closes:** A-Q4 (F), A-Q5 (G), A-Q6 / A-Q8 / A-Q9 (H + DL-041). R2-3 is no longer an open nit.

**Addressed in design (not in code):**

| Finding | How F/G/H scopes it | Implementation stage |
|---|---|---|
| A-3 / D-3 historical empty `usage_events` | F §15 BF-A3: Audit D Runbook B as a one-time `ON_DEMAND` run, `source_system='backfill_v1'`, facts only, no ledger consume | Stage 13 |
| D-1 WhatsApp inbound dropped | F §15 BF-D1: Runbook A anti-join vs `fin.usage_events` backfill; no double-charge; notify via outbox | Stage 13 |
| D-4 Google budget NULL | F §15 BF-D4: Runbook C as a SELECT recompute vs `vendor_cost_estimates`; no `UPDATE google_api_usage_log` from this design | Stage 11 pattern + Stage 13 one-shot |
| E-3 `audit_log` mutable / no hash-chain / SET NULL | H §2–§3: `financial_audit_events` INSERT/SELECT, REVOKE UPDATE/DELETE, RFC 8785 JCS chain (A §12.5 field list), genesis 64-zero per env, no legacy backfill | Stage 1 (`107_fin_audit.sql` + `109_fin_rls.sql`) |
| E1 / E2 (remediated `16beece`) | H §0 / §5: every new admin surface copies `writeGuards` and adds itself to `phase-7f3-wiring.test.js` | Stage 12 and any earlier admin |
| E4 two-admin recovery | H §4 + DL-048: `PLATFORM_ADMIN_RECOVERY` / platform `LARGE_REFUND` / `AUDIT_RETENTION` need two distinct elevated approvers; no self-approval | Stage 12 + Agent B machine |
| E5 / E6 password + bcrypt | H §7: min 12, HIBP, reuse-5, bcrypt 12 + rehash. Identity tables, not `fin.*` (DL-047 OPEN) | Auth hardening (before Stage 12) |
| E7 CSP `'unsafe-inline'` | H §6: nonce-based `script-src`; remove `'unsafe-inline'` | 7f/2 or Stage 12 web |
| E8 7-day JWT | H §8: 15m access + rotating refresh + `session_id` revoke | Auth hardening |
| E9 TOTP enable does not bump `token_version` | H §8: bump inside the enrolment transaction | Auth hardening (same file as enable) |
| E11 / E12 rate limits | H §5: per-account auth limiter; `adminMutationLimiter` 10/5m on credit, bulk-ops, template test-send, pricing PATCH, all `/api/admin/fin/*` | Stage 12 + Stage 4 (pricing) |
| R2-3 GDPR vs 7Y | H §9 + DL-041…031: pseudonymise-in-place; legal-hold blocks; tax_id/jurisdiction stay; `actor_email_snapshot` stays; invoices/payments/rated_usage keep `tenant_id` | Stage 13 retention/erasure worker |
| I-01 / I-02 / balance / lots / tax freeze / payment cap / period equivalence | F R001–R007, R060, R071–R073 as concrete SQL pairs + ladder | Stage 1 (R001–R023) then owning stages |
| HARD_CLOSED accounting | G §4 trigger `ACCOUNTING_PERIOD_HARD_CLOSED`; override = `RECONCILIATION_OVERRIDE` + reopen SOFT first | Stage 1 table / Stage 9 engine |
| FX MONTH_AVG | G §6: read-only presentation; never rewrites books (DL-015) | Stage 9/12 |

**Deferred (still LIVE in `commercial.*` / current app code — do not silently patch):**

| Finding | Why deferred |
|---|---|
| A/B-1, A-2 | F/G detect the class after cutover. Replacing `emitUsageEvent` now writes more `commercial.*`. Stage 2 + 6. |
| A-4 second ledger | R092 detective after cutover. Retire `ai_credit_*` in Stage 6/7 + 13. |
| C-1 pricing PATCH throws | Stage 4 `fin.prices` admin. H only constrains guards + limiter + success-path postgres test. |
| C-2 lost updates on current DAL | Stage 1 `+occ` on `fin.*`, not a `postgres-adapter.js` rewrite here. |
| E-3 on `public.audit_log` | New money paths use `fin.financial_audit_events`. REVOKE on the legacy table is Stage 1, named in H §2.1, not done in this PR. |
| E5–E9, E11–E14, E16 | Auth/CSP/JWT/logger/IR primitives. H is the binding posture. No `server.js` / `auth-2fa.js` / `validation.js` edit in Stage 0. |
| D2 WhatsApp `handled: true` coupling | Not F/G/H. Product webhook stage. |
| D5 / D8 Phase 1–6 test debt | Cross-cut test discipline restated in F/H §Acceptance; not remediated. |
| D12 `cost_estimate_usd` NULL constraint | Stage 11 vendor estimates-before-call + optional legacy CHECK. BF-D4 does not UPDATE the live column. |
| A-3 / D-1 / D-4 **execution** | Runbooks stay in Audit D. One-shot recon is specified; Stage 13 runs it. Zero live tenants — no credit-note pass. |

**Not in Agent D scope:** A–E body text, any `backend/src/**` change, any migration.

**Stage 0 is not signed off** until the user reviews all eight deliverables. No `fin.*` implementation until then.

### Stage 1 / foundation migrations — 2026-08-18

**Landed on `feat/stage-1-fin-foundation`:** `100_fin_schema.sql` … `109_fin_rls.sql` plus named real-Postgres tests under `backend/src/fin/**`. No silent rewrite of `commercial.*`, `postgres-adapter.js`, or `009_audit_activity.sql`.

**Addressed in schema (this PR):**

| Finding | What landed | Still LIVE on current app paths? |
|---|---|---|
| C-2 lost-write | `version` + `fin.trg_bump_version` on every MUTABLE/INTENT `fin.*` table. D-T1 `occ-tenants.test.js` | Yes — `postgres-adapter.js` `update()` is unchanged (DL-011) |
| E-3 mutable audit | `fin.financial_audit_events` INSERT-only hash-chain (H §3 JCS + SHA-256). `109` REVOKE UPDATE/DELETE on the new table **and** detective REVOKE on `public.audit_log` for `fin_app_role` | Yes — existing Express writers still hit `public.audit_log` until money paths move |
| I-01 / I-02 / R2-1 / R2-2 | Deferred conservation; book-containment; pair cardinality = 2; FX stamp on cross-currency pair-legs | N/A (`fin.*` only) |
| B-8 no outbox | `fin.outbox_events` + unique `(topic, dedupe_key)` | Yes — legacy notify still fire-and-forget |
| A-Q6 / A-Q8 | FORCE RLS + `fin.platform_admin_bypass()` (admin ∧ elevated). Genesis 64-zero per environment | N/A |

**A §18 tests deferred** (tables not created in Stage 1, per A §18 body): #1 / #6 / #8 `usage_events` + meters (Stage 2); #9 `accounting_events` HARD_CLOSED (Stage 9). #2–#5, #7, #10 ship in this PR.

**Live P0s not silently patched:** A/B-1, A-2, A-4, C-1, C-2 on the DAL, E-3 on current writers, A-3 / D-1 / D-4 backfill.

**CI rule:** if a test file name below does not appear in the **postgres** job summary, it did not run.

- `100_fin_schema.postgres.test.js` … `109_fin_rls.postgres.test.js`
- `occ-tenants.test.js` `advisory-lock.test.js` `transfer-pair.test.js` `fx-stamp.test.js`
- H1/H2/H4/H5/H6/H7/H9/H10/H12 under `backend/src/fin/security/`

### Stage 1 / command-service slice — 2026-08-18

**Landed on `feat/stage-1-command-service`:** sole writer `backend/src/fin/ledger/transactions.js` (C §5.0–5.19), reconciliation runner R001–R023 (`pg_try_advisory_lock(1009, 0)`), If-Match middleware + test-only tenant PATCH demonstrator, migration `110_fin_command_service.sql` (account_type_rank, idempotency `EXPIRED` + split UNIQUE, recon run status → DL-032). No silent rewrite of `commercial.*`, current Express, `postgres-adapter.js`, or `009_audit_activity.sql`.

**Addressed in this PR:**

| Item | What landed | Still LIVE / deferred |
|---|---|---|
| C sole writer | 19 commands go through one `transaction(fn)`; app code does not insert postings | Product HTTP routes still Stage 4+ |
| I-01 / I-02 on the writer | C01 / C02 named tests; bonus lots inside FUNDING (DL-034) | — |
| Transfer pair | C03 command replay returns the pair; `fin.transfer.posted` count = 1; same-book `pair_id` NULL | — |
| Idempotency E | Claim before locks; COMPLETED replay 0 rows; fingerprint conflict; expired key does not fund (C12) | Webhook path Stage 7 |
| Outbox same tx | C13: committed txs have `fin.ledger.posted` | Drain worker Stage 2 |
| Recon F | Exact §6 SQL; COMPLETED requires R001–R023 rows; R022/R023 `ERROR` on `42P01` (DL-052) | R024+ later; control-plane freeze of `account_controls` is resolution rows only in Stage 1 |
| If-Match D §6 | 428 missing; 412 `*` / weak / stale (not 409); 400 malformed (D-T12) | No `/api/admin/fin/**` (DL-053) |

**Deferred (tables not invented):** `purchase_intents` UPDATE (DL-049), `accounting_periods` HARD_CLOSED (DL-050), invoice/facility/payment cash movement (DL-051), R022/R023 green (Stage 6/8).

**Live P0s not silently patched:** A/B-1, A-2, A-4, C-1, C-2 on the DAL, E-3 on current `audit_log` writers. Historical A-3 / D-1 / D-4 stay on the register (Stage 13).

**CI rule:** if a test file name below does not appear in the **postgres** job summary, it did not run.

- `conservation.test.js` `book-containment.test.js` `transfer-pair.test.js` `fund-purchase.test.js`
- `idempotency-replay.test.js` `outbox-same-tx.test.js`
- `runner.test.js` `advisory-lock.test.js` (reconciliation, class 1009)
- `if-match.test.js`

### Stage 1 / command-service fixup — 2026-08-18

Follow-up on `feat/stage-1-command-service-fixup` after QA on `feat/stage-1-command-service` (lineage 5bcf315 / 3218123 / 565eda0). F2 spend fingerprint, F3 `captureFacility` double-random, and F4 `issueDebitNote` audit label already landed at 565eda0. This appendix is F1 + F5–F9. No `commercial.*` / DAL / `009_audit_activity.sql` edits.

| Finding | Disposition |
|---|---|
| F1 P0 R006 | Option A (DL-054): lots insert at `remaining=granted`; no issue allocation; ISSUANCE postings never get `lot_id`; R009 source excludes ISSUANCE + FUNDING/GRANT so reporting `lot_id` on issue AVAILABLE does not false-DRIFT. R006 test now plants a draw allocation with the apply trigger disabled instead of a `-1` UPDATE on an already-drifted lot. |
| F2 | Already at 565eda0. Guard test: `spend()` replay with only `idempotencyKey` (no `ratedUsageId`). |
| F3 | Already at 565eda0 (`reservationId` hoisted). |
| F4 | Already at 565eda0 (`DEBIT_NOTE_ISSUED`). |
| F5 | `releaseHold` fingerprint uses `input.commandName` (CaptureHold / VoidHold / ExpireHold). |
| F6 | Missing/not-APPROVED approval → `APPROVAL_NOT_APPROVED` (DL-055). `APPROVAL_FOUR_EYES_REQUIRED` untouched. |
| F7 | `HOLD_NOT_OPEN` / `HOLD_ALREADY_TERMINAL` / `HOLD_EXPIRED` / `HOLD_DOUBLE_CAPTURE` split. `HOLD_EXPIRED` is capture/void on an OPEN hold past `expires_at`; ExpireHold is the legal TTL path. |
| F8 | CaptureHold + VoidHold write `authorization_attempts` AUTHORIZED. ExpireHold skipped (DL-056). |
| F9 | `issueCreditNote` (units+bookId) passes `audit: 'CREDIT_NOTE_ISSUED'` through `refundPurchase`. |

**CI rule:** `conservation.test.js` `book-containment.test.js` `transfer-pair.test.js` `fund-purchase.test.js` `idempotency-replay.test.js` `outbox-same-tx.test.js` `runner.test.js` `advisory-lock.test.js` `if-match.test.js` must appear in the postgres job summary.

### Stage 2 / usage ingest — 2026-08-19

**Landed on `feat/stage-2-usage-ingest`:** migrations `111_fin_usage_events.sql` / `112_fin_meters.sql` / `113_fin_metered_usage.sql`, writer `backend/src/fin/usage/ingest.js`, DLQ worker `backend/src/fin/usage/dlq-worker.js`, recon R030–R039. Parallel `fin.*` path only. `backend/src/billing/events.js` untouched. No `commercial.*` writes. Metering pipeline (`fin.metered_usage` writes) and rating (`fin.rated_usage`) are not stubbed — Stages 3 and 5. Product/webhook wiring is Stage 13.

**Addressed in this PR (replacement writers, not patches of live P0s):**

| Finding | What landed | Still LIVE / deferred |
|---|---|---|
| A/B-1 usage INSERT split from `recordConsumption` | `ingestUsageEvent` writes facts-only `fin.usage_events` inside `transaction(fn)`. No `recordConsumption`. Value movement stays Stage 6 commands | `events.js` still splits INSERT + consume on `commercial.*` until Stage 13 cutover |
| A-2 swallow / no DLQ | Missing partition / DB error → `fin.usage_events_dlq` with `error_code` (`PARTITION_MISSING` / `DB_ERROR` / `SCHEMA_INVALID` / `ENV_MISMATCH`), `attempts=1`, `next_retry_at=+60s`. Return `{ ok:false, dlq_id, error_code }`. Never null, never throw on DB failure. Worker class 1005 retries; dead-letter at 5. `USAGE_DLQ` audit row on every landing | `events.js:153-156` still swallows. Metric `wingcaster_usage_event_emit_total` not wired to Prometheus (Stage 12/ops) |
| DL-007 facts-only | Schema probe + F R032: no `price_minor` / `casts_charged` / `rate_card_version` on `fin.usage_events` | — |
| DL-009 permanent dedup | `UNIQUE (environment, source_system, source_event_id, residency_key)` + `ON CONFLICT DO NOTHING`. F R030 | — |
| DL-021 / M1 composite FK | `corrects_event_id+corrects_residency_key` and `metered_usage_sources (usage_event_id, residency_key)` | `vendor_usage_events` is Stage 11 |
| DL-013 residency_key | LIST partitions per `platform_legal_entities.residency_key` + `__platform__` default cell. Legal-entity INSERT creates the partition. Unknown key → PARTITION_MISSING, not a catch-all DEFAULT | — |

**Deferred (do not silently patch):**

| Item | Why |
|---|---|
| Cutover of `emitUsageEvent` / product / webhook callers | Stage 13. This PR must not write `commercial.*` or wire ingest into existing HTTP paths |
| Metering writes to `fin.metered_usage` | Stage 3. Tables exist; ingest does not populate them |
| Rating `fin.rated_usage` | Stage 5 |
| A-4 `ai_credit_*` second ledger | Stage 6/7 + 13 |
| C-1 pricing PATCH throws | Stage 4 |
| Historical A-3 / D-1 / D-4 backfill | Stage 13 `source_system='backfill_v1'` |

**CI rule:** if a test file name below does not appear in the **postgres** job summary, it did not run.

- `ingest.test.js` `facts-only.test.js` `no-double-charge.test.js` `partition-missing.test.js`
- `dlq-retry.test.js` `composite-fk.test.js` `source-dedup.test.js`
- `111_fin_usage_events.postgres.test.js` `112_fin_meters.postgres.test.js` `113_fin_metered_usage.postgres.test.js`
- `partition-ddl-lock.test.js` `rls-usage-pre-attribution.postgres.test.js`
- `r030-r039.test.js` `runner.test.js`

### Stage 3 / metering — 2026-08-19

**Landed on `feat/stage-3-metering`:** aggregator `backend/src/fin/metering/{filter,pipeline,worker}.js`, migration `114_fin_metering.sql` (SUPERSEDED-only UPDATE grant + one-ACTIVE unique), advisory class `FIN_METERING = 1013`. Parallel `fin.*` path only. Does not write `fin.rated_usage` (Stage 5) or consume lots (Stage 6). `backend/src/billing/events.js` untouched. `fin.usage_events` / `ingest.js` untouched.

**Addressed in this PR (aggregator downstream of Stage 2's fact writer — advances A/B-1, does not close it):**

| Finding | What landed | Still LIVE / deferred |
|---|---|---|
| A/B-1 usage INSERT split from `recordConsumption` | `meterPeriod` aggregates facts-only `fin.usage_events` into `fin.metered_usage` inside `transaction(fn)`. No `recordConsumption`. Value movement stays Stage 6 | `events.js` still splits INSERT + consume on `commercial.*` until Stage 13. End-to-end close is Stage 5 rating + Stage 6 authorize |
| I-09 / I-10 metering provenance | Sources use composite FK `(usage_event_id, residency_key)` (DL-021). R035 SUM(contributions) ≡ ACTIVE quantity. R036 SUPERSEDED has a successor | Rating `fin.rated_usage` is Stage 5 |
| DL-007 facts-only | Metering reads quantity/dimensions/event_type only; never price columns | — |

**Deferred (do not silently patch):**

| Item | Why |
|---|---|
| Cutover of `emitUsageEvent` / product / webhook callers | Stage 13 |
| Rating `fin.rated_usage` | Stage 5. `TIME_WEIGHTED` fractional-second grain is a Stage 5 nit (DL-066) |
| Authorize / `recordConsumption` replacement | Stage 6 — this is what closes A/B-1 end-to-end |
| A-4 `ai_credit_*` second ledger | Stage 6/7 + 13 |
| C-1 pricing PATCH throws | Stage 4 |
| Historical A-3 / D-1 / D-4 backfill | Stage 13 |
| Scheduler / cron / k8s wiring of `runMeteringTick` | Ops; this PR ships the runnable function |

**CI rule:** if a test file name below does not appear in the **postgres** job summary, it did not run.

- `pipeline.test.js` `filter.test.js` `advisory-lock.test.js` `correction-handling.test.js`
- `r035-r039.test.js` `runner.test.js` `runner-metered-green.test.js`

### Stage 4 / pricing admin — 2026-08-19

**Landed on `feat/stage-4-pricing`:** migrations `115_fin_prices.sql` / `116_fin_contracts.sql` / `117_fin_pricing_hooks.sql`, command service `backend/src/fin/pricing/{prices,contracts}.js`, first real `/api/admin/fin/**` surface (`backend/src/fin/admin/pricing/routes.js`) with the 7f/3 writeGuards array plus `adminMutationLimiter` (H §5) and Stage 1 `requireIfMatch`. Parallel `fin.*` path only. `backend/src/billing/pricing/**` is **not** patched.

**C-1 is REPLACED by this surface, not fixed in place.** Every PATCH under `/api/admin/pricing/*` still throws at the nine `update(coll, {id}, changes)` call sites. Those commercial paths remain broken until Stage 13 cutover — that is the audit register's point. A drive-by DAL-signature fix on `commercial.*` is out of Stage 4 scope (DL-011).

**Addressed in this PR (replacement writers + success-path tests):**

| Finding | What landed | Still LIVE / deferred |
|---|---|---|
| C-1 pricing PATCH throws | `fin.prices` / `fin.price_versions` / `fin.price_tiers` / `fin.price_dimensions` + `fin.contracts` / versions / components. Named commands inside `transaction(fn)`. Success-path real-Postgres tests in `prices.test.js`, `contracts.test.js`, `routes.test.js` | Live `/api/admin/pricing/*` still throws. Stage 13 cutover |
| C-2 lost updates | Header `+occ` + If-Match on every admin POST. 428 missing / 412 stale / 200 matching | `postgres-adapter.js` `update()` unchanged |
| E12 admin limiter | `backend/src/lib/admin-limiter.js` 10/5m on every Stage 4 mutation | Other admin mutations still Stage 12 |
| E1/E2 step-up | All 9 POST routes in `phase-7f3-wiring.test.js` plus a 11-route inventory (2 GETs are readGuards only) | — |

**Deferred (do not silently patch):**

| Item | Why |
|---|---|
| Cutover of `registerPricingRoutes` / `billing/pricing/{cities,zones,territories,core-rate-cards}.js` | Stage 13. This PR must not write `commercial.*` |
| Rating `fin.rated_usage` (R040–R046, R049) | Stage 5. Checks are wired and stay ERROR on `42P01` |
| `fin.credit_facilities` FK on `contract_components.facility_id` | Stage 8 (DL-071) |
| ResumeContract / ExpireContract / Resume workers | Not in the Stage 4 command list |
| Historical A-3 / D-1 / D-4 backfill | Stage 13 |

**CI rule:** if a test file name below does not appear in the **postgres** job summary, it did not run.

- `prices.test.js` `contracts.test.js` `append-only.test.js`
- `routes.test.js` (under `backend/src/fin/admin/pricing/`)
- `r040-r049.test.js` `runner.test.js` `runner-priced-green.test.js`
- `phase-7f3-wiring.test.js` (fast suite; also lists the 11 new routes)

### Stage 5 / rating — 2026-08-19

**Landed on `feat/stage-5-rating`:** migration `118_fin_rated_usage.sql`, engine `backend/src/fin/rating/{engine,worker}.js`, advisory class `FIN_RATING = 1014`. Parallel `fin.*` path only. Does not write `ledger_transactions` / postings (C §6). `backend/src/billing/events.js` untouched. Metering / ingest / pricing writers untouched.

**Addressed in this PR (aggregator downstream of Stage 3's metered_usage — advances A/B-1, does not close it):**

| Finding | What landed | Still LIVE / deferred |
|---|---|---|
| A/B-1 usage INSERT split from `recordConsumption` | `rateMeteredUsage` converts ACTIVE `fin.metered_usage` into APPEND_ONLY `fin.rated_usage` inside `transaction(fn)`. No `recordConsumption`. Value movement stays Stage 6 | `events.js` still splits INSERT + consume on `commercial.*` until Stage 13. End-to-end close is Stage 6 authorize |
| F R040–R046 | Table exists. R040 hasher closed (DL-082). R041 re-rate-is-new-row. R045 billable_units CHECK + writer. R046 contract currency. R042/R043/R044/R049 stay ERROR on missing Stage 9/10 tables (DL-080 / DL-052) | Authorize / invoice lines / period gates |
| DL-007 facts-only | Rating writes `rated_usage` only; no price columns on usage_events | — |

**Deferred (do not silently patch):**

| Item | Why |
|---|---|
| Cutover of `emitUsageEvent` / product / webhook callers | Stage 13. This PR must not write `commercial.*` or touch `billing/events.js` |
| Authorize / `recordConsumption` replacement | Stage 6 — this is what closes A/B-1 end-to-end |
| `late_class` other than `OPEN_PERIOD`; `billing_period_id` / `accounting_period_id` FKs | Stage 9 / 10 (DL-080) |
| Rating DLQ for `FIN_NO_ACTIVE_CONTRACT` / `FIN_NO_ACTIVE_PRICE` | Not invented (DL-081) |
| A-4 `ai_credit_*` second ledger | Stage 6/7 + 13 |
| Historical A-3 / D-1 / D-4 backfill | Stage 13 |
| Scheduler / cron / k8s wiring of `runRatingTick` | Ops; this PR ships the runnable function |

**CI rule:** if a test file name below does not appear in the **postgres** job summary, it did not run.

- `engine.test.js` `append-only.test.js` `worker.test.js` (under `backend/src/fin/rating/`)
- `r040-r046.test.js` `runner-rated-green.test.js` `runner.test.js`

### Stage 6 / authorize + capture — 2026-08-20

**Landed on `feat/stage-6-authorize`:** auth engine `backend/src/fin/auth/{lot-resolver,authorize,spend,capture,void,expiry-worker}.js`, migration `119_fin_hold_allocation_fk.sql` (DL-085 deferred `lot_allocations.hold_id`), `ingestUsageEventWithClient` (DL-084), `meterPeriod({ sourceEventId })` (DL-086). Parallel `fin.*` path only. `backend/src/billing/events.js` and `backend/src/fin/ledger/transactions.js` untouched. No `/api/admin/fin/**` (Stage 12). No `commercial.*` writes.

**Follow-up (2026-08-20):** ingest.test.js dedup `toEqual` includes `residencyKey` (DL-084 return shape). `authorizeUsage` throws `IDEMPOTENCY_KEY_REQUIRED` when no idempotency anchor is supplied (DL-089) and fingerprints `actionKey`/`category`/`vendorId` (DL-090).

**A/B-1 is CLOSED for the `fin.*` path.** `spendCredits` is the one function product code will call: ingest + meter + rate + authorize + capture share one `transaction(fn)` end-to-end. The live `emitUsageEvent` split (`events.js:135` then `:142`) remains until Stage 13 cutover.

**Addressed in this PR:**

| Finding | What landed | Still LIVE / deferred |
|---|---|---|
| A/B-1 usage INSERT split from `recordConsumption` | `spendCredits` ingest + `meterPeriod` + `rateMeteredUsage` + `authorizeUsage` / `directSpend` + optional `captureHold` inside one `transaction(fn)`. Rating failure rolls the whole tx back (asserted). | `events.js` still splits INSERT + consume on `commercial.*` until Stage 13 |
| B §3.1 denied attempts | `authorization_attempts` DENIED with `INSUFFICIENT_ELIGIBLE_CREDITS` / `LIMIT_BLOCKED`. No hold row on denial | Facility shortfall (Stage 8) |
| D §5 expiry | `runHoldExpiryTick` advisory 1002, book `FOR UPDATE NOWAIT`, 55P03 skip | Scheduler wiring is ops |
| F R020 / R021 | Real authorize + capture makes them GREEN with data. R022 GREEN on empty/matching counters. R023 stays ERROR (`facility_reservations` missing, DL-052) | Stage 8 facility cover |

**Deferred (do not silently patch):**

| Item | Why |
|---|---|
| Cutover of `emitUsageEvent` / product / webhook callers | Stage 13. This PR must not write `commercial.*` or touch `billing/events.js` |
| `DirectSpendPostpaid` / facility fallback | Stage 8. Uncovered prepaid → `INSUFFICIENT_ELIGIBLE_CREDITS` |
| A-4 `ai_credit_*` second ledger | Stage 6/7 + 13 — consume path exists; wa_listings is not wired |
| Historical A-3 / D-1 / D-4 backfill | Stage 13 |
| Scheduler / cron / k8s wiring of `runHoldExpiryTick` | Ops; this PR ships the runnable function |

**CI rule:** if a test file name below does not appear in the **postgres** job summary, it did not run.

- `lot-resolver.test.js` `authorize.test.js` `spend.test.js` `capture-void.test.js` `expiry-worker.test.js` (under `backend/src/fin/auth/`)
- `r020-r021.test.js` `runner-rated-green.test.js` `runner.test.js`

### Stage 7 / funding — 2026-08-20

**Landed on `feat/stage-7-funding`:** migrations `170_fin_purchase_intents.sql` / `171_fin_grants_transfers.sql` (`credit_products` + `auto_topup_policies`; no `fin.grants` / `fin.transfers` — DL-096), command service `backend/src/fin/funding/{products,quotes,purchase-intents,paid-lots,auto-topup-worker,http}.js` + `psp/{index,stripe}.js`, advisory class `FIN_PURCHASE_INTENT = 1015` (DL-091; `FIN_AUTO_TOPUP` remains 1010). Parallel `fin.*` path only. `backend/src/billing/events.js` and `backend/src/fin/ledger/transactions.js` untouched. No `/api/admin/fin/**` (Stage 12). No `commercial.*` writes.

**UN-501:** `/api/agent/credits/top-up` and `/api/agency/credits/top-up` route to `createPurchaseIntent` + `submitPurchasePayment` when `FIN_FUNDING_ENABLED` is on **and** a `fin.tenants` row exists for the public tenant. Otherwise they still return 501 (`topup_unavailable`). Gate is HTTP-only (DL-093). `POST /webhooks/stripe` verifies Stripe signatures and calls `confirmWebhook` (401 unsigned; 409 IN_FLIGHT).

Follow-up (2026-08-20): R057/R058 moved to the end of the CHECKS array so runner.test.js line 28 passes. Three deferred hardenings logged as DL-101 (env/now from req.body), DL-102 (single CUSTOMER book per billing_account UNIQUE), DL-103 (withRetry only covers 40P01).

**Addressed in this PR:**

| Finding | What landed | Still LIVE / deferred |
|---|---|---|
| §49 `purchase_intents` missing / top-up 501 | Full B §4 machine; UNIQUE(provider, provider_event_id) never expires; FUNDING paid+bonus lots (DL-092) | commercial.* top-up/ledger until Stage 13 |
| PSP retries double-charge (E-10 class) | Claim `wh:STRIPE:{event_id}` before apply; unique hit on a different intent → `PURCHASE_PROVIDER_EVENT_REUSED`; in-flight → 409 not 200 | Non-money Stripe events still OPEN (E §5.3) |
| Auto top-up inline charge | Worker emits intent + `webhook.stripe`; spend/capture that trips the threshold does not submit (DL-094) | Scheduler / cron wiring is ops |
| F R057 / R058 | Wired; GREEN after a real confirm | R050–R056 / R059 Stage 8 (DL-099) |

**Deferred (do not silently patch):**

| Item | Why |
|---|---|
| `refundPurchase` / REFUND ledger tx | Stage 10 (DL-095) |
| `GrantCredits` / `TransferCredits` new tables | Already Stage 1 commands; no `fin.grants` (DL-034 / DL-096) |
| Airwallex / Areeba adapters | Stage 8+; interface is pluggable |
| Cutover of `ai_credit_*` / `events.js` | Stage 13. This PR must not write `commercial.*` or touch `billing/events.js` |
| Live Stripe SDK charge | After-commit adapter returns a TEST client_secret when `STRIPE_SECRET_KEY` is unset; worker wiring is ops |
| B13 disputes / B22 payments machines | Tables are Stage 8/10 (DL-099) |
| Scheduler / cron of `runAutoTopupTick` | Ops; this PR ships the runnable function |

**CI rule:** if a test file name below does not appear in the **postgres** job summary, it did not run. `products.test.js` / `quotes.test.js` / `stripe.test.js` are fast-suite-valid (they also contain or share a file with postgres where noted).

- `products.test.js` `quotes.test.js` `stripe.test.js` (fast; products also has a postgres create)
- `purchase-intents.test.js` `fund-purchase.test.js` `psp-retry.test.js` `auto-topup.test.js` (under `backend/src/fin/funding/`)
- `runner-funded-green.test.js` `r057-r058.test.js` `runner.test.js`

### Stage 8 / postpaid — 2026-08-20

**Landed on `feat/stage-8-postpaid`:** migrations `180_fin_credit_facilities.sql`, `181_fin_facility_reservations.sql`, `182_fin_dunning.sql`, `183_fin_hold_facility_link.sql`. Command services `backend/src/fin/postpaid/{facilities,reservations,hybrid-resolver,capture,capture-hybrid,direct-spend,expiry-worker,helpers}.js` and `backend/src/fin/dunning/{cases,steps,worker}.js`. Advisory classes `FIN_FACILITY_RESERVATION_EXPIRY = 1017`, `FIN_CREDIT_FACILITY = 1018`. Stage 6 `authorize.js` consults the hybrid resolver for facility shortfall (only authorized cross-stage edit). `spend.js` captures a linked facility reservation after Stage 1 `captureUsage`. Parallel `fin.*` path only. `backend/src/billing/events.js` and Stage 1 `ledger/transactions.js` / `write.js` untouched. No `/api/admin/fin/**` (Stage 12).

**Decision log:** DL-104 … DL-112.

**Spec §122 postpaid acceptance (10):**

| # | Test | Where | Status |
|---|---|---|---|
| 1 | Facility header B §18 transitions | `postpaid/facilities.test.js` | Landed |
| 2 | Reservation OPEN→CAPTURED/RELEASED/EXPIRED | `postpaid/reservations.test.js` | Landed |
| 3 | Concurrent reserve over limit | `postpaid/reservations.test.js` | Landed |
| 4 | FACILITY_DRAW `remaining_units = 0` after capture | `postpaid/capture-postpaid.test.js` | Landed |
| 5 | DirectSpendPostpaid no hold | `postpaid/direct-spend-postpaid.test.js` | Landed |
| 6 | Hybrid prepaid-then-facility covers Stage 6 denial | `hybrid-resolver.test.js` + authorize wiring | Landed (pure + authorize path) |
| 7 | Dunning B §6 + snapshot restore | `dunning/cases.test.js` | Landed |
| 8 | Dunning steps APPEND_ONLY | `dunning/steps.test.js` | Landed |
| 9 | Receivable / revenue event at capture | — | Deferred Stage 10 (DL-106 / DL-109) |
| 10 | Invoice PAID cures dunning | — | Deferred Stage 10 (DL-109) |

**F R05x:** R050 (limit ≥ OPEN reserved, slack GREEN), R051 (CAPTURED has CONSUMED posting), R052 (FACILITY_DRAW remaining 0) landed. F invoice R052 / R053 need `fin.invoices` — R053 registered as 42P01 ERROR (DL-109).

**Still LIVE on commercial.\* until Stage 13 cutover:** commercial wallet, commercial dunning/email, commercial postpaid invoices. This PR does not write `commercial.*`.

**CI file list (must appear in the postgres job summary):**
`postpaid/hybrid-resolver.test.js`, `postpaid/facilities.test.js`, `postpaid/reservations.test.js`, `postpaid/capture-postpaid.test.js`, `postpaid/direct-spend-postpaid.test.js`, `postpaid/expiry-worker.test.js`, `dunning/cases.test.js`, `dunning/steps.test.js`, `dunning/worker.test.js`, `reconciliation/r050-r053.test.js`, `reconciliation/runner-postpaid-green.test.js`.

Follow-up (2026-08-20): R050–R053 reordered in CHECKS so insertion order matches alphabetical (runner.test.js line 28). Stray R023.result=ERROR assertions in runner-funded-green.test.js and r020-r021.test.js flipped to GREEN (R023 was refactored to reservations-orphan in Stage 8). DL-113 logged for the spend.js → authorize.js amountMinor pass-through, reserved for Stage 10.

Follow-up #2 (2026-08-20): insertControls now uses ON CONFLICT DO NOTHING (test isolation). Three sibling all-green runners updated to swap R023 for R053 in ERROR_CODES. Facility default idempotency key now includes cmdName and loaded facility.version so activate/resume and repeated resumes never collide (DL-114). Postpaid CAPTURE now inserts matching lot_allocations for FACILITY_DRAW (DL-115).
