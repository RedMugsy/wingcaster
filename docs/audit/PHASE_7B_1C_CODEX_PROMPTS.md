# Phase 7b.1c — Hardening Sprint from Re-Audit (Codex Prompt Pack)

**Why this exists.** The Phase 7b.1b closure was retracted after a
second-opinion audit found three new P0 defects and demonstrated that
7b.1b's QA methodology (stubbed DALs + skipped Postgres tests) was
insufficient. This sprint fixes the P0s, sweeps residual highs the
re-audit surfaced, and — most importantly — changes the verification
bar.

**New rule for this sprint.** No commit closes without real-Postgres
verification. The `TEST_DATABASE_URL`-gated tests we skipped in 7b.1b
are now mandatory. If a prompt touches persistence, its tests must run
against a Postgres+PostGIS cluster and pass.

**How to use.** Same pattern as 7b.1a and 7b.1b: SHARED PRIMER + ONE
numbered prompt per Codex session, in order. Prompt 12 lays the test
infrastructure the rest of the sprint depends on.

---

## SHARED PRIMER (prepend to every prompt)

You are implementing one focused change in the Wingcaster codebase — a
multi-tenant SaaS for real-estate agents.

**Repo.** `E:\Projects\Real Estate Companion`. Branch: `main`.
Standing push permission granted. One task = one commit. Push after
each commit.

**Stack.**
- Backend: Node.js 20+, ES modules, Express 4, Postgres 14+
  **with PostGIS extension**, Pino logging.
- Persistence DAL: `backend/src/db.js` re-exports from
  `backend/src/persistence/`. See `table-mapper.js` for the
  collection-to-table routing.
- Tests: Vitest. Backend test script is `npm test`.

**Code rules — no exceptions.**
- Never introduce demo modes, simulator paths, or "wired later"
  scaffolding. If a required dependency (credential, DB, env var) is
  missing, throw a clear error at startup or first request. Never
  return fake data.
- Never add error handling for scenarios that can't happen. Trust
  framework guarantees. Only validate at system boundaries.
- No comments unless a non-obvious constraint or workaround needs
  explaining.
- Do NOT refactor unrelated code. File follow-ups in the commit
  message.

**NEW methodology rule for THIS sprint (7b.1c).**
- Any change that touches persistence, migrations, or a DB-writing
  code path MUST have tests that run against real Postgres with
  PostGIS.
- Use the harness from Prompt 12 (`backend/src/testing/postgres.js`).
- Gate real-Postgres tests on `TEST_DATABASE_URL`. Locally:
  ```
  docker run -d -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgis/postgis:16-3.4
  export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
  cd backend && npm test
  ```
- Report BOTH `npm test` runs in your commit message: with AND
  without `TEST_DATABASE_URL`. The real-Postgres run must be green.
  A commit whose Postgres tests are only skipped is not eligible.
- If a specific prompt says "no real-DB test needed" explicitly,
  that's the only exemption.

**Commit style:** imperative subject under ~72 chars. Body explains
why + non-obvious mechanics. Include the "npm test with real
Postgres" evidence. Trailer:
```
Co-Authored-By: Codex <noreply@openai.com>
```

**Do push.** User has granted standing push permission for this project.

---

## PROMPT 12 — Real-Postgres test harness

### Task
Ship the test infrastructure the rest of this sprint requires:
Docker-compose for local PostGIS, a `TestDatabase` helper that
creates a scratch schema per test run, runs the migrations, and
tears down cleanly. No feature work in this commit.

### Why first
Every subsequent prompt in this sprint verifies against real
Postgres. Without this harness, verification is not possible.

### Files to create
- `backend/docker-compose.test.yml`
- `backend/src/testing/postgres.js`
- `backend/src/testing/postgres.test.js`
- `backend/scripts/test-with-postgres.sh` (bash + `.cmd` Windows wrapper)
- Update `backend/package.json`: add `"test:pg": "..."` script.

### Requirements

1. **`docker-compose.test.yml`:**
   ```yaml
   services:
     postgres:
       image: postgis/postgis:16-3.4
       environment:
         POSTGRES_PASSWORD: postgres
         POSTGRES_DB: wingcaster_test
       ports: ["5433:5432"]
       tmpfs: ["/var/lib/postgresql/data"]   # ephemeral for speed
       healthcheck:
         test: ["CMD-SHELL", "pg_isready -U postgres"]
         interval: 1s
         timeout: 3s
         retries: 30
   ```

2. **`backend/src/testing/postgres.js`** exports:
   ```js
   export async function createTestDatabase(name?)  // returns { url, teardown }
   export async function withTestDb(fn)             // fn(url) → auto-teardown
   export function skipIfNoPostgres()               // vitest helper
   ```
   - `createTestDatabase` connects to the pool from `TEST_DATABASE_URL`,
     creates a fresh schema `test_<random>` with `CREATE SCHEMA`, sets
     `search_path`, and runs `runMigrations()` scoped to that schema.
   - `teardown` drops the schema `CASCADE`.
   - `skipIfNoPostgres` returns a `describe.skipIf` matcher so tests
     that need Postgres are auto-skipped when `TEST_DATABASE_URL` is
     unset, with a clear "not run" message in stdout.

3. **`postgres.test.js`** proves the harness works: create schema,
   verify a table from migration 002 exists, verify PostGIS extension
   present, teardown. Skips itself when `TEST_DATABASE_URL` unset.

4. **`test-with-postgres.sh`** (+ `.cmd` for Windows):
   - Starts docker-compose stack.
   - Waits for healthcheck.
   - Exports `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/wingcaster_test`.
   - Runs `npm test`.
   - Tears down (unless `KEEP_POSTGRES=1`).

5. **`package.json`**:
   ```
   "test:pg": "bash scripts/test-with-postgres.sh",
   "test:pg:keep": "KEEP_POSTGRES=1 bash scripts/test-with-postgres.sh"
   ```

6. **Documentation:** `backend/docs/testing-with-postgres.md`
   (create if `docs/` doesn't exist there) — one page explaining
   how to run tests locally, in CI, and against a remote DB.

### Non-goals
- No CI wiring yet — that lands in a Phase 8 deployment sprint.
- No feature tests added yet — subsequent prompts add them.

### Commit message
```
phase 7b.1c/12 — real-postgres test harness

Enables every subsequent 7b.1c prompt to verify against real
Postgres+PostGIS, the methodology gap that let 7b.1b close on
stubbed tests.

- docker-compose.test.yml: postgis/postgis:16-3.4 on port 5433
  with tmpfs storage for speed.
- src/testing/postgres.js: createTestDatabase + withTestDb + a
  skipIfNoPostgres vitest helper. Creates per-run scratch schemas
  so parallel tests don't collide.
- scripts/test-with-postgres.sh + .cmd: one-command local runner
  that spins up docker, exports TEST_DATABASE_URL, runs the suite,
  tears down.
- package.json: "test:pg" and "test:pg:keep".
- docs/testing-with-postgres.md: usage guide.

Test evidence:
- npm test (no TEST_DATABASE_URL): <count> pass, <count> skipped
- npm run test:pg: <count> pass, 0 skipped, harness self-test green

Co-Authored-By: Codex <noreply@openai.com>
```

### QA checklist
- [ ] `docker-compose.test.yml` starts a healthy PostGIS container.
- [ ] `postgres.js` creates + tears down schemas cleanly.
- [ ] Every skipped test now has a `skipIf(!TEST_DATABASE_URL)`
      that surfaces "REQUIRES REAL POSTGRES" in output.
- [ ] `npm run test:pg` boots docker, runs suite, tears down.

---

## PROMPT 13 — P0-1: Close registration platform-admin takeover

### Task
Registration currently trusts `otp_verified: true` from the client
AND grants `platform_admin` role based solely on `ADMIN_EMAIL`
match. An attacker who knows a configured admin email registers with
`otp_verified: true` and receives a JWT with platform-admin
authority. Fix both trust boundaries.

### Context (from re-audit)
- Client-trusted flag: [validation.js:44](backend/src/lib/validation.js:44)
- Registration converts it directly: [server.js:902](backend/src/server.js:902)
- Admin grant on email match: [server.js:920](backend/src/server.js:920)
- JWT issued immediately: [server.js:971](backend/src/server.js:971)
- Login doesn't enforce verified status: [server.js:984](backend/src/server.js:984)

### Files to touch
- `backend/src/lib/validation.js`
- `backend/src/server.js`
- `backend/src/auth.js` (if platform-admin grant lives there)
- `backend/src/lib/otp.js` (verify integration point)
- New: `backend/src/auth.test.js` additions covering the fix
  cases below. Must run against real Postgres.

### Requirements

1. **Strip `otp_verified` from the registration schema.** Never
   accept it from the client. The flag is now derived server-side
   only.

2. **Registration flow:**
   - Creates the user with `verified: false`.
   - Returns 202 with `{ status: "otp_sent", otp_id }`. No JWT
     issued.
   - Actual OTP is sent via `lib/otp.js` (or throws
     `OTP_TRANSPORT_UNCONFIGURED` at request time — Prompt 16
     handles the transport gate).

3. **New endpoint `POST /api/auth/verify-otp`:**
   - Body: `{ otp_id, code }`.
   - Verifies the code against the stored `otp_verifications` row.
   - On success, flips the user's `verified: true` AND issues the
     JWT.
   - Fails with 401 on wrong code, 410 on expired, 429 after 5
     failed attempts in 15 min.

4. **Platform-admin grant is NOT triggered by email match at
   registration.** New policy:
   - `platform_admin` is granted only via an explicit
     server-side seed OR admin console action.
   - Environment variables `ADMIN_EMAIL` and `SMOKE_ADMIN_EMAIL`
     still control the initial-seed admin, but that seed runs at
     boot (via `seed.js`), not at registration time. If a user
     later registers with that email, they still start as a
     regular user; the seeded admin row is separate.

5. **Login enforces verified status.** `POST /api/auth/login` returns
   401 `{ error: "email_not_verified", otp_id }` if the user's
   `verified` flag is false. Client can re-request an OTP via
   `POST /api/auth/request-otp`.

6. **Existing token invalidation:** any JWT issued to a user who is
   NOT verified at token-claim time must be rejected by
   `authMiddleware`. Add a `verified_at` claim; middleware rejects
   tokens missing it.

### Tests (real Postgres required)
- Registration with `otp_verified: true` in the body is silently
  ignored — user still starts as unverified.
- Registration with the configured `ADMIN_EMAIL` does NOT grant
  admin — the user is a regular unverified user until they verify.
  A separate seed row for that email exists as admin.
- Verify-OTP with correct code flips `verified: true` and issues a
  JWT with `verified_at`.
- Verify-OTP wrong code fails; 5 wrong codes in 15 min lock the
  attempts.
- Login of an unverified user returns 401 with `otp_id`.
- An old JWT without `verified_at` claim is rejected by
  `authMiddleware`.
- Seed script creates the admin row for `ADMIN_EMAIL` — verifiable
  via `agents.platform_role === 'admin'`.

### Non-goals
- Do NOT change the OTP transport (that's Prompt 16).
- Do NOT add rate-limiting to registration itself in this commit.
- Do NOT change password rules.

### Commit message
```
phase 7b.1c/13 — close registration platform-admin takeover (P0)

Two independent trust bugs that combined into a full platform-admin
takeover:
1. Registration accepted a client-supplied otp_verified boolean and
   set the user's verified state from it directly.
2. Platform-admin role was granted at registration time if the
   supplied email matched ADMIN_EMAIL, regardless of verification.

An attacker knowing an unregistered ADMIN_EMAIL got platform-admin
authority in one HTTP call.

Fix:
- Removed otp_verified from the registration schema entirely.
- Registration returns 202 + otp_id, never a JWT.
- New POST /api/auth/verify-otp verifies the code and only THEN
  issues a JWT with a verified_at claim.
- Login rejects unverified users with otp_id in the 401 body.
- authMiddleware rejects tokens missing verified_at.
- Platform-admin is now a seed-only or admin-console action;
  ADMIN_EMAIL match at registration is ignored.

Real-Postgres verification:
- <N> integration tests, all pass with TEST_DATABASE_URL set.
- Specifically: attempted takeover payload results in an unverified
  regular user; separate admin seed row confirmed for ADMIN_EMAIL.

Co-Authored-By: Codex <noreply@openai.com>
```

### QA checklist
- [ ] Registration ignores otp_verified client input.
- [ ] Login rejects unverified users.
- [ ] Platform-admin grant is seed/console only.
- [ ] Real-Postgres test suite green.
- [ ] Existing users in a migrated DB: what happens? (Document.)

---

## PROMPT 14 — P0-2: Fix property persistence broken by generated `geom` column

### Task
Migration 024 makes `properties.geom` a `GENERATED ALWAYS AS ...
STORED` column. But `table-mapper.js` still lists `geom` as a
writable column, so every property INSERT/UPDATE fails against the
migrated schema with `cannot insert a non-DEFAULT value into column
"geom"`.

Fix + audit every OTHER mapped table for the same class of bug.

### Context (from re-audit)
- Generated column: [024_market_pricing.sql:223](backend/src/persistence/migrations/024_market_pricing.sql:223)
- Mapper writes it anyway: [table-mapper.js:182](backend/src/persistence/table-mapper.js:182)
- Adapter supplies all mapped columns: [postgres-adapter.js:148](backend/src/persistence/postgres-adapter.js:148), [152](backend/src/persistence/postgres-adapter.js:152)

### Files to touch
- `backend/src/persistence/table-mapper.js`
- `backend/src/persistence/postgres-adapter.js` (defence-in-depth)
- New: `backend/src/persistence/generated-columns.js`
- Integration test: `backend/src/persistence/dal.integration.test.js`

### Requirements

1. **Remove `geom` from `properties` columns in `table-mapper.js`.**
2. **Grep every migration for `GENERATED ALWAYS AS`.** For each hit,
   confirm the mapper does NOT list that column. If it does, remove
   it. List every match + disposition in the commit message.

3. **Belt-and-braces in the adapter.** Add a runtime allowlist:
   `backend/src/persistence/generated-columns.js` exports a
   `GENERATED_COLUMNS_BY_TABLE` map (populate from migration grep).
   The adapter strips these columns from the INSERT/UPDATE column
   list before generating SQL. This catches future generated columns
   the mapper wasn't updated for.

4. **Audit for the OTHER class of mapper defect the re-audit surfaced:**
   mapped tables with NO corresponding CREATE TABLE migration. Listed
   examples: `profile_followers`, `profile_views`, `reviews`,
   `transactions`. For each: either write the CREATE TABLE migration
   or remove the mapper entry. Do NOT invent tables — if you're not
   sure whether the table should exist, remove the mapper entry and
   file the follow-up in the commit message.

5. **Audit for the THIRD class of mapper defect:** columns the mapper
   writes that the migration doesn't have. Cross-check every mapped
   table's `columns` against the actual CREATE TABLE / ALTER TABLE
   history. Remove misaligned entries.

### Tests (real Postgres required)
- Real-Postgres integration test: create a property with lat/lng,
  verify the row inserts, verify `geom` is populated by the
  generated expression (queryable via
  `ST_AsText(geom)`).
- Update a property's lat/lng: verify `geom` updates automatically.
- Any mapped table added or corrected: at least one insert +
  round-trip test.

### Non-goals
- Do NOT change the `properties` schema itself.
- Do NOT redesign the DAL API.

### Commit message
```
phase 7b.1c/14 — fix property persistence broken by generated geom (P0)

Migration 024 declared properties.geom as GENERATED ALWAYS AS ...
STORED, but table-mapper.js still listed geom among writable
columns. Every property INSERT/UPDATE against the fully-migrated
schema failed with "cannot insert a non-DEFAULT value into column
geom" — a defect that never surfaced in 7b.1b because tests used
stubbed DALs.

- table-mapper.js: geom removed from properties columns.
- persistence/generated-columns.js: runtime allowlist (populated by
  grep of every migration's GENERATED ALWAYS) that the adapter uses
  to strip generated columns from INSERT/UPDATE SQL.
- Missing table migrations added: <list>. Mapper entries removed
  for tables we decided not to create: <list>.
- Column drift fixed for <N> other mapped tables.

Real-Postgres verification: property insert + update round-trip
with geom auto-population verified via ST_AsText.

Co-Authored-By: Codex <noreply@openai.com>
```

### QA checklist
- [ ] Property insert/update works against migrated schema.
- [ ] `geom` populates from lat/lng automatically.
- [ ] Every generated column across every migration is now in the
      allowlist.
- [ ] Missing table migrations or mapper cleanups all listed in
      commit message.

---

## PROMPT 15 — P0-3: Redesign `usage_events` partition key

### Task
Migration 031 (my mistake in Phase 7b.1a) declares
`PRIMARY KEY (id, territory_id)` — which makes `territory_id`
implicitly NOT NULL — while claiming the DEFAULT partition catches
rows with NULL `territory_id`. Both can't be true. Events with no
territory (webhook.received, rate-0 failure telemetry) fail to
insert.

Fix by redesigning the partition scheme.

### Context (from re-audit)
- Partition key: [031_usage_events_partitioning.sql:38](backend/src/persistence/migrations/031_usage_events_partitioning.sql:38)
- Contradictory DEFAULT partition comment: [031_usage_events_partitioning.sql:80](backend/src/persistence/migrations/031_usage_events_partitioning.sql:80)

### Files to touch
- New migration: `backend/src/persistence/migrations/034_usage_events_partitioning_fix.sql`
- `backend/src/billing/pricing/territories.js` (partition creation helper)
- `backend/src/billing/events.js` (write sentinel territory for
  platform-scoped events)
- Real-Postgres integration test.

### Requirements

1. **Migration 034:** don't edit 031 (already committed). Instead:
   - Detach every existing partition of `commercial.usage_events`.
   - Drop the partitioned parent.
   - Recreate `commercial.usage_events` with the new scheme (below).
   - Reattach the pre-existing partition data.
   - If pre-existing rows have NULL `territory_id`, update them to
     the sentinel value before reattach.

2. **New scheme — chosen for correctness AND platform-scoped events:**
   - `territory_id TEXT NOT NULL DEFAULT '__platform__'` — sentinel
     value for events with no market context (webhook receipts,
     platform-scoped telemetry).
   - `PRIMARY KEY (id, territory_id)` remains (required by
     partitioning).
   - Create the `__platform__` partition explicitly:
     `CREATE TABLE commercial.usage_events_platform PARTITION OF
     commercial.usage_events FOR VALUES IN ('__platform__')`.
   - Keep the DEFAULT partition to catch unmaterialized
     per-territory partitions until app creates them.

3. **`territories.js`:** the `ensureUsageEventsPartition` helper
   still creates per-territory partitions on demand. Add a
   boot-time check that the `__platform__` partition exists.

4. **`events.js`:** when writing an event with no resolvable
   territory (webhook.received, no country in context), write
   `territory_id: '__platform__'`. Never write NULL.

### Tests (real Postgres required)
- Insert an event with NO territory context → lands in `_platform`
  partition, no error.
- Insert an event with `territory_id: '<lb-uuid>'` when the LB
  partition exists → lands in LB partition.
- Insert an event for a territory whose partition doesn't exist yet
  → lands in default partition.
- `ensureUsageEventsPartition('<lb-uuid>', 'LB')` creates
  `commercial.usage_events_lb` and future inserts route there.
- Pre-existing rows with NULL `territory_id` are migrated to
  `__platform__` cleanly (test the up-migration on a schema pre-
  seeded with a NULL-territory row).

### Non-goals
- Do NOT redesign the events schema itself.
- Do NOT change the event-emission contract in callers.

### Commit message
```
phase 7b.1c/15 — redesign usage_events partition key (P0)

Migration 031 shipped a partition-key contradiction: PRIMARY KEY
(id, territory_id) makes territory_id NOT NULL, but the migration
claimed the DEFAULT partition catches NULL territory events. In
practice every rate-0 platform-scoped event (webhook.received,
ai.description.failed) failed to insert against the migrated
schema.

Fix (migration 034 — not an edit to 031):
- Detach every partition, drop parent, recreate with
  territory_id NOT NULL DEFAULT '__platform__'.
- Explicit __platform__ partition catches events with no market
  context.
- DEFAULT partition kept for territories whose per-country partition
  hasn't been materialized yet.
- events.js writes '__platform__' instead of NULL for territory-
  less events.
- ensureUsageEventsPartition unchanged; boot now verifies
  __platform__ partition exists.

Real-Postgres verification:
- Territory-less event inserts to __platform__ partition.
- Named territory inserts route correctly.
- Pre-existing NULL rows are migrated to __platform__ on
  application.

Co-Authored-By: Codex <noreply@openai.com>
```

### QA checklist
- [ ] Migration 034 runs cleanly on a schema with previous NULLs.
- [ ] webhook.received inserts land in `usage_events_platform`.
- [ ] Per-territory partitions still work.

---

## PROMPT 16 — Simulator sweep (this time for real)

### Task
The re-audit found extensive simulator paths still present in
production code — the exact sweep Prompt 8 claimed to have completed
but only partially did. Do the whole sweep.

### Context (from re-audit)
Simulator paths still present in these files:
- `lib/notifications/tiktok.js:46` — comments, DMs, insights
- `lib/notifications/x.js:54` — DMs, replies, insights
- `lib/notifications/email.js:67` — email delivery
- `lib/notifications/sms.js:43` — SMS delivery
- `lib/notifications/facebook.js:127` — DM, comments, insights
- `lib/notifications/instagram.js:57` — DM, comments, insights
- `lib/notifications/linkedin.js:167` — replies, insights
- `lib/otp.js:18` — OTP delivery
- `conversations/orchestrator.js:716` — unsupported outbound returns pending
- `platformModel.js:260` — synthetic listing analytics
- `lib/credentials.js:36` — dev encryption key fallback
- `web/src/pages/ListingProfilePage.tsx:917, 1283` — UI exposes
  `simulated` state
- `seed.js` — SEED_DEMO_DATA path creates demo users with known
  password
- `web/src/pages/admin/pricing/PricingAdminPage.tsx:403, 458` —
  "Skeleton / placeholder" provider creation
- `modules/property-valuation/application/scraper-service.js:23` —
  registers skeleton as manual provider
- `web/src/pages/CampaignsPage.tsx:144` — explicit "future work"
  visual branching UI

### Files to touch
Determined by grep + the list above.

### Requirements

1. **Every remaining simulator path throws instead of simulating.**
   Boot-time WARN listing which channels/features are unusable due
   to missing config. First request to a disabled channel returns
   503 with `{ error: "<channel> unavailable — configure <ENV_VAR>" }`.
   No fake success responses.

2. **`credentials.js` dev-key fallback removed.** Throws at boot if
   `CREDENTIALS_ENCRYPTION_KEY` is not set.

3. **`seed.js` SEED_DEMO_DATA path removed entirely.** Not gated —
   deleted. Any dev needing seed data can insert directly.

4. **`PricingAdminPage.tsx` Skeleton provider option removed.**
   `scraper-service.js` no longer registers `skeleton` as an
   allowed provider type.

5. **`CampaignsPage.tsx` visual branching future-work UI removed.**
   If the feature isn't shipped, don't render placeholder UI. The
   corresponding Campaigns feature ships when it ships.

6. **UI `simulated` badges removed from `ListingProfilePage.tsx`.**
   The `distributions.meta.simulated` flag was kept for historical
   compat but the UI must not surface it as a live state indicator.

7. **`orchestrator.js:716` "unsupported outbound returns pending"
   removed.** Return 501 Not Implemented at the caller if a channel
   isn't supported. Don't queue fake work.

8. **`platformModel.js:260` synthetic analytics removed.** If real
   analytics aren't available, the endpoint returns 501 or empty
   data with a documented "no telemetry connected" flag.

9. **`otp.js` throws when transport unconfigured.** Prompt 13's
   verify-OTP flow depends on this.

10. **In the commit message, provide an exhaustive audit table.**
    Every simulator hit → disposition. If any is deliberately
    deferred (not deleted), list why. The word "simulated" should
    not appear in production code paths after this commit.

### Tests
- Every publish adapter throws when creds missing.
- Every DM/comment/insight function throws when creds missing.
- SMS/email/OTP throw when transport unconfigured.
- Boot with a partial env: warn logs list every unusable
  surface; server still boots.
- First request to an unconfigured channel returns 503 (or 501 for
  unimplemented lanes).

### Non-goals
- Do NOT implement missing integrations. The scope is "remove
  fake, fail loud" — not "connect the real thing".
- Do NOT touch tests that use test doubles / mocks. Those are
  legitimate test infrastructure, not production simulators.

### Commit message
```
phase 7b.1c/16 — simulator sweep (redone from prompt 8)

Phase 7b.1b prompt 8 claimed to remove production simulators but
only cleared publish lanes. The re-audit found substantial
remaining simulator paths in DMs, comments, insights, OTP, SMS,
email, orchestrator, credentials dev key, and UI badges. This
commit does the full sweep.

Exhaustive disposition table:
| File:line | What it was | Disposition |
| ... 15+ entries ... |

Every remaining "simulator" or "placeholder" path is either
deleted or converted to "boot warn + request throw". The word
`simulated` no longer appears in any production code path (only in
test fixtures and the historical distributions.meta compat field).

Real-Postgres verification: startup with missing env vars is
tested; every disabled channel returns 503; boot completes cleanly
with WARN listing what's disabled.

Co-Authored-By: Codex <noreply@openai.com>
```

### QA checklist
- [ ] `grep -rn "simulated" backend/src/` returns only:
      test fixtures, historical `meta.simulated` field references.
- [ ] `grep -rn "placeholder" backend/src/` — same.
- [ ] Every publish/DM/comment/insight/OTP/SMS/email adapter
      throws when creds missing.
- [ ] `credentials.js` throws at boot without
      `CREDENTIALS_ENCRYPTION_KEY`.
- [ ] `seed.js` SEED_DEMO_DATA gone.
- [ ] Skeleton provider gone.

---

## PROMPT 17 — Unverified credit top-ups + publish credential gating + WhatsApp atomic replay

### Task
Three related tenant-integrity fixes.

### Context (from re-audit)
- Credit top-up endpoints accept arbitrary positive amounts with
  optional payment-intent ID, credit balances without payment
  verification.
- Publish readiness checks global env vars but adapters consume
  tenant-stored creds — tenants with valid creds get 503'd.
- WhatsApp module has separate find-then-insert dedup racing with
  the new `webhook_delivery_log`.

### Files to touch
- `backend/src/server.js` — credit top-up endpoints; publish-social
  readiness.
- `backend/src/modules/whatsapp-listings/application/webhook.js`
- Tests, real-Postgres.

### Requirements

1. **Credit top-ups disabled until Phase 7e.** Until a real payment
   gateway is wired:
   - `POST /api/agent/topup` and `POST /api/agency/topup` return 501
     `{ error: "topup_unavailable", reason: "payment_gateway_not_configured" }`.
   - Admin can still manually credit a tenant via
     `POST /api/admin/billing/credit` (existing platform-admin
     surface) — that's the ONLY path.

2. **Publish readiness resolves tenant credentials FIRST.**
   `/publish-social` per channel:
   - Resolve the tenant's `marketplace_connections` row.
   - Check whether it has usable credentials for the target channel
     (uses `resolveConnectionCredentials`).
   - If yes, use them.
   - If no, THEN fall through to global-env creds (Enterprise
     integration).
   - If neither, return 503 with a clear message.
   - Never reject a tenant that has valid stored creds because a
     global env var is unset.

3. **WhatsApp atomic replay.** The WhatsApp module's
   `application/webhook.js` still does find-then-insert for
   deduplication. Replace with a single `INSERT ... ON CONFLICT DO
   NOTHING RETURNING id` — same pattern as `webhook_delivery_log`.
   Two concurrent deliveries must not both start side effects.

4. **Also:** the WhatsApp module currently marks a delivery
   processed AFTER pipeline execution (whether success or failure),
   preventing legitimate provider retry on failure. Change: mark
   processed only on SUCCESS. On failure, leave the dedup row
   uninserted so a provider retry can succeed.

### Tests (real Postgres required)
- Top-up endpoint returns 501 with the reason string.
- Admin credit endpoint still works and writes to the ledger.
- `/publish-social`:
  - Tenant with stored FB creds + no `META_APP_SECRET` env → 200
    with successful publish (adapter uses tenant creds).
  - Tenant with no stored creds + `META_APP_SECRET` set + tenant
    has `enterprise_targets.fb_page_id` → 200 (Enterprise path).
  - Tenant with no stored + no env → 503.
- WhatsApp concurrent-webhook test: spawn 5 parallel deliveries of
  the same message_id → only 1 pipeline execution, only 1 dedup
  row.
- WhatsApp pipeline failure → dedup row NOT written → retry
  succeeds.

### Non-goals
- Do NOT implement Areeba/Airwallex/Stripe integration.
- Do NOT touch the marketplace-connection encryption logic.

### Commit message
```
phase 7b.1c/17 — credit gating + publish tenant creds + WhatsApp atomic replay

Three tenant-integrity fixes from the re-audit:

1. Unverified credit top-ups (commercial integrity vuln): tenant-
   facing topup endpoints could mint credits without verified
   payment. Returned 501 until Phase 7e ships a real gateway.
   Admin manual credit path preserved.

2. Publish credential gating mismatch: /publish-social required
   global env vars but adapters actually consume tenant-stored
   creds. Properly-configured tenants were getting 503'd. Fix:
   resolve tenant creds first, fall through to enterprise env
   creds only when tenant has none.

3. WhatsApp non-atomic replay: the wa-listings module had its own
   find-then-insert dedup racing with the new webhook_delivery_log.
   Replaced with INSERT ... ON CONFLICT DO NOTHING RETURNING id.
   Also changed dedup timing: mark processed only on success so
   provider retry can recover a failed pipeline.

Real-Postgres verification:
- 501 on tenant topup, ledger unchanged.
- Publish routes tenant creds vs env creds correctly.
- 5-way concurrent WhatsApp webhook: 1 pipeline execution.
- Failed pipeline is retryable.

Co-Authored-By: Codex <noreply@openai.com>
```

### QA checklist
- [ ] `/api/agent/topup` and `/api/agency/topup` return 501.
- [ ] Admin credit path still works.
- [ ] Tenant with valid stored creds can publish.
- [ ] WhatsApp concurrent test proves 1 execution.
- [ ] WhatsApp failed pipeline is retryable.

---

## PROMPT 18 — Tenant authz residuals + Google usage + transaction client

### Task
Sweep the remaining tenant authorization gaps + fix Google usage
accounting + fix the "code that looks atomic but isn't" transaction
issue.

### Context (from re-audit)
- Comment-router agency config allows any affiliated agent (own
  TODO): [comment-router/index.js:56](backend/src/modules/comment-router/index.js:56)
- Agency entitlement update doesn't verify the entitlement belongs
  to the caller's agency.
- Property-valuation report paths accept unchecked `property_id`.
- Unauthenticated review creation: [server.js:1784](backend/src/server.js:1784)
- Some routes return 403 vs required non-enumerating 404.
- Google usage: snake_case client vs camelCase service — cost/
  status lost.
- `transaction(work)` supplies a client but nested `insert/update/
  find` calls hit the pool: [postgres-adapter.js:231](backend/src/persistence/postgres-adapter.js:231)

### Files to touch
- `backend/src/server.js`
- `backend/src/modules/comment-router/index.js`
- `backend/src/modules/property-valuation/interface/*-routes.js`
- `backend/src/persistence/postgres-adapter.js`
- `backend/src/lib/authz.js` (may need new helpers)
- Google usage code — grep for the snake/camel mismatch.
- Migration for `google_api_usage_log.updated_at` column.

### Requirements

1. **Comment-router agency config:** requires agency-admin role, not
   just affiliation.

2. **Agency entitlement update:** verify the entitlement's
   `scope_id` matches the caller's agency before allowing update.

3. **Property-valuation report routes:** add `assertOwnsProperty`
   for any endpoint taking `property_id`.

4. **Review creation:** require authenticated + validated review
   data. If reviews are supposed to be public/unauth, at minimum
   require a captcha OR rate-limit per IP AND validate the review
   content (no HTML injection, length limits).

5. **403 → 404 for enumerable resources:** every endpoint that
   returns 403 on ownership failure should be reviewed. If the
   resource type is enumerable (integer IDs, guessable slugs), use
   404 instead. UUIDs are safer — 403 acceptable there.

6. **Google usage snake_case fix:** align the client and service
   contracts. Add `updated_at` column to
   `google_api_usage_log` (migration 035). Verify the budget cap
   actually functions with a test that hits it.

7. **Transaction client threading:** the `transaction(work)`
   contract must supply a client that the DAL uses for nested
   `insert/update/find/query`. Rework so nested calls inside a
   transaction actually use the same connection. This is the
   "code that looks atomic isn't" bug — fix it structurally.

### Tests (real Postgres required)
- Comment-router agency config rejected for non-admin affiliated
  agent.
- Agency entitlement update rejected for cross-agency entitlement.
- Property-valuation report rejected for non-owned property.
- Review creation with valid input works; with HTML/injection
  fails; rate-limit enforced.
- Google usage log rolls up correctly; budget cap trips.
- Transaction rollback: `insert` inside `transaction(fn)` that
  later throws → row is not persisted (proves the client threading
  works). Currently this fails.

### Non-goals
- Do NOT redesign the DAL API surface. `transaction(fn)` signature
  stays the same; only its internal implementation changes.

### Commit message
```
phase 7b.1c/18 — tenant authz residuals + google budget + tx client

Sweep of residuals from the re-audit's tenant authorization
gaps, plus two structural correctness issues.

Authz:
- Comment-router agency config requires agency-admin.
- Agency entitlement update verifies entitlement scope.
- Property-valuation report routes assertOwnsProperty.
- Review creation authenticated + validated + rate-limited.
- 403 → 404 on enumerable-ID resources.

Google API budget:
- snake_case ↔ camelCase mismatch fixed; usage now records.
- Migration 035 adds updated_at.
- Real-Postgres test proves budget cap trips.

Transaction client:
- Nested DAL calls inside transaction(fn) now use the same client
  connection. Rollback test proves atomic behavior; previously the
  rollback affected nothing because inserts hit the pool directly.

Real-Postgres verification: all above.

Co-Authored-By: Codex <noreply@openai.com>
```

### QA checklist
- [ ] Every residual authz gap listed by re-audit is closed.
- [ ] Google budget cap tripping test is green.
- [ ] Transaction rollback test proves atomicity.

---

## PROMPT 19 — Verify ledger concurrency + add critical-flow E2E tests

### Task
Actually run the Prompt 4 ledger concurrency tests against real
Postgres (they've been skipped since 7b.1b), then add a small suite
of critical-flow E2E tests so the sprint closes on empirical
verification, not just code review.

### Files to touch
- `backend/src/billing/ledger.test.js` — verify + expand.
- New: `backend/src/e2e/*.e2e.test.js`
- CI wiring (add to package.json script, not full GitHub Actions).

### Requirements

1. **Ledger concurrency test must run to green** with
   `TEST_DATABASE_URL` set. If it fails (5-racer concurrent test
   proving misclassification), that's a bug in the stored procedure
   from Phase 7b.1b/4 that has to be fixed here.

2. **E2E tests for critical flows** (each seeds a fresh schema, runs
   the flow end-to-end, asserts persisted state):
   - **Register → verify OTP → login → get JWT.** Proves Prompt 13
     fix.
   - **Create property → verify `geom` populated → update lat/lng →
     verify `geom` updated.** Proves Prompt 14 fix.
   - **Emit rate-0 `webhook.received` event → verify persisted in
     `usage_events_platform`.** Proves Prompt 15 fix.
   - **Publish to a channel with tenant creds → verify success →
     usage event persisted with correct territory/zone.** Proves
     Prompt 17 fix.
   - **Concurrent `recordConsumption` on same tenant/quota/period
     → verify SUM invariant.** Proves Prompt 4 was actually correct.
   - **Attempted platform-admin takeover via registration →
     verify user is unverified + not admin.** Proves Prompt 13.

3. **`npm run test:e2e`** — runs only the E2E suite, requires
   `TEST_DATABASE_URL`.

### Non-goals
- No browser E2E (Playwright) yet — that's a separate infra sprint.

### Commit message
```
phase 7b.1c/19 — verify ledger race + critical-flow E2E

The Phase 7b.1b closure claimed the ledger race was fixed but the
verifying tests were skipped for lack of TEST_DATABASE_URL. This
commit runs them against real Postgres and adds a small E2E suite
covering the P0 fixes from prompts 13-17 end-to-end.

- ledger concurrency tests: <N/N> pass with 5-racer, 100-op
  invariant, and the release-blocking behavior demonstrated.
- e2e/: 6 flow tests covering registration security, geom
  persistence, platform-scoped events, tenant-cred publish,
  ledger concurrency, admin takeover attempt.
- npm run test:e2e — dedicated script requiring real Postgres.

Real-Postgres run evidence: <full output of test:pg + test:e2e>.

Co-Authored-By: Codex <noreply@openai.com>
```

### QA checklist
- [ ] Ledger concurrency proves correct under 5-way race.
- [ ] Every P0 fix (13/14/15/17) has an E2E test.
- [ ] `npm run test:pg` and `npm run test:e2e` both green.

---

## Post-sprint closure — new methodology

After Prompt 19 lands, Claude (Architect) will:
1. Run the FULL test suite locally against a real Postgres+PostGIS
   Docker container.
2. Verify EVERY prompt's tests pass with `TEST_DATABASE_URL` set,
   not just the shape of the code.
3. Re-audit against the reviewer AI's original 11-item remediation
   list, item by item, with evidence.
4. Produce a REAL closure report — no closure without empirical
   verification of every claim.

Then the sprint sequence resumes with Phase 7b.2 UI (unblocked) or
Phase 7c (unblocked). The reviewer AI is invited to re-audit before
new-code work resumes.
