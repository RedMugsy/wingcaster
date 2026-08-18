# Deliverable H — Security matrix

**Stage:** 0 (§128)
**Owner:** Agent D (this file). Sits on A + DL-000…DL-028.
**Date:** 2026-08-18
**Status:** Stage 0 design. Closes **A-Q6**, **A-Q8**, and **A-Q9 / R2-3** (DL-041…DL-048).
**Posture:** SOC2 CC6.1 / CC6.3 / CC6.6 / CC7.2, SOX 302/404 (close + two-admin), NIST 800-63B §§5.1.1.2 / 5.2.2 / 6.1.2 / 7.1, OWASP ASVS 14.4.1 and 8.3.4, GDPR Art. 17(3)(b) + KSA PDPL.
**Does not:** write `backend/src/**`, invent `fin.*` tables (columns reserved via DL only), or silently remediate live P0s in current Express routes.

The 7f/3 guard already on `main` @ `16beece` is the HTTP pattern every new admin surface copies:

```js
[authMiddleware, requirePlatformAdmin, requireExplicitPlatformAdmin, requireElevated()]
```

Source: `backend/src/notifications/platform-templates/routes.js:175` (`writeGuards`). Inventory: `backend/src/phase-7f3-wiring.test.js`. E1/E2 were remediated in `16beece`; new routes that omit themselves from that test file are a silent-failure class (handover §3.1).

---

## 0. Session variables and roles

Postgres roles (created in Stage 1 `109_fin_rls.sql` / a sibling grants migration). **Platform admin is not a DB role.**

| Role | Purpose |
|---|---|
| `fin_migrator` | Table owner. Runs migrations. Not a runtime login. |
| `fin_app_role` | API / workers. Default GRANT below. |
| `fin_recon_role` | Reconciliation runner only. |
| `fin_finance_role` | Finance/ops staff connections (admin console impersonation via `SET LOCAL`). Legal-entity scoped. |
| `fin_auditor_role` | SELECT only, all `fin.*` the RLS predicate allows. |
| `fin_migrate_role` | Stage 13 backfill (`source_system='backfill_v1'`). INSERT facts + recon + audit. No UPDATE. |

`SET LOCAL` (transaction-scoped, never `SET` session-wide):

| GUC | Set by | Meaning |
|---|---|---|
| `fin.environment` | app on every tx | `LIVE` / `TEST` |
| `fin.tenant_id` | tenant-scoped request | UUID text |
| `fin.legal_entity_id` | finance/ops request | UUID text |
| `fin.platform_admin` | only after `requirePlatformAdmin` | `on` / `off` |
| `fin.elevated` | only after `requireElevated()` | `on` / `off` |
| `fin.actor_id` | every authenticated tx | UUID / public user id text |
| `fin.capabilities` | comma list of §99 codes | e.g. `VIEW_CREDITS,GRANT_CREDITS` |

Missing GUC ⇒ predicate fails closed (empty set), not open. `current_setting('fin.tenant_id', true)` with `true` = missing-ok; policies treat NULL as deny.

---

## 1. RLS (closes A-Q6)

`ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` on every tenant-scoped and every economic table (spec §98). Table owner (`fin_migrator`) is not exempt because of FORCE.

### 1.1 Predicate families (named)

**`fin_tenant_isolation`** — tables with `tenant_id`:

```sql
CREATE POLICY fin_tenant_isolation ON fin.<table>
  AS PERMISSIVE FOR ALL
  TO fin_app_role, fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND (
      tenant_id::text = current_setting('fin.tenant_id', true)
      OR fin.platform_admin_bypass()
    )
  )
  WITH CHECK (
    environment = current_setting('fin.environment', true)
    AND (
      tenant_id::text = current_setting('fin.tenant_id', true)
      OR fin.platform_admin_bypass()
    )
  );
```

**`fin_legal_entity_staff`** — finance/ops reading across tenants of one seller (`invoices`, `accounting_events`, `accounting_periods`, `invoice_sequences`, `tax_snapshots` via invoice, `credit_notes`, `debit_notes`):

```sql
CREATE POLICY fin_legal_entity_staff ON fin.invoices
  AS PERMISSIVE FOR SELECT
  TO fin_finance_role, fin_auditor_role
  USING (
    environment = current_setting('fin.environment', true)
    AND legal_entity_id::text = current_setting('fin.legal_entity_id', true)
  );
```

`fin_finance_role` does **not** get INSERT/UPDATE on APPEND_ONLY tables. ISSUE/void go through `fin_app_role` after the HTTP guards.

**`fin_book_via_tenant`** — tables without `tenant_id` (`ledger_accounts`, `ledger_postings`, `account_balances`, `lot_allocations`, `ledger_transactions`):

```sql
CREATE POLICY fin_book_via_tenant ON fin.ledger_postings
  AS PERMISSIVE FOR ALL
  TO fin_app_role
  USING (
    environment = current_setting('fin.environment', true)
    AND EXISTS (
      SELECT 1 FROM fin.ledger_books b
      WHERE b.id = ledger_postings.book_id
        AND b.environment = ledger_postings.environment
        AND (
          b.tenant_id::text = current_setting('fin.tenant_id', true)
          OR fin.platform_admin_bypass()
        )
    )
  )
  WITH CHECK ( /* same EXISTS */ );
```

**`fin_platform_admin_bypass()`** — 7f/3 at the SQL boundary:

```sql
CREATE FUNCTION fin.platform_admin_bypass()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    current_setting('fin.platform_admin', true) = 'on'
    AND current_setting('fin.elevated', true) = 'on'
$$;
```

`platform_admin` without `elevated` is **not** a bypass. That is E1/E2’s lesson. A compromised admin session that never stepped up sees only its own `fin.tenant_id` (usually none) — empty set, not the platform.

**`fin_recon_all_read`** — `fin_recon_role` SELECT on every `fin.*` table in the run’s `environment`. No tenant GUC required. INSERT only on `reconciliation_*` + `financial_audit_events` (reason_code `RECON_*`).

**`fin_env_isolation`** — additional WITH CHECK on every economic table: `environment = current_setting('fin.environment', true)`. TEST cannot write LIVE.

### 1.2 Table → policy map

| Table class | Policies |
|---|---|
| `+tenant` economic / control (`tenants`, `holders`, `billing_accounts`, `lots`, `holds`, `usage_events` after attribution, `rated_usage`, `contracts*`, `payments`, `purchase_intents`, `credit_facilities`, …) | `fin_tenant_isolation` + FORCE |
| Seller documents (`invoices`, `credit_notes`, `debit_notes`, `accounting_events`, `invoice_sequences`) | `fin_tenant_isolation` + `fin_legal_entity_staff` (SELECT) |
| `accounting_periods`, `fx_rate_snapshots`, `platforms`, `environments`, `platform_legal_entities` | legal-entity / platform; **no** tenant policy. Finance SELECT; app INSERT of periods is capability `CLOSE_PERIOD` (Stage 9) |
| Ledger children without `tenant_id` | `fin_book_via_tenant` |
| `usage_events` pre-attribution (`tenant_id` NULL) | extra policy: INSERT allowed to `fin_app_role` when `tenant_id IS NULL AND residency_key` is a known cell; SELECT of NULL-tenant rows only via bypass or `fin_recon_role` |
| `financial_audit_events` | SELECT: tenant via `target` walk **or** bypass **or** auditor. INSERT: `fin_app_role`, `fin_recon_role`, `fin_migrate_role`. No UPDATE/DELETE policy (REVOKE handles it) |
| `reconciliation_*` | `fin_recon_role` ALL (INSERT/SELECT/UPDATE on INTENT runs/resolutions); `fin_app_role` SELECT; finance SELECT |
| `idempotency_keys` | `fin_tenant_isolation`; platform-admin keys have `tenant_id` NULL and require bypass to read |
| `payment_methods` | `fin_tenant_isolation`; `fin_finance_role` SELECT **does not** include `provider_method_id` — expose via a column-grant / view `fin.payment_methods_safe` (`last4`, `kind`, `status` only). ASVS 8.3.4 |

`holder_id` is **not** the RLS grain (A-Q6). Holder is an authorization concern inside a tenant (funding resolver, Stage 6). Cross-holder reads inside a tenant are allowed to `fin_app_role`; the app enforces holder scope. Cross-**tenant** reads are the RLS job.

---

## 2. Role grants (A §1.1 mutability)

Default: **no** PUBLIC grants on `fin.*`. `REVOKE ALL ON ALL TABLES IN SCHEMA fin FROM PUBLIC`.

### 2.1 APPEND_ONLY

Tables (A §1.1): `usage_events`, `ledger_postings`, `ledger_transactions`, `rated_usage`, `lot_allocations`, `financial_audit_events`, `accounting_events`, invoice lines / tax lines / adjustments / payment allocations after ISSUE, `vendor_usage_events`, `vendor_reported_usage`, `vendor_cost_estimates`, `vendor_actual_costs`, vendor statement lines after FINALIZE, `fx_rate_snapshots`, `tax_snapshots`, `revenue_allocation_groups`, `revenue_allocation_lines`, `metered_usage`, `metered_usage_sources`, `authorization_attempts`, `approval_actions`, `reconciliation_checks`, `reconciliation_drift`, `dunning_steps`.

```sql
GRANT SELECT, INSERT ON fin.<append_only_table> TO fin_app_role;
REVOKE UPDATE, DELETE ON fin.<append_only_table> FROM fin_app_role;
REVOKE TRUNCATE ON fin.<append_only_table> FROM fin_app_role;
```

`financial_audit_events` (E-3 / DL-008):

```sql
GRANT INSERT, SELECT ON fin.financial_audit_events TO fin_app_role, fin_recon_role, fin_migrate_role;
REVOKE UPDATE, DELETE, TRUNCATE ON fin.financial_audit_events FROM fin_app_role, fin_recon_role, fin_migrate_role, fin_finance_role;
```

Legacy `public.audit_log` (not replaced until money paths move): Stage 1 applies the **same** REVOKE to the current app DB role as a detective control. That is **not** a silent rewrite of `009_audit_activity.sql` in Stage 0; it is scoped to Stage 1. Finding E-3 stays on the register until that migration lands.

### 2.2 MUTABLE / INTENT / CACHE

`GRANT SELECT, INSERT, UPDATE` to `fin_app_role`. `REVOKE DELETE` on every economic table. Control-plane draft deletes use `superseded_at`, not DELETE.

CACHE (`account_balances`, `limit_counters`, `unapplied_cash`): `UPDATE` only from the posting / counter trigger running as `fin_migrator` security definer. `fin_app_role` is SELECT + INSERT-of-zero-row on first posting. <!-- OPEN: trigger owner vs app role is Stage 1; do not invent a `fin_cache_role`. -->

### 2.3 Reconciliation role

```sql
GRANT SELECT ON ALL TABLES IN SCHEMA fin TO fin_recon_role;
GRANT INSERT, SELECT ON fin.reconciliation_runs, fin.reconciliation_checks,
  fin.reconciliation_drift TO fin_recon_role;
GRANT SELECT, INSERT, UPDATE ON fin.reconciliation_resolution, fin.reconciliation_runs TO fin_recon_role;
GRANT INSERT, SELECT ON fin.financial_audit_events TO fin_recon_role;
-- INTENT account_controls updates for the ladder:
GRANT SELECT, UPDATE ON fin.account_controls TO fin_recon_role;
REVOKE UPDATE, DELETE ON fin.ledger_postings, fin.lots, fin.invoices FROM fin_recon_role;
```

### 2.4 Platform admin

**No default GRANT.** HTTP + `SET LOCAL fin.platform_admin / fin.elevated` uses `fin_app_role` under bypass. A dedicated superuser connection for “fix production” is an IR break-glass: two-admin `PLATFORM_ADMIN_RECOVERY`, credential in a hardware-backed secret manager, session recorded on `financial_audit_events`. Not a standing role.

### 2.5 Spec §99 capabilities (application, not DB GRANT)

`VIEW_CREDITS` / `GRANT_CREDITS` / `ADJUST_CREDITS` / `REFUND_CREDITS` / `CHANGE_PRICE` / `APPROVE_PRICE` / `CREATE_FACILITY` / `APPROVE_FACILITY` / `VOID_INVOICE` / `APPROVE_WRITE_OFF` / `RESOLVE_RECONCILIATION` (+ `CLOSE_PERIOD`, `AUDIT_RETENTION`, `PLATFORM_ADMIN_RECOVERY`).

Enforced in the service layer after RLS. A capability is stored on the actor (Stage 12 RBAC). Until then, `platform_admin` + elevated + two-admin for the sensitive kinds is the stand-in — **not** a collapse back to a single boolean on un-elevated routes.

---

## 3. Hash-chain (closes A-Q8)

**Confirmed:** RFC 8785 JSON Canonicalization Scheme (JCS) + the field list in A §12.5. Do not add `ip` / `user_agent` to the hashed object (they are stored, not chained). Do not remove any listed field.

```
row_hash = SHA-256( JCS( {
  id, environment, actor_type, actor_id, actor_email_snapshot,
  action, target_type, target_id, before_state, after_state,
  reason_code, approval_request_id, request_id, created_at, prev_hash
} ) )
```

- Timestamps: UTC `YYYY-MM-DDTHH:MM:SS.sssZ` (A).
- UUID: lowercase hex with hyphens.
- JSONB `before_state` / `after_state`: already canonicalized via JCS (key-sorted, no insignificant whitespace).
- `null` JSON nulls are encoded as JCS `null`.
- First row **per `environment`**: `prev_hash = 64 × '0'` (zero-hex genesis). LIVE and TEST are **two chains**.
- `row_hash` / `prev_hash` stored as `TEXT` lowercase hex (64 chars). CHECK `~ '^[0-9a-f]{64}$'`.

### 3.1 Trigger algorithm

`BEFORE INSERT` on `fin.financial_audit_events`, security definer, `fin_migrator`:

1. Lock the chain tail: `SELECT row_hash FROM fin.financial_audit_events WHERE environment = NEW.environment ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`.
2. If no row: `NEW.prev_hash := repeat('0', 64)`; else `NEW.prev_hash := tail.row_hash`.
3. Caller-supplied `prev_hash` / `row_hash` are **ignored** (overwrite). Clients cannot choose the chain.
4. Build the JCS object from NEW (after step 2). `NEW.row_hash := encode(sha256(jcs_bytes), 'hex')`.
5. Return NEW.

`created_at` must be supplied by the writer from `BusinessClock.now()` (A §1). The trigger does not `DEFAULT CURRENT_TIMESTAMP` on this table.

Concurrent inserts in one environment serialize on the tail `FOR UPDATE`. That is the integrity/throughput trade-off; do not shard the chain without a Decision Log.

### 3.2 Verifier query

Walk from any row back to genesis. Break at first mismatch.

```sql
WITH RECURSIVE walk AS (
  SELECT e.id, e.environment, e.row_hash, e.prev_hash, e.created_at,
         1 AS depth,
         (e.prev_hash = repeat('0', 64)) AS at_genesis,
         false AS broken
  FROM fin.financial_audit_events e
  WHERE e.id = :start_id
  UNION ALL
  SELECT prev.id, prev.environment, prev.row_hash, prev.prev_hash, prev.created_at,
         walk.depth + 1,
         (prev.prev_hash = repeat('0', 64)),
         (walk.prev_hash <> prev.row_hash) OR walk.broken
  FROM walk
  JOIN fin.financial_audit_events prev
    ON prev.row_hash = walk.prev_hash
   AND prev.environment = walk.environment
  WHERE walk.at_genesis = false AND walk.broken = false
)
SELECT * FROM walk
WHERE broken OR at_genesis
ORDER BY depth DESC;
```

A nightly job (`fin_recon_role` or auditor) starts from `ORDER BY created_at DESC, id DESC LIMIT 1` per environment and expects `at_genesis = true` and `broken = false`. Also recompute `row_hash` from JCS and compare to the stored value (detects in-place UPDATE if REVOKE is ever bypassed by a superuser).

### 3.3 Backfill posture

**Do not backfill** `public.audit_log` / `activity_log` / `commercial.billing_subscription_history` into this chain. New schema starts at genesis. Historical money-path evidence stays in the legacy tables (FINANCIAL_7Y / product retention). Stage 13 may **cite** a legacy row id in `after_state.legacy_ref`; it does not rewrite `prev_hash` to include it.

---

## 4. Two-admin approval

`fin.approval_requests.action_kind` values that **require two distinct approver ids** (A §12.1: table stores distinct ids; no self-approval):

| `action_kind` | Why |
|---|---|
| `PLATFORM_ADMIN_RECOVERY` | Audit E4 — recovering a `platform_admin` |
| `LARGE_REFUND` when the book is `book_type = 'PLATFORM'` | Platform-book cash out |
| `AUDIT_RETENTION` | E2 remediated in `16beece` at HTTP; two-admin is the SOX/SOC2 remaining control for mass delete / retention change |

Also two-admin (same mechanism, already in A’s sensitive list): `WRITE_OFF` above a threshold, `RECONCILIATION_OVERRIDE` that reopens HARD_CLOSED, `MASS_OPERATION`.

Rules:

1. Requester `actor_id` **cannot** appear on an `approval_actions` row with `decision = 'APPROVED'` for that request.
2. Two `APPROVED` actions, `actor_id` distinct, both `requireElevated` at the HTTP edge.
3. `min_distinct_approvers` (DL-048) is `2` for the kinds above, `1` otherwise.
4. Status `APPROVED` is only legal when `COUNT(DISTINCT actor_id) FILTER (WHERE decision='APPROVED') >= min_distinct_approvers`.

Agent B owns the status machine; this file owns the cardinality invariant.

---

## 5. Rate-limit posture (audit E11 / E12)

Today: `generalLimiter` 200/15m per IP and `authLimiter` 20/15m on `/api/auth` (`server.js:442-467`). `trust proxy` is off unless `FORCE_HTTPS` (E11). No per-account key. Admin mutations inherit the general bucket.

**Target (Stage 12 + any earlier admin surface born before 12):**

| Limiter | Key | Budget | Surfaces |
|---|---|---|---|
| `authAccountLimiter` | `req.body.email \|\| req.ip` | 20 / 15m per account (NIST 800-63B §5.2.2) | login, step-up, recovery, TOTP verify |
| `adminMutationLimiter` | `req.user.id` (account), fallback `req.ip` | **10 / 5m** (audit E12) | every admin mutation |
| `generalLimiter` | `req.ip` | keep 200/15m | everything else |

`trust proxy` is set from deploy config (`TRUST_PROXY=1` on Railway), **not** coupled to `FORCE_HTTPS`.

Admin mutation inventory that **must** attach `adminMutationLimiter` **and** `writeGuards` **and** a line in `phase-7f3-wiring.test.js`:

| Surface | Today | Finding |
|---|---|---|
| `POST /api/admin/billing/credit` | ungated limiter | E12 |
| `POST /api/admin/billing/subscriptions/bulk-{cancel,expire,migrate,pause,resume}` | same | E12 |
| `POST /api/admin/billing/credit-notes/bulk-issue` | same | E12 |
| `POST /api/admin/message-templates/:id/test-send` | writeGuards present; no dedicated limiter | E12 |
| `PATCH /api/admin/pricing/*` | C-1 still throws; when Stage 4 is born, guards + limiter + **success-path** postgres test | E12 + C-1 |
| Every new ` /api/admin/fin/*` | does not exist yet | copy `writeGuards` |

Do **not** patch those routes in Stage 0 (DL-011). This section is the constraint the owning stage must implement.

---

## 6. CSP (audit E7 / ASVS 14.4.1)

Today `server.js:412` `scriptSrc: ["'self'", "'unsafe-inline'"]`.

Target: **nonce-based** `script-src`. Helmet `contentSecurityPolicy.directives.scriptSrc = ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`]`. Remove `'unsafe-inline'` for scripts. Style may keep `'unsafe-inline'` only until the Vite build emits hashes; tracked as Stage 12 P1, not a billing-schema item.

Owning stage: the first web deploy after 7f/2 (or Stage 12 UI). Not a `fin.*` migration.

---

## 7. Password / bcrypt / breach-list / reuse (E5 / E6 / T2b)

| Control | Target | Standard |
|---|---|---|
| Registration minimum | **12** (unify with reset/change; today register is 6, reset is 10 — `lib/validation.js:33,58,63`) | NIST 800-63B §5.1.1.2 (min 8; we take 12) |
| Breach list | HIBP range API (k-anonymity) or local rockyou-lite; reject if listed | NIST 800-63B §5.1.1.2 |
| Composition | zxcvbn score ≥ 3 **or** length ≥ 16. No mandated charset | NIST (no composition rules) |
| Reuse ban | last **5** password hashes | SOC2 CC6.1 |
| bcrypt cost | **12** everywhere; opportunistic rehash on login when `cost < 12` | SOC2 CC6.1 / E6 |

<!-- OPEN: `password_history` is identity, not `fin.*`. Home is `public.password_history` (or equivalent) owned by the auth stage. Do not invent `fin.password_history`. -->

Owning stage: auth hardening that can land independently of `fin.*` (recommended before Stage 12). Not a silent `validation.js` edit in Stage 0.

---

## 8. JWT (E8 / E9 / NIST 800-63B §7.1)

Today: `signToken` 7-day access, no refresh, revocation via `token_version` only (`auth.js:26-28`). `token_version` bumps on password reset/change, recovery, TOTP **disable**, platform-role update — **not** on TOTP **enable** (`auth-2fa.js:367-391` vs `:446`).

Target:

| Piece | Rule |
|---|---|
| Access | 15 minutes. Bearer. Claims: `sub`, `token_version`, `session_id`, `elevated?` |
| Refresh | Rotating. Reuse of a spent refresh **revokes the session**. Bound to `session_id` + `token_version` |
| Revocation | `session_id` row killed **or** `token_version` bump (global). IR primitive `POST /api/admin/users/:id/revoke-sessions` (E16) is `writeGuards` |
| TOTP enable | **bump `token_version` inside the enrolment transaction** (E9 / ASVS 3.5.3). Pre-enrolment sessions die. Caller receives a fresh pair |

<!-- OPEN: session registry is identity (`public.auth_sessions`), not a `fin.*` table. Auth stage confirms the name. -->

`JWT_SECRET` fallback `'dev-jwt-secret-change-me'` (E13) is banned in every environment — match `credentials.js` throw-hard. Tests already set the env.

---

## 9. GDPR erasure vs FINANCIAL_7Y (R2-3 / A-Q9 / DL-041)

Closes A-Q9. Coordinates with Agent A’s reservation in DL-027 (not rewritten).

### 9.1 Legal basis

GDPR Art. 17(3)(b) (and KSA PDPL equivalent): erasure does **not** apply when processing is required for a **legal obligation**. Invoices, tax, ledgers, and the financial audit trail are FINANCIAL_7Y (A §19) from period HARD_CLOSED. They **survive**. Identity-mirror rows follow `public.tenants` **except** where a 7Y document still points at them — those pointers stay, PII is stripped.

### 9.2 Mode (picked)

**Pseudonymise-in-place** is the default. A reserved **tombstone tenant** exists per environment for IDENTITY_MIRROR display of *new* non-financial refs. An active **legal hold** **blocks** erasure (Art. 17(3)(b) + (e)).

We do **not** re-point `invoices.tenant_id` / `rated_usage.tenant_id` / `payments.tenant_id` at the tombstone — that would break F R091 and tax identity of the seller–buyer pair.

### 9.3 What is erased vs what stays

| Class | Action |
|---|---|
| `financial_audit_events.actor_email_snapshot` | **Keep** (DL-008). Already a snapshot. Not a live email. |
| `invoices`, `invoice_lines`, `rated_usage`, `payments`, `payment_allocations`, `credit_notes`, `debit_notes`, `ledger_*`, `lots`, `accounting_events` | **Survive 7Y.** Pseudonymise buyer **name / email / address** on the snapshot columns (DL-042). Amounts, dates, tax, lot units, hashes stay. |
| `tax_id` / `jurisdiction` / `vat_bps` / `tax_treatment` / ZATCA `xml_uuid` / `prev_invoice_hash` | **Load-bearing. Cannot erase.** Legal obligation (VAT, Fatoora, Peppol). |
| `holders.display_name`, `tenants` contact mirrors, invoice `buyer_legal_name` / `buyer_email` / `buyer_address_*` | Pseudonymise to `ERASED-<hmac12>` / empty address lines / country **kept** |
| `payment_methods` | Vault: revoke at PSP + `status=REVOKED`; `last4` may remain (PCI residual). Raw PAN never stored (A). |
| `public.users` / `public.tenants` PII | Identity erasure proceeds; `fin.tenants.status = CLOSED`, `erasure_status = PSEUDONYMISED` (DL-043) |
| Tombstone | One `fin.tenants` row per env: `public_tenant_id = '__erased__'`. Not used as `invoices.tenant_id` |

### 9.4 Legal hold

`fin.tenants.legal_hold = true` (DL-043) ⇒ erasure request is stored (`approval_requests` or identity case) and **blocked** (`erasure_status = BLOCKED_LEGAL_HOLD`). Hold lift is two-admin when the tenant had a `platform_admin` actor.

### 9.5 Invariants erasure must not break

- F R070–R075 (invoice arithmetic, numbers, tax freeze)
- F R001–R007 (ledger / lots)
- Hash-chain (pseudonymising `before_state` / `after_state` is **forbidden** — those JSONB blobs are in `row_hash`. If they contain an email, it stays for 7Y as a snapshot, same as `actor_email_snapshot`)
- `UNIQUE(legal_entity_id, invoice_number)`

Erasure is an UPDATE of MUTABLE identity-bearing columns only (tenants/holders + invoice buyer snapshot fields reserved as MUTABLE-until-ISSUE, then a **single** post-ISSUE exception: the erasure worker, `security definer`, listed columns only, stamped on `financial_audit_events.action = 'GDPR_PSEUDONYMISE'`). That exception is the only UPDATE of an issued invoice header besides status/paid (A §10.3). DL-042 names the columns.

---

## 10. Log redaction (ASVS 8.3.4 / E14)

`pino` redact paths (Stage 1 observability, not Stage 0 code): `req.headers.authorization`, `req.headers.cookie`, `*.password_hash`, `*.token*`, `*.secret*`, `*.totp_secret_encrypted`, `*.provider_method_id`. This file only names the requirement.

---

## 11. Acceptance (A §18 posture)

File names must appear in the CI **postgres** job summary. Counts are not evidence (handover §3.1).

| # | Test file | Asserts |
|---|---|---|
| H1 | `backend/src/fin/security/append-only-revoke.postgres.test.js` | Connected as `fin_app_role`: `UPDATE fin.ledger_postings SET amount_units = 1` → insufficient privilege. Same for `financial_audit_events`, `ledger_transactions`, `rated_usage` |
| H2 | `backend/src/fin/security/rls-cross-tenant.postgres.test.js` | Tenant A GUC; `SELECT` invoices/lots/usage of tenant B → **0 rows**. Bypass only when **both** `fin.platform_admin` and `fin.elevated` are `on` |
| H3 | `backend/src/fin/security/rls-legal-entity.postgres.test.js` | `fin_finance_role` + `fin.legal_entity_id = WC-KSA` sees KSA invoices, not WC-UAE |
| H4 | `backend/src/fin/security/rls-un-elevated-admin.postgres.test.js` | `fin.platform_admin=on` and `fin.elevated=off` → no cross-tenant rows (E1 class) |
| H5 | `backend/src/fin/security/hash-chain-trigger.postgres.test.js` | Insert stamps `row_hash`; second row `prev_hash =` first `row_hash`; first `prev_hash` is 64-zero; client-supplied hashes overwritten |
| H6 | `backend/src/fin/security/hash-chain-verifier.postgres.test.js` | Superuser (test-only) `UPDATE … SET action = 'tamper'` → verifier `broken = true` at that step. Genesis walk otherwise succeeds |
| H7 | `backend/src/fin/security/two-admin.postgres.test.js` | Self-approval rejected; one approver leaves request not `APPROVED`; two distinct elevated approvers succeed for `PLATFORM_ADMIN_RECOVERY` / `AUDIT_RETENTION` / platform `LARGE_REFUND` |
| H8 | `backend/src/fin/security/erasure-pseudonymise.postgres.test.js` | After erasure: `buyer_legal_name` / email / address pseudonymised; `buyer_tax_id` + `jurisdiction` intact; `invoices.total_minor` unchanged; R070/R073/R001 still green; `actor_email_snapshot` unchanged; `tenant_id` **not** retargeted to tombstone |
| H9 | `backend/src/fin/security/erasure-legal-hold.postgres.test.js` | `legal_hold=true` → erasure blocked (`BLOCKED_LEGAL_HOLD`) |
| H10 | `backend/src/fin/security/recon-role-grants.postgres.test.js` | `fin_recon_role` INSERT `reconciliation_checks` ok; INSERT `ledger_postings` → insufficient privilege |
| H11 | `backend/src/phase-7f3-wiring.test.js` | Every new admin mutation listed in §5 is in the inventory (already the E1/E2 pattern on `16beece`) |
| H12 | `backend/src/fin/security/force-rls.postgres.test.js` | `relforcerowsecurity = true` on every tenant-scoped `fin.*` table |

Auth-only tests (may live outside `fin/` but still on the postgres job when they touch DB): TOTP enable bumps `token_version`; registration password min 12; bcrypt cost 12.

---

## 12. Live P0s this file does not remediate

| Finding | Scope |
|---|---|
| E-3 on `public.audit_log` | Stage 1 REVOKE + new `financial_audit_events`. Do not edit `009_audit_activity.sql` in Stage 0 |
| E1 / E2 | Already remediated on `16beece`. New surfaces copy §0 guards |
| E5–E9, E11–E13 | Auth/CSP/JWT/rate-limit — owning stages in §5–§8. No `server.js` edit now |
| C-1 pricing PATCH | Stage 4 + this file’s limiter/guard constraint |
| A/B-1, A-2, A-4 | Not a security-schema item |

---

## 13. A-Q6 / A-Q8 / A-Q9 close

- **A-Q6:** RLS grain is **`tenant_id` + `environment`**. Finance/ops add **`legal_entity_id`**. `holder_id` is app-layer. Platform-admin bypass = `requireElevated` **and** `requirePlatformAdmin` (`fin.platform_admin_bypass()`).
- **A-Q8:** RFC 8785 JCS confirmed. Field list unchanged from A §12.5. Genesis = 64-zero hex per environment. No legacy backfill into the chain.
- **A-Q9 / R2-3:** DL-041 — pseudonymise-in-place; legal-hold blocks; tombstone is display-only; tax_id / jurisdiction stay; `actor_email_snapshot` stays; invoices / rated_usage / payments keep their `tenant_id`.
