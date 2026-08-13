# AI Handover — Tenant Authorization and Architecture

**Handover date:** 2026-08-10  
**Repository:** `RedMugsy/Real-Estate-Bazaar`  
**Workspace:** `C:\Users\AliAchkar\Documents\kimi\workspace\souq-ajjar-realestate`  
**Current branch:** `feature/image-watermark-optimization`  
**Default branch:** `main`  
**Current HEAD:** `64fb3d71e750e0080f8117438209298fdf4ee687`  
**Baseline main:** `b97d9a4`  
**Tenant migrations deployed:** No  
**Identity migration `027` deployed:** No

## 1. Read this first — critical repository state

Do not run `git clean`, `git reset --hard`, switch branches destructively, rebase, merge, or cherry-pick until the branch composition is deliberately resolved with the user.

The current branch is one commit ahead of `main`. Commit `64fb3d7` is titled:

> `feat(uploads): optimize property images and watermark with centered REB logo`

However, that commit is mixed. It contains:

- `backend/src/lib/image-processing.js` — 283 added lines.
- `backend/src/lib/image-processing.test.js` — 195 added lines.
- `backend/src/server.js` — 291 additions and 133 deletions.

The committed `server.js` changes include both image-processing work and canonical identity/tenant-facing work. At the same time, required identity and tenant modules imported by `server.js` remain untracked.

Consequences:

1. A clean checkout of HEAD does not contain the complete tenant/identity implementation.
2. The current working tree must be preserved as one unit until branch separation is decided.
3. Do not merge or cherry-pick `64fb3d7` blindly.
4. Ask the user before rewriting history or deciding whether tenant work should remain on the watermark branch.

Possible branch-resolution options that require user approval:

- **Option A — preserve this branch and commit the pending tenant work here.** Lowest immediate risk to the live working tree, but mixes two features.
- **Option B — create a tenant branch from `main` and manually transplant tenant portions, separating image processing from identity/tenant work.** Cleaner history, but higher risk because `server.js` contains intertwined changes.
- **Recommendation:** make a safety branch or patch backup first, then use Option B with a careful hunk-level transplant. Do not execute this recommendation without user approval.

## 2. User operating constraint

The user explicitly instructed:

> Do not make decisions on my behalf. Raise to me anywhere a decision needs to be made.

When a business or branch decision is required, present:

1. Available options.
2. Pros and cons.
3. A recommendation.
4. Which option best matches established practice.

Do not silently classify platform staff, agencies, memberships, asset ownership, exit outcomes, or routing policy.

## 3. Approved product and authorization model

The approved architecture is recorded in:

- `docs/tenant-authorization-architecture.md`

Treat that document as the product baseline. Core decisions already approved:

### Identity and authority

- `users` is the durable authentication principal.
- `agents` is a professional/public profile, not an authorization role.
- Canonical identity uses shared IDs: `users.id = agents.id`.
- `platform_admin` is exclusively for explicit platform staff.
- Platform authorization is stored in `users.platform_role`.
- Tenant permissions must never be inferred from global user roles.
- Tenant Admin means a tenant membership with role `owner` or `admin`.

### Tenants and memberships

- Every agent has one durable personal tenant and is its owner.
- Every agency has one agency tenant.
- Agency membership does not destroy the agent profile or personal tenant.
- Tenant roles: `owner | admin | member | guest`.
- Affiliation modes: `personal | exclusive | non_exclusive`.
- At most one active exclusive agency membership per user.
- Multiple guests are allowed.
- For a non-exclusive agency relationship, Tenant Admin explicitly chooses `member` or `guest`.
- Admin and owner agency memberships are exclusive.
- Guest memberships are non-exclusive.
- A tenant must retain at least one active owner.

### Agency commercial control

- Agency-context work is governed by the agency tenant.
- Agency grants and revokes spending rights.
- Exclusive agency work spends directly from the agency wallet.
- Non-exclusive work spends from the wallet belonging to the selected work context.
- Agency allowances are revocable limits, not irreversible balance transfers.
- Exclusive policy/template enforcement supports `required`, `default`, and `optional`.
- Non-exclusive policy/templates are defaults unless a separate explicit agreement says otherwise.

### Lead routing

- Tenant Admin owns routing strategy and configuration.
- Strategies: `round_robin`, `first_response`, `least_loaded`, `weighted`, and `manual`.
- Configuration includes eligibility, claim timeout, response SLA, cooldown, retries, and escalation.
- Claim timeout and meaningful-response timeout are separate lifecycle events.

### Relationship semantics

- Distinguish buyer/tenant representation, seller/landlord mandate, and prior-interaction affinity.
- Exclusive buyer representation routes the buyer-side inquiry to the buyer agent even when another agent owns the listing.
- The listing agent remains seller/listing-side.
- Non-exclusive buyer representation requires buyer choice.
- Affinity alone does not override listing-side routing.

### Assets and exits

- Ownership class is personal tenant, agency tenant, or shared.
- Ownership, custody, provenance, and current assignment are separate facts.
- Agency-owned and agency-sourced assets remain with the agency.
- Agent-sourced `case_review` assets require dual approval.
- Transfers are explicit and audited.
- Platform staff may facilitate disputes but do not decide legal ownership.

## 4. Current working tree

At handover capture, modified tracked files were:

- `backend/src/auth.js`
- `backend/src/modules/area-intelligence/interface/admin-routes.js`
- `backend/src/modules/area-intelligence/interface/inspector-routes.js`
- `backend/src/modules/market-pricing/interface/admin-routes.js`
- `backend/src/modules/market-pricing/interface/role-routes.js`
- `backend/src/modules/whatsapp-listings/interface/admin-routes.js`
- `backend/src/modules/whatsapp-listings/interface/agency-routes.js`
- `backend/src/modules/whatsapp-listings/platform-adapter.js`
- `backend/src/modules/whatsapp-listings/tests/pipeline-integration.test.js`
- `backend/src/persistence/dal.test.js`
- `backend/src/persistence/table-mapper.js`
- `backend/src/platformModel.js`
- `backend/src/seed.js`
- `src/api/client.ts`
- `src/context/AuthContext.tsx`

Untracked files were:

- `backend/src/auth-principal.test.js`
- `backend/src/identity.js`
- `backend/src/notification-preferences.js`
- `backend/src/notification-preferences.test.js`
- `backend/src/persistence/migrations/027_user_principals_notification_prefs.sql`
- `backend/src/persistence/migrations/028_tenant_authorization_foundation.sql`
- `backend/src/persistence/tenant-migration.test.js`
- `backend/src/tenant-authorization.js`
- `backend/src/tenant-authorization.test.js`
- `docs/tenant-authorization-architecture.md`

This handover document is an additional untracked file until committed.

Line-ending warnings report that Git may replace LF with CRLF in several edited files. `git diff --check` passed; do not perform broad line-ending normalization.

## 5. Implemented work

### 5.1 Canonical identity and notification preferences

Implemented but uncommitted/unreleased:

- `backend/src/identity.js`
  - `findUserById`
  - `findUserByEmail`
  - `findAgentForUser`
  - `createAgentAccount`
  - `updateUser`
  - `updatePlatformRole`
  - Account creation atomically creates user, agent profile, personal tenant, and personal owner membership.
- `backend/src/auth.js`
  - Loads the canonical user and linked agent.
  - Validates token version from the canonical user.
  - Exposes `platform_role` separately from agent persona role.
- `backend/src/notification-preferences.js`
  - Canonical typed notification preference normalization and idempotent defaults.
- `backend/src/auth-principal.test.js`
- `backend/src/notification-preferences.test.js`

### 5.2 Migration `027`

File:

- `backend/src/persistence/migrations/027_user_principals_notification_prefs.sql`

Purpose:

- Backfill/canonicalize users from agent authentication state.
- Preserve shared principal IDs.
- Restore identity-related foreign keys.
- Remove credential/session data from agent profile JSON.
- Compact duplicate notification preferences fail-closed.
- Add canonical uniqueness.

An earlier review found unsafe precedence. That code was corrected:

- Historical agent auth state is authoritative during the cutover because the pre-cutover application authenticated from agents.
- `password_hash`, role, token version, and session timestamps no longer allow stale user JSON to override the historical auth source.
- Non-auth user metadata remains preserved.

Do not deploy `027` independently from a reviewed release plan. It is currently untracked and has not run in production.

### 5.3 Platform role separation

Implemented:

- `users.platform_role` is introduced by migration `028`.
- The only valid non-null value is `platform_admin`.
- Legacy `platform_admin` values are migrated to `platform_role`.
- Ambiguous legacy `admin` accounts cause migration failure and require explicit staff classification.
- Authentication middleware exposes `req.user.platform_role`.
- Platform admin guards in server and modules check `platform_role`.
- `updatePlatformRole` increments token version and does not write platform authority into `agents`.
- Frontend `AuthContext` derives `isAdmin` from `platform_role`.
- Generic admin promotion was narrowed to `platform_admin | null`.

### 5.4 Migration `028` tenant foundation

File:

- `backend/src/persistence/migrations/028_tenant_authorization_foundation.sql`

Implemented tables and schema:

- `tenants`
- `tenant_memberships`
- `tenant_lead_routing_policies`
- `contact_relationships`
- `lead_assignments`
- `property_disposition_cases`

Implemented property columns:

- `tenant_id`
- `ownership_type`
- `custody_tenant_id`
- `source_user_id`
- `exit_disposition`

Implemented invariants:

- One personal tenant per canonical agent.
- One agency tenant per agency.
- Personal tenant membership shape is enforced by trigger.
- At most one active exclusive membership per user.
- One active/invited/suspended membership per tenant/user.
- Guest memberships must be non-exclusive.
- Owner/admin agency membership mode must be exclusive.
- Last active tenant owner cannot be removed; enforcement is deferred for atomic owner transfers.
- Existing agency owner authority comes from `agencies.owner_id`, not inferred admin roles.
- Transition-compatible legacy owner memberships are restored from explicit `agencies.owner_id` authority.
- Existing agency memberships backfill as exclusive because the legacy application enforced one active affiliation.
- Existing properties backfill deterministically to agency or personal tenant ownership.
- Assigned listings that cannot be classified cause migration failure.

### 5.5 DAL mapping

`backend/src/persistence/table-mapper.js` maps:

- `tenants`
- `tenant_memberships`
- `tenant_lead_routing_policies`
- `contact_relationships`
- `lead_assignments`
- `property_disposition_cases`
- New property ownership fields
- `users.platform_role`

### 5.6 Tenant authorization service

File:

- `backend/src/tenant-authorization.js`

Implemented operations:

- Deterministic personal and agency tenant IDs.
- Explicit agency membership input validation.
- Canonical membership lookups.
- User and agency membership listing.
- Atomic agency plus tenant plus owner creation.
- Atomic legacy/canonical agency member creation.
- Atomic constrained membership update.
- Atomic legacy/canonical membership termination.
- Owner role cannot be granted or changed through generic invitation/update APIs.
- Admin role can only be granted by an owner in the HTTP path.

Associated tests:

- `backend/src/tenant-authorization.test.js`

### 5.7 Server/API integration

The current `backend/src/server.js` includes tenant-facing changes, but remember that this file is already committed in mixed commit `64fb3d7`.

Implemented API behavior includes:

- Registration creates personal tenant context through `createAgentAccount`.
- Login and `/api/auth/me` return:
  - `platform_role`
  - legacy singular exclusive `affiliation`
  - all active agency `affiliations`
  - `personal_tenant_id`
- `/api/auth/tenant-context` returns active memberships and tenant records.
- Agency creation uses atomic `createAgencyWithOwner`.
- Agency application approval requires explicit `role` and `affiliation_mode`.
- Direct invitation requires explicit `role` and `affiliation_mode`.
- Owner grant is blocked outside an ownership-transfer workflow.
- Admin grant is limited to a tenant owner.
- Generic membership update cannot change status or ownership.
- Platform admin checks use `platform_role`.

### 5.8 Legacy compatibility integration

Partially implemented:

- `backend/src/platformModel.js` resolves active exclusive affiliation from canonical memberships.
- Agency membership termination writes canonical and legacy records atomically.
- Agency-tied reassignment preserves tenant ownership fields.
- Market Pricing agency portfolio uses canonical tenant membership helpers.
- WhatsApp agency admin routes use canonical tenant membership helpers.
- WhatsApp platform adapter chooses the active exclusive membership explicitly.

Legacy tables remain during transition. Do not drop `agency_members` yet.

## 6. Validation evidence as of handover

### Fresh checks completed on 2026-08-10

#### Targeted tenant migration integration suite

Result: **6/6 passed**.

The suite creates a disposable PostgreSQL database and validates migrations `027` and `028` without requiring local PostGIS migrations `024–026`.

Verified:

1. Historical agent auth state wins over stale legacy user auth state without preserving ambiguous admin privilege.
2. Personal tenant and owner membership are created.
3. Explicit agency owner authority restores both legacy and canonical owner memberships.
4. Invalid personal memberships are rejected.
5. A second active exclusive membership is rejected.
6. The last active tenant owner cannot be ended.

Test file:

- `backend/src/persistence/tenant-migration.test.js`

#### Focused authorization tests

Result: **8/8 passed**.

- `backend/src/auth-principal.test.js`
- `backend/src/tenant-authorization.test.js`

#### Full test suite

Result: **not fully green**.

- 120 tests passed.
- 1 test failed.
- 22 tests skipped.
- 20 files passed, 1 failed, 4 skipped.

Current failure:

- `backend/src/modules/market-pricing/tests/route-handlers.test.js`
- Test: `Agent and Agency Pricing Routes > rejects agency portfolio access without active membership`
- Expected `res.status(403)`, but the status spy was not called.

Likely cause:

- The route now imports `listUserAgencyMemberships` from `tenant-authorization.js`.
- The old route test mocks the legacy DAL membership lookup and does not mock the canonical helper.
- Update the test/mocking boundary to canonical memberships. Do not revert production code to legacy `agency_members` just to satisfy this test.

Skipped database suites occur when Vitest does not inherit `DATABASE_URL`. The targeted migration suite was run with `.env` loaded into the child process.

#### TypeScript

Result: **passed**.

#### ESLint

Result: **passed with warnings**.

- 0 errors.
- 81 warnings.
- Warnings include existing unused imports, hook dependencies, and Fast Refresh notices.
- TypeScript 5.9.3 is newer than the officially supported range for the installed typescript-eslint parser; this is a warning, not a failure.

#### Production build

Result: **passed**.

- Vite transformed 1,680 modules.
- Build completed in approximately 3.79 seconds in this session.
- Output has a chunk-size warning; main JS was approximately 863 KB / 220 KB gzip.

#### Syntax and patch integrity

Result: **passed**.

- `node --check` passed for server, identity, tenant authorization, and platform model files.
- `git diff --check` passed.

### Full DAL suite limitation

The configured local PostgreSQL server lacks the PostGIS extension. Running the full disposable DAL migration chain reaches migration `024` and fails with:

> `extension "postgis" is not available`

This is an environment limitation, not evidence that `027` or `028` failed. The separate targeted migration suite passes. Before release, rerun the full chain against a PostGIS-capable disposable/restored database.

## 7. Known incomplete work and risks

### 7.1 Fix the one stale test first

Update Market Pricing route tests to mock canonical tenant membership helpers. Then rerun the full suite.

### 7.2 Remaining legacy membership reads

A search still finds legacy `agency_members` reads in server and white-label code. Important locations include:

- Property/listing agency context in `backend/src/server.js`.
- Inquiry/lead agency resolution in `backend/src/server.js`.
- Reminder/template policy authorization in `backend/src/server.js`.
- Public agency/member serialization in `backend/src/server.js`.
- `backend/src/whiteLabel.js` lead/inventory logic.
- One legacy lookup in `backend/src/platformModel.js` is intentional for transition ID compatibility during termination, but review it carefully.

Replace authorization and active-context decisions with canonical tenant membership helpers. Legacy reads may remain only where needed for transition serialization or linkage.

Do not choose an arbitrary agency when a user has multiple non-exclusive memberships. Require or carry explicit tenant/work context.

### 7.3 Agency commercial controls not implemented

Current credit code is contrary to the approved model:

- `backend/src/modules/whatsapp-listings/application/credits.js`
- `allocateAgencyToAgent` consumes agency credits and tops up the agent balance.

This is an irreversible transfer and must be replaced by a revocable tenant allowance model.

Recommended next additive migration: `029_tenant_commercial_controls.sql`, containing concepts such as:

- Tenant wallets or a tenant scope added to existing balance records.
- Membership spending allowances.
- Limit, used, reserved, status, effective/expiry dates, grantor, and revocation metadata.
- Atomic reservation/consumption against the owning tenant wallet.
- Audit trail for grant, adjustment, reservation, consumption, release, expiration, and revocation.

Do not silently choose allowance defaults; expose them to Tenant Admin.

### 7.4 Entitlement/policy precedence not implemented

Current code:

- `backend/src/modules/whatsapp-listings/application/entitlements.js`

Current precedence is agent over agency over platform. This conflicts with required agency policy enforcement.

Needed:

- Work-context-aware entitlement resolution.
- Per-policy/template enforcement mode: `required | default | optional`.
- Exclusive agency mandatory policy cannot be overridden by an agent setting.
- Non-exclusive agency policy is a default unless an explicit agreement says otherwise.
- Templates need the same enforcement semantics.

### 7.5 Routing schema exists; routing lifecycle service does not

Migration `028` creates policy, relationship, and assignment tables, but no complete domain service or workers exist.

Needed:

- Policy CRUD restricted to Tenant Admin.
- Scope/eligibility evaluation.
- Relationship-first routing according to policy.
- Round robin, first response, least loaded, weighted, and manual strategies.
- Atomic offer/claim/respond/requeue/escalate lifecycle.
- Claim timeout worker.
- Meaningful-response timeout worker.
- Cooldown and retry exclusion.
- Audited manual override.
- Buyer-side and listing-side notifications without transferring the wrong relationship.

Current `backend/src/whiteLabel.js::resolveLeadAgent` is still a listing-agent/static-priority resolver and must be replaced or wrapped by the new service.

### 7.6 Asset disposition schema exists; workflow does not

Migration `028` creates `property_disposition_cases`, but no complete service/API exists.

Needed:

- Initiate case on membership exit for `case_review` assets.
- Separate agent and agency decisions.
- Dual approval before transfer.
- Dispute state when decisions conflict.
- Preserve agency custody while pending/disputed.
- Explicit atomic transfer of tenant ownership/custody.
- Immutable provenance/audit events.
- Do not let platform staff decide ownership.

Current `endAffiliation` still blocks on legacy `agency_tied` listings rather than orchestrating the complete disposition workflow.

### 7.7 Frontend tenant context is incomplete

Implemented:

- `src/context/AuthContext.tsx` reads `platform_role` for Platform Admin UI.
- `src/api/client.ts` narrows platform role promotion typing.

Still needed:

- Types for all affiliations and tenant memberships.
- API client method for `/auth/tenant-context`.
- Explicit active work-context selector.
- Personal versus agency tenant switcher.
- Tenant Admin views for member role and affiliation mode.
- Routing policy configuration.
- Wallet allowance controls.
- Policy/template enforcement controls.
- Exit/disposition review workflow.
- Update `src/types/index.ts`, which still primarily exposes the legacy singular affiliation shape.
- Review `AgencyManagementPage.tsx`; it is still largely legacy-role and legacy-exit oriented.

### 7.8 Owner transfer workflow does not exist

The database uses a deferred last-owner constraint so atomic transfer is possible, but no ownership-transfer service/API/UI has been implemented. Generic membership paths correctly refuse owner changes.

### 7.9 Migration immutability

Migrations `027` and `028` are untracked and not deployed. They may still be edited during review. Once applied anywhere shared, treat them as immutable and add follow-up migrations instead.

## 8. Production and backup state

No tenant/identity migration has been deployed.

Production URL:

- `https://re-bazaar-production.up.railway.app`

Railway identifiers:

- Project: `d4eb253e-d1b8-4916-a8d5-8856c4d6b540`
- App service: `1f443822-4a18-42ea-a81d-1032b856d904`
- PostGIS service: `9e8b42e1-2343-4b7a-a3f5-c97a2ce6ab4e`
- Original rollback database: `87d6ef46-6f53-4315-ad74-b2bea385411d`

Verified pre-migration backup:

- Path: `C:\Users\AliAchkar\Documents\database-backups\souq-ajjar-realestate\postgis-production-pre-migration-027-20260809T114356Z.dump`
- Size: 566,542 bytes.
- SHA-256: `6AD3055BE9990E0E6A0EEA19DDE31207BD25564DAD6AA5D94437551557B341D9`

Do not overwrite or delete this backup or the rollback database.

Earlier restored-production validation for migration `027` produced:

- 42 users.
- 42 agents.
- 42 notification preference rows.
- 41 default preferences and one customized preference.
- No preference duplicates.
- No agent credential/session JSON.
- Stable counts across two startup passes.

That validation preceded migration `028`. A new restored-production run of the complete chain is required before deployment.

## 9. Recommended continuation sequence

This sequence follows the approved architecture but still requires user approval for branch/history changes.

1. Preserve the entire current working tree and resolve branch separation with the user.
2. Fix the stale Market Pricing route test to mock canonical memberships.
3. Rerun all unit tests and focused tenant tests.
4. Replace remaining authorization/context reads of `agency_members` with canonical helpers.
5. Add integration coverage for atomic agency creation, admission, update, termination, and owner continuity.
6. Add migration `029` and services for tenant wallets and revocable membership allowances.
7. Replace irreversible `allocateAgencyToAgent` behavior.
8. Add policy/template enforcement modes and work-context-aware resolution.
9. Implement routing policy CRUD and assignment lifecycle.
10. Implement relationship-first buyer/listing-side routing semantics.
11. Implement asset disposition and dual-approval exit workflow.
12. Add frontend tenant/work-context selection and Tenant Admin controls.
13. Run full test, typecheck, lint, build, syntax, and migration gates.
14. Restore the production backup to a PostGIS-capable temporary database and apply the full migration chain twice/start the app twice to verify idempotency.
15. Audit row counts, owner continuity, exclusivity, platform roles, credential scrubbing, preference uniqueness, property ownership, and foreign keys.
16. Commit and push only after the user approves branch composition.
17. Deploy only after explicit approval and then monitor Railway health and invariants.

## 10. Useful validation commands

Run from the repository root.

Full tests:

`npm test`

Focused authorization tests:

`npx vitest run backend/src/auth-principal.test.js backend/src/tenant-authorization.test.js backend/src/notification-preferences.test.js`

Load `.env` securely and run the targeted disposable PostgreSQL tenant migration test on Windows:

`node -e "import('dotenv/config').then(() => import('child_process')).then((m) => { const r = m.spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'backend/src/persistence/tenant-migration.test.js'], { stdio: 'inherit', env: process.env }); process.exit(r.status === null ? 1 : r.status) })"`

Typecheck:

`npm run typecheck`

Lint:

`npm run lint`

Build:

`npm run build`

Patch integrity:

`git diff --check`

Repository state:

`git status --short --branch`

Compare the mixed branch commit with main:

`git diff --stat main..HEAD`

## 11. Definition of done for this workstream

Do not call the tenant architecture complete until all of the following are true:

- Platform staff access is exclusively `platform_role` based.
- Tenant permissions are exclusively membership based.
- Every agent has a durable personal tenant.
- Every agency has an agency tenant and an active owner.
- Multi-affiliation behavior never depends on an arbitrary first match.
- Tenant work context is explicit throughout APIs and UI.
- Wallet spending uses revocable allowances rather than transfers.
- Mandatory agency policy cannot be bypassed by agent settings.
- Routing is Tenant-Admin-configurable and lifecycle-safe.
- Buyer-side representation and listing-side mandate remain distinct.
- Asset ownership, custody, source, assignment, and transfers are auditable.
- Exit case review requires dual approval.
- Remaining legacy membership reads are compatibility-only and documented.
- Full tests pass with no stale mocks.
- Full migrations pass on a PostGIS-capable restored production copy.
- Migration repeat/startup repeat is idempotent.
- Branch composition is approved and cleanly committed.
- Production deployment and post-deploy invariants are explicitly verified.

## 12. Immediate first action for the next AI

Start by reading, in order:

1. This handover.
2. `docs/tenant-authorization-architecture.md`.
3. `backend/src/persistence/migrations/027_user_principals_notification_prefs.sql`.
4. `backend/src/persistence/migrations/028_tenant_authorization_foundation.sql`.
5. `backend/src/tenant-authorization.js`.
6. `backend/src/identity.js`.
7. Current `backend/src/server.js` and its diff against `main`.
8. The failing Market Pricing route test.

Then report the mixed-branch hazard to the user and request the branch-separation decision before any destructive Git operation. Non-destructive test repair and code review can continue in the current working tree.
