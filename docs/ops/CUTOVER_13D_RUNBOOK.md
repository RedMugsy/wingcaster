# Stage 13d cutover runbook

Operator sequence for flipping `fin.*` to source of truth. This file is the
coordinated deploy — merge of `feat/stage-13d-cutover` does **not** flip
production. `fin.cutover_active_environment.mode` stays `OFF` until an
operator calls `POST /api/admin/fin/cutover/activate`.

**PROD must never set `FIN_CUTOVER_SKIP_ATTESTATION_GATE`.** That env var is
a local-dev bypass of the startup attestation gate (DL-209).

Do **not** in 13d:

- Drop any `commercial.*` table
- Alter any `commercial.*` schema
- Delete any `commercial.*` row
- Truncate any `commercial.*` table

Those belong to Stage 13e/13f.

---

## Pre-flight (T-24h)

1. Verify R084 / R090–R095 all GREEN in prod for the last 24h
   (`GET /api/admin/fin/cutover/readiness` and the last reconciliation run).
2. Verify a signed attestation exists for the target environment within 7 days
   (`attestation.last_signed_at` on the readiness payload).
3. Notify affected tenants (customer comms).
4. Schedule the maintenance window (or announce the zero-downtime expectation
   depending on tenant surface).

---

## Flip (T-0)

5. Deploy this PR to prod (code + migrations `260`, `261`, `262`).
   Migration `260b_fin_cutover_thaw_commercial.sql` is **not** applied by the
   auto-migration loop — leave it on disk as rollback ammunition.
6. Verify `GET /api/admin/fin/cutover/readiness` returns
   `ready_for_cutover: true`.
7. Operator invokes `POST /api/admin/fin/cutover/activate` for the target
   environment (platform_admin + elevated + `Idempotency-Key` + `If-Match`).

   Body:

   ```json
   { "attestation_id": "<uuid>", "note": "Stage 13d LIVE flip" }
   ```

   Environment comes from the operator session, not the body (DL-164).
8. Verify `GET /api/admin/fin/cutover/readiness` shows `mode: "FIN_ONLY"`.
9. Smoke test: emit a test usage event on the un-501'd top-up path; verify
   only `fin.*` rows exist (no new `commercial.usage_events` insert). Role
   REVOKE from migration 260 is the write stop; `permission denied` on
   `commercial.*` INSERT is expected for `fin_app_role`.

---

## Monitor (T+1h through T+24h)

10. Watch R084 hourly (dual-write errors should be zero — DUAL is off now).
    If anything spikes, investigate before rolling forward.
11. Watch R096 (attestation freshness) hourly. CRITICAL /
    `BLOCK_NEW_ISSUANCE` — a stale FIN_ONLY attestation fail-closes new
    issuance at the mode resolver.
12. Watch application error logs for `commercial.* permission denied` — this
    is EXPECTED and should decrease as read paths migrate to `fin_public.*`
    views over the next 90 days.

---

## Rollback (if needed at T+0 .. T+24h)

13. Operator invokes `POST /api/admin/fin/cutover/deactivate` with
    `reason_code=ROLLBACK` (platform_admin + elevated + `Idempotency-Key`).
    This flips `fin.cutover_active_environment.mode` back to `DUAL` (not
    `OFF`) so dual-write stays available for a later re-cutover.
14. Apply `backend/src/persistence/migrations/260b_fin_cutover_thaw_commercial.sql`
    **MANUALLY** (not via the auto-migration loop):

    ```bash
    psql "$DATABASE_URL" -f backend/src/persistence/migrations/260b_fin_cutover_thaw_commercial.sql
    ```

15. Verify `commercial.*` writes resume via a canary test.
16. Post-mortem the trigger cause.

---

## Endpoints

| Method | Path | Guards |
|---|---|---|
| GET | `/api/admin/fin/cutover/readiness` | platform_admin |
| GET | `/api/admin/fin/cutover/parity` | platform_admin |
| POST | `/api/admin/fin/cutover/attest` | platform_admin + elevated + Idempotency-Key |
| POST | `/api/admin/fin/cutover/activate` | platform_admin + elevated + Idempotency-Key |
| POST | `/api/admin/fin/cutover/deactivate` | platform_admin + elevated + Idempotency-Key |

Activate body: `{ attestation_id, note? }`  
Deactivate body: `{ reason_code, note }`

Outbox topics: `fin.cutover.activated`, `fin.cutover.deactivated`.

---

## Env vars

| Name | Prod | Meaning |
|---|---|---|
| `FIN_CUTOVER_MODE_GLOBAL` | optional | `FIN_ONLY` still works as an override. DB singleton takes precedence when `mode='FIN_ONLY'`. |
| `FIN_CUTOVER_SKIP_ATTESTATION_GATE` | **never** | Local-dev bypass of the boot gate. |

---

## Views

`fin_public.usage_events` and `fin_public.ledger_entries` redirect reads at
the SQL layer (`security_invoker` so FORCE RLS on the underlying `fin.*`
tables still applies). Application code continues to read `commercial.*`
until 13e/13f migrates callers. Tables still commercial-only (no view) are
listed in DL-210.
