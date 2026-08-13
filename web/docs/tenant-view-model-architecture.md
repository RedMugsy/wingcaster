# Tenant View Model & Interaction Architecture — v2

**Decision date:** 2026-08-11 (v1); revised 2026-08-11 (v2)
**Status:** Approved product baseline; supersedes v1 based on multi-reviewer critique
**Relates to:** `tenant-authorization-architecture.md` (data model), `AI-HANDOVER-2026-08-10-TENANT-AUTHORIZATION.md` (implementation continuation)
**Scope:** How agents perceive, select, and act within tenants across the platform surface (backend routing, API design, frontend app shell, cross-tenant safety, person identity, resource ownership, action authorization).

---

## 0. The one invariant to memorize

> **The UI may suggest context. Assets establish attribution. Authorization establishes permission. The server establishes truth.**

Everything below is elaboration of this sentence.

---

## 1. Context — why this document exists

The `tenant-authorization-architecture.md` doc defines the *data model* for tenants, memberships, roles, affiliation modes, ownership, and routing. It answers *what a tenant is*.

It does NOT answer:

- How does an agent tell the platform "I'm working under Agency Elite right now" when creating something?
- How does the platform prevent an agent from accidentally launching a WhatsApp campaign for an Elite listing using Cedar's WhatsApp account?
- What does the agent's app actually LOOK like when they belong to three tenants at once?
- How does the platform know which agency owns a lead, a contact, a listing, a message, a wallet charge?
- Who owns a person — the human being — across tenants that all know them?
- Who resolves the platform's own role when an agent departs and both parties claim an asset?

Two competing mental models were considered:

**Model A — Session-wide workspace context (Slack pattern).**
Agent picks a workspace on login. Every request in that session is stamped with that workspace. Switching workspaces means changing the whole app's context. Creation actions inherit the current workspace.

**Model B — Asset-level attribution with consolidated view (Gmail pattern).**
Every asset (listing, contact, conversation, campaign) carries its own explicit tenant attribution assigned at creation time. The agent's app is a consolidated view across all their tenants. Actions inherit tenant from the asset being acted upon. Creation moments are the only time the agent must explicitly choose.

**Model B is the approved baseline.** Reasoning:

- Real-estate assets have real financial/legal ownership implications that outlive the session. A listing published under Elite must remain unambiguously Elite forever, regardless of what tab the agent is on when editing it later.
- Agents benefit from a consolidated view (checking messages across all their agencies in one inbox), while agencies benefit from durable, unambiguous ownership. Model B accommodates both.
- Session-wide context introduces the class of bug where "current UI state" quietly becomes "asset attribution", producing misattribution that only surfaces months later at commission or departure.
- Historical audit trails are trivial: each asset's tenant is known from its creation record. No dependency on session state.

**Strategic positioning:** the platform serves **two customer types**:

1. **Agencies** — pay for seats, own their tenant's assets, control their tenant's policies. Their retention depends on the platform respecting agency ownership.
2. **Agents** — produce the value that makes agencies stay; their personal tenant is their durable identity across employer changes.

Every place where agent flexibility conflicts with agency control becomes an **explicit engagement policy** (§8) — TA-configured, agent-signed, platform-enforced. Neither party is silently favored; conflicts are named and mediated by explicit consent.

---

## 2. The five invariants (TL;DR)

Before the detailed principles, five compressed invariants any engineer or product owner should be able to recite:

| # | Invariant |
|---|---|
| I1 — **Ownership** | Every durable asset has exactly one authoritative owning tenant at any point in time. |
| I2 — **Attribution** | Ownership is established at creation or through an explicit, audited transfer operation. Never as a side effect of viewing, editing, or messaging. |
| I3 — **Authorization** | Every action is authorized against the actor's current memberships, the assets/resources involved, and the operation's declared intent. Client-supplied confirmation is UX, not authority. |
| I4 — **Context** | UI tabs, headers, and session state are presentation context only. They never establish ownership and never grant permission. |
| I5 — **Provenance** | Ownership assignment and consequential state changes retain immutable historical attribution with source metadata. |

These five compress the ten principles that follow. If the ten ever contradict the five, the five win.

---

## 3. The ten principles (detailed)

| # | Principle | Rule |
|---|---|---|
| 1 | **Assets are the source of truth** | Every listing, contact, conversation, campaign, financial transaction, task, and opportunity carries an explicit `tenant_id` assigned at creation time. This attribution is the durable ownership record. It is not modified by ordinary CRUD operations — only by the explicit TRANSFER command (§6). |
| 2 | **Actions inherit tenant from assets** | Reply to a conversation → inherits the conversation's tenant. Edit a listing → inherits the listing's tenant. Generate AI content for a listing → inherits the listing's tenant. The platform never re-asks the agent which tenant applies to an existing asset. |
| 3 | **Creation moments require conscious choice** | For non-exclusive agents, every asset-creation action requires an explicit choice of which tenant the new asset belongs to. Selection is conscious — never inferred from the currently-viewed tab. The only exception is creation launched from a tenant-owned parent asset (e.g., "New Contact" from an Elite listing detail page), which may preselect the parent's tenant with a visible confirmation state ("Suggested from parent listing — click to change"). |
| 4 | **App shell is consolidated by default** | The app opens on an "All" view that shows the agent's assets across every tenant they belong to. Focus is achieved through tab filtering, not through workspace switching. |
| 5 | **Tabs are view filters, not session state** | Tabs at the top of the app shell filter what the agent sees. They do NOT determine the tenant of new assets (see Principle 3 exception). A tab is a lens, not a mode. The `X-Active-Tenant-Id` header expressing which tab is active is an untrusted UI hint — the server intersects it with the user's proven memberships and never trusts its value. |
| 6 | **Tabs mirror active memberships** | A tab appears when a membership is activated (post-invite-acceptance or during registration for personal). A tab disappears when the membership ends (per §11 grace-period rules). New tabs are visually highlighted for the agent's first three sessions after appearing. For agents with more than 5 active memberships, tabs collapse into an "Agencies" dropdown showing all memberships — Personal, All, and Agencies-dropdown remain as top-level. |
| 7 | **Cross-tenant operations are forbidden by default** | Any mutation whose asset graph spans more than one tenant is rejected unless the operation is explicitly registered in the cross-tenant allow-list (§5) with operation-specific authorization policy. Client-supplied `operation_intent` expresses what the client is trying to do; server independently evaluates whether the operation is permitted based on the actor's memberships, the assets involved, and the operation's authorization policy. **No blanket "cross_tenant_confirmation" flag exists.** |
| 8 | **Contact ownership follows the touchpoint** | If a lead reaches the agency-side of a listing (via agency listing page, agency lead form, agency-branded landing), the contact belongs to the agency. If the lead reaches the agent directly (personal number, referral, networking), the contact belongs to the agent. **Cross-tenant linking of records to the same real person is a separate concern handled by the Person Identity domain (§7)**, not by contact-record duplication. |
| 9 | **Agency policy controls departure semantics; platform does not adjudicate** | Whether an outgoing exclusive agent can export contacts, keep templates, retain historical view is a per-agency policy configurable by the agency admin at invite time and signed by the agent. On disputed asset disposition, the platform **freezes** the disputed asset, **exposes** both parties' claims and evidence, and **does not decide**. Resolution mechanism is explicitly off-platform (their contract, their lawyers, local arbitration). Platform provides audit records; not verdicts. |
| 10 | **Historical audit trail is immutable** | Every action's tenant attribution AT THE TIME OF THE ACTION is recorded and cannot be silently rewritten. The `assets.tenant_id` column is the CURRENT owner (mutable through TRANSFER); the `asset_ownership_history` ledger records the full lineage (immutable, append-only). Retroactive re-attribution of history is impossible by design. |
| 11 | **Engagement policy is TA-set, agent-consented, platform-enforced** | The Tenant Admin defines what the agent can and cannot do while a member (personal-work status, other-agency rights, communication channels, AI-credit spending, public branding). The agent sees each policy dimension at invite acceptance and consents via cryptographic signature bound to their account. Post-activation, the platform actively enforces these policies at runtime. Any TA-side policy change pauses the membership until the agent re-signs the updated policy; refusal triggers the departure workflow under the previously-consented policy (grandfathered). |

Any deviation from these eleven principles requires explicit documented decision.

---

## 4. What "tenant" is and what it isn't

`tenant_id` alone was being overloaded to mean 6-8 different things. Explicit decomposition:

| Field | Meaning | Mutable? |
|---|---|---|
| `tenant_id` | Which tenant OWNS this asset (data ownership boundary) | Immutable via CRUD; mutable only via TRANSFER command |
| `created_by_user_id` | Which user CREATED this asset | Immutable |
| `responsible_tenant_id` | Which tenant currently MANAGES / is accountable for this asset (may equal `tenant_id`, or differ when responsibility temporarily delegated e.g. co-listing) | Mutable via explicit delegation command |
| `billing_tenant_id` | Which tenant's wallet PAYS for charges related to this asset (may equal `tenant_id`, or differ when a specific arrangement applies) | Mutable via explicit billing rule change |
| `channel_account_id` | Which specific tenant-bound channel account (WhatsApp Business number, email domain, SMS sender) is used for outbound related to this asset | Mutable per action, but constrained by cross-tenant compatibility rule (§9) |
| `source_tenant_id` | Which tenant the asset ORIGINATED from (immutable provenance — a listing acquired via referral from Elite retains `source_tenant_id = elite_tenant_id` even after transfer to Cedar) | Immutable |
| `tenant_assignment_source` | HOW the asset was assigned to its current tenant. Enum: `explicit_user_selection` / `parent_asset_inheritance` / `system_assignment` / `migration` / `transfer` / `import` / `integration` | Immutable per assignment; new assignment (transfer) creates new history entry with new source |

Not every asset type needs every field. Listings need most; a task attached to a listing may only need `tenant_id` (inherited from parent) plus `tenant_assignment_source = parent_asset_inheritance`. But the schema supports the full model where relevant.

**Why this matters:** validation, billing, and audit code must reason about which field it cares about. A billing query looks at `billing_tenant_id`. An ownership dispute looks at `tenant_id` and `source_tenant_id`. A channel-compatibility check looks at `channel_account_id` against `tenant_id`. Conflating these produced bugs where "the wrong agency got charged for the right listing" would ship silently.

---

## 5. Cross-tenant operations — deny by default, allow-list with authorization

Principle 7 formalized:

**The invariant:** any mutation whose asset graph spans more than one tenant is REJECTED unless the operation is explicitly registered in the cross-tenant allow-list AND the actor is authorized for the specific cross-tenant policy that applies.

### 5.1 Client expresses intent; server evaluates

Client sends:

```json
{
  "operation": {
    "type": "REFER_CONTACT_TO_AGENCY",
    "source_tenant_id": "personal:ali",
    "target_tenant_id": "agency:elite",
    "authorization_basis": "REFERRAL_AGREEMENT_MEMBER"
  },
  "contact_id": "contact_nadine",
  "referral_terms": { "commission_split_pct": 25, "expiry": "2026-12-31" }
}
```

Server independently:
1. Resolves the actor's memberships in both tenants.
2. Looks up the `REFER_CONTACT_TO_AGENCY` operation's authorization policy.
3. Verifies actor has the required role in the source tenant for a referral.
4. Verifies actor has the required role in the target tenant for accepting a referral.
5. Verifies both tenants' policies permit referral (opt-in per-tenant).
6. Records the operation as an audit event with full context.
7. Executes if all checks pass; rejects with `POLICY_VIOLATION_*` code otherwise.

**Client's `authorization_basis` is intent, not authority.** A malicious client sending `authorization_basis: "REFERRAL_AGREEMENT_MEMBER"` gets nothing unless the server independently confirms the referral relationship exists.

### 5.2 The initial allow-list

Registered cross-tenant operations for the initial platform. Each has its own authorization policy stored server-side.

| Operation | Purpose | Auth basis required |
|---|---|---|
| `REFER_CONTACT_TO_AGENCY` | Ali (personal or Elite) refers a lead to Cedar | Referral agreement between source and target tenants (opt-in per pair) |
| `REFER_LISTING_TO_AGENCY` | Elite refers a listing to Cedar for co-representation | Co-listing agreement between source and target tenants |
| `TRANSFER_ASSET_OWNERSHIP` | Elite transfers a listing outright to Cedar | Owners of both tenants agree; dual approval |
| `LINK_PERSON_IDENTITIES_ACROSS_TENANTS` | Both parties agree two records are the same person | Explicit consent from both tenant-of-record parties (§7) |
| `SHARE_TEMPLATE_ACROSS_TENANTS` | Elite shares a message template with Cedar | Explicit share operation from Elite admin; Cedar admin accepts |
| `PLATFORM_AGGREGATE_ANALYTICS` | Platform admin runs aggregate metrics | Platform admin role required; audit-logged; excludes tenant-sensitive financial detail unless separately authorized |

Any operation not on this list that spans multiple tenants → server returns 409 `POLICY_VIOLATION_UNAUTHORIZED_CROSS_BOUNDARY_OPERATION` with the actor's involved tenants enumerated and a suggestion to define a legitimate operation type if a valid business case exists. New allow-list entries require explicit product-owner approval and a documented authorization policy.

### 5.3 Terminology

Use **"unauthorized cross-boundary operation"** — not "illegal combination" or "cross-tenant violation". "Illegal" implies legal illegality (jurisdictional laws); these are authorization/domain-policy violations.

---

## 6. Asset ownership: current vs history, and the TRANSFER command

### 6.1 Two tables, not one column

```sql
-- Current owner: the mutable pointer
ALTER TABLE properties ADD COLUMN tenant_id TEXT NOT NULL REFERENCES tenants(id);
ALTER TABLE contacts   ADD COLUMN tenant_id TEXT NOT NULL REFERENCES tenants(id);
-- ... every asset type gets tenant_id + supporting decomposition fields per §4

-- History: the immutable ledger
CREATE TABLE asset_ownership_history (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL,           -- 'properties', 'contacts', 'conversations', etc
  asset_id TEXT NOT NULL,
  from_tenant_id TEXT,                -- NULL for creation events
  to_tenant_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,       -- 'CREATE' | 'TRANSFER' | 'MIGRATE' | 'CORRECT_ATTRIBUTION'
  operation_id TEXT,                  -- FK to the specific operation record if applicable
  performed_by_user_id TEXT NOT NULL REFERENCES users(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  authorization_basis TEXT,
  reason TEXT,
  approved_by_user_ids JSONB,         -- array for dual-approval cases
  asset_snapshot JSONB,               -- key fields at time of operation
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_asset_ownership_history_asset ON asset_ownership_history(asset_type, asset_id, performed_at);
```

Every CREATE, TRANSFER, or CORRECT_ATTRIBUTION operation writes one row to `asset_ownership_history`. The table is append-only enforced by trigger (no UPDATE, no DELETE).

**Never:** rewrite historical rows to claim retroactive attribution. If Listing 123 was Elite from 10:01 to 14:22 and then transferred to Cedar, the history reads exactly that. Any query "who owned this at time T" returns the correct answer from history, not from the mutable pointer.

### 6.2 TRANSFER as a separate command

`PATCH /api/properties/:id` — mutate asset fields. Never accepts `tenant_id` in body. Server derives tenant from `properties.tenant_id` for authorization.

`POST /api/properties/:id/transfer` — the ONLY way to change `tenant_id`. Requires:
- Explicit `to_tenant_id` in body
- Explicit `authorization_basis` in body (referral / departure_disposition / co-listing_dissolution / etc)
- Server-side approval workflow appropriate to the basis (single-owner OR dual-approval depending on policy)
- Written reason
- On success: updates `properties.tenant_id`, writes history row, emits audit event, notifies both tenants' admins

Same pattern for every asset type. Contacts have `POST /api/contacts/:id/transfer`, conversations have `POST /api/conversations/:id/transfer`, etc.

### 6.3 Departure disposition — platform is not arbitrator

When an agent departs an agency, the platform applies engagement-policy departure rules to each asset:

- **Agency-owned, agency-sourced** → stays with agency, reassigned by TA. No dispute possible.
- **Agency-owned, agent-sourced** → enters `case_review` state (see below).
- **Agent-owned** (personal tenant assets) → stays with agent. No dispute possible.

**Case review state (disputed disposition):**

1. Asset frozen: no CRUD operations except read.
2. Both parties' claims exposed on the case detail page (evidence, notes, prior communications).
3. Platform provides a case-record page that both parties can share with their counsel.
4. Resolution mechanism is **off-platform**: their signed agreement, their contract's dispute clause, local arbitration or courts.
5. Both parties (or their authorized representatives) log the agreed resolution into the platform via `POST /api/cases/:id/resolve` with a signed acknowledgment. Platform records the resolution and executes the corresponding TRANSFER (or leaves the asset as-is if resolution says so).
6. If parties never resolve: asset remains frozen indefinitely. Platform does not force a decision. Statute-of-limitations questions are legal concerns, not platform concerns.

**The platform's role is documentary, not judicial.** No platform admin, employee, or algorithm decides who wins.

---

## 7. Person Identity as a first-class domain

Real people exist across tenant boundaries. Nadine is one human being; Elite has a record for her, Ali has a personal record for her, Cedar may have one too. Historically these were disconnected contact rows. This section defines the domain that lets them be optionally linked with consent, privacy, and audit.

### 7.1 Domain model

```sql
-- The durable person entity (platform-level, not tenant-owned)
CREATE TABLE persons (
  id TEXT PRIMARY KEY,                        -- durable identity across all tenants
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data_subject_deletion_state TEXT NOT NULL DEFAULT 'active'
    CHECK (data_subject_deletion_state IN ('active', 'deletion_requested', 'deleted_erased', 'deleted_anonymized')),
  data_subject_deletion_requested_at TIMESTAMPTZ,
  data_subject_deletion_completed_at TIMESTAMPTZ
);

-- Contacts remain per-tenant, now with a person_id pointer
ALTER TABLE contacts ADD COLUMN person_id TEXT REFERENCES persons(id) ON DELETE SET NULL;
CREATE INDEX idx_contacts_person_id ON contacts(person_id);

-- The link records themselves
CREATE TABLE identity_matches (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  match_status TEXT NOT NULL CHECK (match_status IN ('proposed', 'confirmed', 'rejected', 'withdrawn')),
  match_source TEXT NOT NULL CHECK (match_source IN ('manual', 'verified_phone', 'verified_email', 'algorithmic')),
  match_confidence NUMERIC(3,2),                 -- 0.00 to 1.00 for algorithmic
  proposed_by_user_id TEXT REFERENCES users(id),
  confirmed_by_user_id TEXT REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  rejected_by_user_id TEXT REFERENCES users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  link_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (link_visibility IN ('private', 'tenant_visible', 'shared')),
  data_subject_consent_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (data_subject_consent_status IN ('not_requested', 'requested', 'granted', 'denied', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (person_id, contact_id)
);
CREATE INDEX idx_identity_matches_person ON identity_matches(person_id);
CREATE INDEX idx_identity_matches_tenant ON identity_matches(tenant_id);

-- Cross-tenant merge consent (both parties must agree)
CREATE TABLE identity_merge_consents (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  consenting_user_id TEXT NOT NULL REFERENCES users(id),
  consent_signature_hex TEXT NOT NULL,           -- Ed25519 signature reusing Principle 11 infrastructure
  consented_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scope TEXT NOT NULL                            -- which specific merge this consent covers
);
```

### 7.2 Match sources and their trust levels

| Source | Trust | Use case |
|---|---|---|
| `verified_phone` | High | Both records have the same phone number and the phone number has been verified via OTP by at least one party. Auto-proposes match; still requires human confirmation. |
| `verified_email` | High | Same as phone but for email; email verified via link click. |
| `manual` | Highest | A user in one tenant explicitly asserts "this is the same person as this record in another tenant I can see" and provides a rationale. Highest legal-defensibility. |
| `algorithmic` | Low | Name + partial phone + partial email fuzzy match. Only ever `proposed`, never auto-confirmed. Requires manual confirmation with visible confidence score. Records the algorithm version used. |

**No probabilistic matches are ever `confirmed` without a human decision.** No automatic cross-tenant identity linking without explicit consent per §5 + §7.4.

### 7.3 Link visibility and privacy rules

Each `identity_matches` row carries `link_visibility`:

- **`private`** — the match is visible only to the tenant that owns the linked contact. Neither the person nor other tenants know a match exists. Used for internal deduplication only.
- **`tenant_visible`** — the two tenants involved in the match know a link exists and see summary info. Neither can access the other's underlying contact data. Used for "we both know Nadine" collaboration.
- **`shared`** — the two tenants agree to share the underlying contact detail (subject to each tenant's own agent-level permissions). Rare, requires explicit both-parties merge consent.

**The default is `private`.** Elevation to `tenant_visible` or `shared` requires explicit workflow with both tenants' authorization.

### 7.4 Cross-tenant merge — the operation

Registered in the cross-tenant allow-list as `LINK_PERSON_IDENTITIES_ACROSS_TENANTS`. Workflow:

1. Party A (say Elite admin) proposes a merge: "our contact record `elite_contact_nadine` is the same person as personal record `ali_personal_contact_nadine`."
2. Platform creates a `proposed` `identity_matches` row referencing both contacts.
3. Party B (Ali) sees the proposal in their inbox with clear context: which record, which tenant proposed, what confidence, what would change if confirmed.
4. Party B either confirms or rejects. Confirmation requires Ed25519 signature (reuses Principle 11 infrastructure).
5. If confirmed: match status → `confirmed`. Both contacts now share `person_id`. Default `link_visibility = private` unless the confirmation flow explicitly elevated it.
6. If rejected: match status → `rejected`. The rejection is recorded but does not prevent future re-proposal (with a cooldown to prevent harassment).

### 7.5 Data-subject rights (GDPR / Lebanon E-Transactions Law)

Nadine (the human) has legal rights over her data. The Person Identity domain must respect them:

**Right of access:** on request, the platform must produce all records referencing Nadine's `person_id` across all tenants. Each tenant's contact record is included in the export; content is attributed to the owning tenant.

**Right to erasure ("right to be forgotten"):**
- Request received via a data-subject request endpoint.
- Platform transitions the `persons` row to `deletion_requested`.
- Each tenant with a contact linked to this `person_id` is notified and has a legally-required window to respond (retention obligations may prevent full erasure).
- After the window, platform executes: contact records are either fully erased or anonymized (retain aggregate anonymized data for audit if legally required); `identity_matches` are erased; the `persons` row transitions to `deleted_erased` (record kept as tombstone) or `deleted_anonymized`.
- Audit trail retains the fact of erasure (not the data).

**Right to portability:** the person can export their own data in a structured format from any tenant that has consented to per-person export.

**Right to rectification:** each tenant is responsible for correcting its own records. The `person_id` link does not force cross-tenant correction.

### 7.6 Deletion propagation rules

When a contact record is deleted by its owning tenant:
- The contact row is deleted.
- The `identity_matches` row is deleted.
- The `person_id` linkage is broken.
- Other tenants' contact records remain unaffected.
- If this was the last contact linked to the `person_id`, the `persons` row is soft-deleted (retained as tombstone unless explicit erasure requested).

When a `persons` row is erasure-deleted (right to be forgotten):
- Cascade deletion to all `identity_matches` referencing this person.
- Notify all tenants owning contacts linked to this person, per §7.5 window.
- Then cascade-erase the contact rows themselves (per tenant's legal-obligation response).

### 7.7 What Person Identity is NOT

- **Not a marketing surveillance graph.** Cross-tenant linking is consent-based; no shadow profile is built.
- **Not a person-across-agencies visibility system.** Each tenant sees its own contacts. Links are opt-in and default-private.
- **Not a lead-poaching detector.** The platform does not surface "this contact is also known to Cedar" without explicit consent from Cedar.

---

## 8. Engagement policies (TA-set, agent-consented, platform-enforced)

Principle 11 in detail. The TA controls five policy dimensions for every membership.

### 8.1 The five dimensions

| # | Dimension | Values | Restricts |
|---|---|---|---|
| 1 | `personal_work_status` | `active` / `read_only` / `hidden` | Whether the agent's Personal tab is fully usable, view-only (legacy assets remain visible but no new creation), or entirely hidden while this membership is active. |
| 2 | `other_agency_rights` | `any` / `guest_only` / `forbidden` | Whether the agent may hold other agency memberships while member here. |
| 3 | `communication_channels` | `agency_only` / `mixed` / `agent_choice` | Which channels the agent may use for outbound work related to this tenant's assets. |
| 4 | `ai_credit_spending` | `agency_wallet_only` / `agency_allowance_plus_personal_topup` / `agent_wallet_permitted` | How AI-generation costs are settled. |
| 5 | `public_profile_visibility` | `agency_only` / `dual_branded` / `agent_choice` | How the agent's public profile page presents this membership. |

### 8.2 Signing infrastructure

- Ed25519 keypair per user (see §11 Phase 3 for detail).
- Envelope-encrypted private key (Argon2id-derived user key + KMS platform key).
- RFC 8785 JCS canonicalization for signed payloads.
- Signature reused across: engagement policy acceptance, cross-tenant merge consent, high-stakes off-platform-dispute resolution acknowledgments.
- eIDAS advanced electronic signature tier; ESIGN Act compliant; Lebanese counsel required for local enforceability confirmation.

### 8.3 Data model

Full schema per v1 doc — retained unchanged. `membership_policy_snapshots`, `membership_policy_acceptances`, `user_signing_keys` tables. See v1 for column-level detail.

### 8.4 Runtime enforcement

Per dimension:

- **`personal_work_status`** — `hidden` removes Personal tab; `read_only` disables creation in Personal; `active` unrestricted.
- **`other_agency_rights`** — `forbidden` auto-rejects incoming invites from other agencies with policy quote; `guest_only` rejects non-guest invites.
- **`communication_channels`** — `agency_only` blocks outbound via non-agency channels; `mixed` blocks bulk/template outbound via non-agency channels but allows 1:1.
- **`ai_credit_spending`** — AI-generation endpoints route wallet charges per policy; agent-wallet requests are rejected under `agency_wallet_only`.
- **`public_profile_visibility`** — public profile-render endpoint reads policy and includes/excludes brand elements accordingly.

### 8.5 Policy changes mid-membership

TA modifies any policy dimension on an active membership:
1. New snapshot created with `supersedes_snapshot_id` = current active.
2. Membership status → `suspended_pending_reacknowledgment`.
3. Agent tab shows warning banner. All creation actions disabled. Read remains.
4. On next login, agent sees diff view. Either accepts (full signature flow) or declines (triggers departure workflow under grandfathered previous policy).
5. Auto-suspension + auto-departure if agent inaction exceeds TA-configured window (default 14 days).

---

## 9. Resource ownership layer

Not every commercially-relevant thing is an asset. Some are **resources** — infrastructure the platform manages that assets use.

### 9.1 Resources are tenant-bound

Every resource has an owning tenant:
- `channel_accounts.tenant_id` — WhatsApp Business, SMS sender, email domain
- `wallets.tenant_id` — the billing pool for AI, WhatsApp credits, campaign spend
- `templates.tenant_id` — reusable message templates
- `phone_numbers.tenant_id`
- `ad_accounts.tenant_id`
- `publishing_accounts.tenant_id` — Instagram, TikTok, X handles

### 9.2 Compatibility rule

For any operation that binds a resource to an action on an asset, the platform enforces:

```
resource.tenant_id == action.target_asset.tenant_id
```

unless the resource is explicitly declared `shareable_across_tenants = true` (rare; requires TA sign-off at resource-creation time).

### 9.3 Examples

- WhatsApp campaign about Elite listing must use Elite's WhatsApp Business account. Cedar's account → rejected.
- AI-generation for Elite listing must charge Elite wallet OR agent wallet per policy §8. Cedar wallet → rejected.
- Public listing render must use Elite's brand template if visibility policy is `agency_only`.

The generalized rule replaces the enumerated "illegal combination" table from v1 — every specific case becomes an instance of `resource.tenant ≠ asset.tenant`.

---

## 10. Action Context and AI

Complex operations touch multiple assets, resources, and tenants simultaneously. The primitive `(actor, action, single_asset)` is insufficient for authorization.

### 10.1 Action Context object

Every mutating request (and every AI-triggered action) resolves into an Action Context on the server:

```typescript
type ActionContext = {
  actor: {
    user_id: string
    memberships: Membership[]              // resolved server-side, not from client
    active_view_tenant?: string            // from X-Active-Tenant-Id (untrusted hint)
  }
  operation: {
    type: string                           // e.g. 'CREATE_CAMPAIGN', 'REPLY_TO_CONVERSATION'
    intent?: OperationIntent               // client-declared, server-verified
  }
  target: {
    primary_asset?: { type, id, tenant_id }
    referenced_assets: Array<{ type, id, tenant_id }>
    referenced_resources: Array<{ type, id, tenant_id }>
  }
  authorization: {
    required_policies: string[]            // computed server-side
    resolved_membership?: Membership       // the specific membership relied on
  }
  audit: {
    ip_address?: string
    user_agent?: string
    session_id?: string
    signature?: SignatureRecord            // for signed operations
  }
}
```

Authorization engine evaluates the entire context, not just primitives.

### 10.2 AI rule

**AI never asserts a tenant.** An AI-triggered action must resolve into an Action Context with `target.primary_asset.tenant_id` derived from the asset being acted upon. If the AI's requested action doesn't reference a specific asset (e.g., "generate a marketing plan"), the AI action must include an explicit user-declared `target_tenant_id` treated exactly like a human-user creation (Principle 3: conscious choice).

Server-side authorization applies the same rules regardless of whether the actor is a human user or an AI agent operating on behalf of the user. No AI has ambient tenant authority.

---

## 11. Creation-moment UI patterns

Three patterns, each fit-for-purpose.

### Pattern A — Dedicated confirmation page (high-stakes)

**Used for:** creating a new listing.

**Why:** A listing carries financial, brand, and legal consequences (commission, ownership, phone number, brand). Getting the tenant wrong is expensive to fix (requires TRANSFER command, dual approval when contested).

**UI:** After clicking "New Listing", agent lands on a full page: *"Which workspace is this listing being added to?"* Options rendered as cards showing tenant name, brand preview, applicable engagement-policy summary (e.g., "AI credits from Elite wallet", "Listed under Elite brand"). Agent must click a card + confirm before proceeding to the listing form.

**Default:** No preselection. Exclusive agents see their exclusive tenant highlighted as suggestion (visually distinguishable from "selected") but still must click through and confirm.

### Pattern B — Dropdown at top of form (medium-stakes)

**Used for:** creating a contact, task, opportunity, campaign, note, saved search.

**UI:** Top of the creation form has "Adding to workspace: [dropdown]". Dropdown lists all tenants the agent can add to under their engagement policies.

**Default rule (v2, corrects v1 contradiction):** 
- **No default from current tab.** Tabs are lenses, not modes (Principle 5).
- **Preselection ONLY from tenant-owned parent asset.** If "New Contact" is launched from an Elite listing detail page, dropdown preselects Elite with visible "Suggested from parent — click to change" state. Selection considered explicit only if user clicks the dropdown (opens + closes with same value counts as explicit).
- **On All tab or standalone launch, no default; selection mandatory.**
- **`selected_by_user` flag stored on the created asset when preselection was accepted** — enables auditing "was this deliberately chosen or accepted from a suggestion?"

### Pattern C — Tabs at the app shell (navigation, view filtering)

**Used for:** app-shell navigation. NEVER for asset creation attribution (per Principle 5 corrected).

**UI:** Tabs at the top: `All | Personal | Elite | Cedar | ...`. **`All` is the first tab** and the default landing view (v2 correction). Order: All, Personal, then agency memberships sorted by joined date. Tabs show a color-coded left border matching the tenant's brand.

Switching tabs filters the current view (inbox, listings, contacts, analytics). It does **NOT** change asset attribution or the default of any creation form.

**Scale rule (v2 addition, per AI 3):** for agents with more than 5 memberships, tabs collapse into `All | Personal | Agencies ▼ (N)` where the dropdown lists all agency memberships with search. Prevents tab bar from becoming unusable at scale.

**Highlighted states:** newly-added tabs show a dot indicator for 3 sessions. Tabs about to end (membership expiring in <7 days) show a warning icon.

### Matrix — which pattern for which surface

| Creation surface | Pattern | Justification |
|---|---|---|
| New listing | A (page) | High-stakes; brand + financial + legal |
| New contact | B (dropdown) | Medium; may inherit from parent listing/opportunity |
| New task | B (dropdown) | Usually inherits from parent contact/listing |
| New opportunity | B (dropdown) | Medium |
| New campaign | B (dropdown) + resource compatibility preflight | Medium; resource (channel account) compatibility must be shown |
| New note / attachment | Inherit (no chooser) | Always in the context of a parent |
| New saved search | B (dropdown) | Personal preference or tenant-shared |
| Reply to conversation | Inherit (no chooser) | Conversation has a tenant |
| Edit any asset | Inherit (no chooser) | Asset has a tenant |
| Delete any asset | Inherit (no chooser) | Same |
| AI generation for asset | Inherit (no chooser); wallet routed by policy §8 | Same |
| Cross-tenant referral / transfer | Dedicated operation (§5, §6) with explicit operation_intent | Not "creation"; separate command |

---

## 12. Backend implications

### 12.1 Middleware chain

- `authMiddleware` — resolves `req.user` from JWT (existing).
- `resolveTenantContext` — reads `X-Active-Tenant-Id` header, intersects with `req.user`'s active memberships, attaches `req.viewTenantContext = { tenant, membership } | null`. **Never trusts the header value; always intersects.** For view filtering only.
- `requireTenantMembership(paramSource)` — for URL params like `/api/tenants/:id/*`. Verifies `req.user` has an active membership in `req.params[paramSource]` (or its tenant equivalent).
- `validateAssetTenantOnCreate` — for creation endpoints. Requires `target_tenant_id` in body. Verifies user has an active membership in that tenant with sufficient role per operation's authorization policy. Rejects otherwise.
- `resolveActionContext` — for mutating endpoints. Reads primary asset id from URL, fetches its `tenant_id`, computes referenced assets and resources from body, builds full Action Context (§10.1).
- `enforceCrossTenantPolicy` — for operations whose Action Context spans >1 tenant. Reject unless operation type is in cross-tenant allow-list AND actor is authorized per that operation's policy AND `operation_intent` matches.
- `enforceResourceCompatibility` — for operations binding a resource to an asset. Rejects if `resource.tenant_id ≠ asset.tenant_id` unless resource is `shareable_across_tenants`.
- `enforceEngagementPolicy` — reads acting user's active membership policy for the operation's tenant, rejects violations with `POLICY_VIOLATION_*` codes.
- `verifySignatureOnSignedOperation` — for signed operations (policy acceptance, merge consent, dispute resolution). Validates Ed25519 signature against user's active signing key.

### 12.2 Endpoint conventions

- **Creation:** `POST /api/<resource>` requires `target_tenant_id` in body (not `tenant_id` — see §12.5). Server validates membership + engagement policy.
- **Mutation:** `PATCH /api/<resource>/:id` — never accepts `tenant_id` (or `target_tenant_id`); tenant derived from asset. Any attempt to include causes 400.
- **Transfer:** `POST /api/<resource>/:id/transfer` — dedicated command. Requires `to_tenant_id`, `authorization_basis`, `reason`. Server enforces the transfer's specific authorization policy (single-owner, dual-approval, etc).
- **Listing:** `GET /api/<resource>` — optional `?tenant_id=X` filter. If omitted, returns assets across all tenants the actor has access to.
- **New:** `GET /api/auth/tenant-context` — returns actor's full membership list with active engagement-policy snapshots. Used by frontend for tab rendering.
- **Data access layer** — tenant predicate enforced at query time (row-level filter), not only in route middleware. Every asset query joins the actor's memberships and filters. Prevents ID-substitution attacks.

### 12.3 Background jobs and AI

Every asynchronous worker, cron job, and AI-triggered action MUST carry an Action Context. No worker executes with "system authority" over multi-tenant data. Workers acting on behalf of a user use that user's memberships. Workers acting on behalf of the platform (e.g., billing reconciliation) use `platform` context and are audit-logged separately.

### 12.4 What to REMOVE

- `getActiveAffiliation(userId)` in `platformModel.js` — DELETE. Auto-inference anti-pattern.
- `getActiveAgencyForUser(userId)` — DELETE. Same reason.
- Every direct-DAL `findOne('agency_members', ...)` for authorization — REPLACE with canonical `getAgencyMembership(agencyId, userId)`.
- Every direct-DAL `findAll('agency_members', ...)` for listing — REPLACE with canonical `listAgencyMemberships(agencyId)`.
- Every "pick first active membership" pattern — DELETE. **Also audit migration 028's backfill for this pattern (§14 Phase 0 gate).**

### 12.5 Naming: `target_tenant_id` not `tenant_id` in POST

Per AI 1's precision: at creation time, the client-supplied field is the REQUESTED destination, not a fact. Server evaluates and if authorized, writes the asset's `tenant_id`. Naming reflects this:

```
POST /api/properties         → body includes target_tenant_id
POST /api/contacts           → body includes target_tenant_id
PATCH /api/properties/:id    → body does not accept target_tenant_id or tenant_id
POST /api/properties/:id/transfer → body includes to_tenant_id (not target_tenant_id — this is a transfer, not a creation)
```

---

## 13. Frontend implications

### 13.1 App shell

- Top navigation shows tabs: `All | Personal | Elite | Cedar | ...` (or scale-collapsed per §11 Pattern C).
- **`All` is default landing view.**
- Active tab is visually distinct with color-coded border matching brand.
- Active tab persists to localStorage (`reb_active_tenant_view_id`).
- Active tab sent as `X-Active-Tenant-Id` header on all API requests (also acceptable as `?tenant_view=X` query param if multi-tab browser conflicts arise — future work).
- **Tab is view state only. Never used for asset attribution defaulting.**

### 13.2 Persistent tenant labels on assets

Every asset row / detail view shows a persistent tenant badge with brand color and tenant name. "Owned by Elite" always visible. In `All` view, badges are the primary visual mechanism for distinguishing tenants (not just row color).

### 13.3 Analytics with metric semantics

`All`-tab analytics:
- **Always show per-tenant breakdown** alongside any combined total.
- **Never silently aggregate metrics that require weighting.** Composite metrics (avg commission rate, conversion rate, win rate) are computed correctly (weighted or ratio-based), not as simple averages of per-tenant rates.
- **Tenant-sensitive financials** (revenue, commission earned) require explicit "show combined" toggle; hidden by default in `All` view to prevent accidental competitive-view.

### 13.4 Preflight summary for bulk actions

Before sending a broadcast, publishing a listing, or any bulk action:

```
Preflight summary
────────────────────────────────────
• 84 recipients (Elite contacts only)
• Sending from Elite WhatsApp Business (+961-1-ELITE-RE)
• Charged to Elite wallet (current balance: 12,450 credits)
• Estimated credit cost: 168
• Policy: agency_only channels enforced

[ Cancel ] [ Send ]
```

Explicit summary is safer than a disabled button + tooltip alone. User must confirm the full context.

### 13.5 Cross-tenant validation UX

- Client-side: button disabled + tooltip when known illegal combination detected.
- Server 409 responses trigger a modal with the structured `POLICY_VIOLATION_*` body:

```json
{
  "error": "POLICY_VIOLATION_UNAUTHORIZED_CROSS_BOUNDARY_OPERATION",
  "message": "This action would attach an Elite contact to a Cedar listing. That is not a registered cross-tenant operation.",
  "operation": "ATTACH_CONTACT_TO_LISTING",
  "actor_tenant_memberships": ["elite", "cedar"],
  "involved_tenants": { "contact": "elite", "listing": "cedar" },
  "suggested_actions": [
    { "label": "Refer the listing to Elite for co-representation", "operation": "REFER_LISTING_TO_AGENCY" },
    { "label": "Duplicate the contact into Cedar", "operation": "COPY_CONTACT_TO_TENANT" },
    { "label": "Cancel" }
  ]
}
```

---

## 14. Migration path (v2)

### Phase 0 — Migration audit gate (BEFORE any enforcement code ships)

**Blocking:** run an attribution audit against the production data (via the restored PostGIS backup). Verify:

1. Every asset's `tenant_id` was assigned by defensible logic (not a "first active membership" heuristic).
2. Every asset has consistent `created_by_user_id`, `source_tenant_id`, `tenant_assignment_source` per §4.
3. Conversations, tasks, opportunities have coherent tenant attribution matching their parent assets.
4. No listing has `tenant_id` inconsistent with `agency_id`.
5. No contact has `agency_id` inconsistent with what §8 lookup would return today.

Any discrepancy blocks Phase 1. Discrepancies get:
- Documented with the row-level evidence.
- Corrected via a `CORRECT_ATTRIBUTION` operation (writes an `asset_ownership_history` row with source=`migration_correction`).
- Reviewed by product owner + human decision before applying.

**This gate is NON-negotiable.** Under Principle 10, once enforcement ships, historical attribution becomes immutable. Garbage in permanently.

### Phase 1 — Backend baseline

- New middleware: `resolveTenantContext`, `requireTenantMembership`, `validateAssetTenantOnCreate`, `resolveActionContext`, `enforceCrossTenantPolicy`, `enforceResourceCompatibility`, `enforceEngagementPolicy`, `verifySignatureOnSignedOperation`.
- Refactor all agency-scoped routes to use canonical helpers + new middleware.
- Delete `getActiveAffiliation`, `getActiveAgencyForUser`, all `first-active-membership` patterns.
- Migration for `asset_ownership_history` + resource `tenant_id` columns + `identity_matches` + `persons` (empty tables, populated by Phase 3/4).
- Backend tests including negative authorization: forged tenant_id, forged X-Active-Tenant-Id, forged operation_intent all rejected.

### Phase 1 acceptance gates (all must pass end-to-end)

Per AI 4 recommendation. Phase 1 is not complete until:

1. A user with Elite and Cedar memberships creates a listing under Elite while viewing `All`.
2. The same user edits that listing while viewing Cedar; the mutation remains Elite-scoped.
3. A forged `target_tenant_id` on a creation request is rejected with a specific error code.
4. A forged asset ID from another tenant is rejected without information leakage (identical response to a real-not-found).
5. A Cedar channel account cannot send a campaign about an Elite listing (`POLICY_VIOLATION_RESOURCE_COMPATIBILITY`).
6. A background AI job cannot charge the wrong wallet.
7. An ended membership loses access according to the defined grace-period policy.
8. `All` analytics never silently combine tenant-sensitive financial metrics without explicit toggle.
9. A personal contact and an agency contact can coexist without leaking notes or history.
10. A TRANSFER produces a complete immutable audit trail; the transferred asset's `assets.tenant_id` reflects the new owner but `asset_ownership_history` shows both prior and current owners.

### Phase 2 — Frontend app shell

- `AuthContext` fetches `/api/auth/tenant-context`.
- App shell tabs (All first, Personal, memberships, scale-collapse >5).
- Pattern A page for new listing.
- Pattern B dropdown for other creation forms; **no default from active tab.**
- Persistent tenant badges on all asset rows.
- Cross-tenant validation UX (client-side + 409 modal).
- Analytics with metric-semantics rules.
- Preflight summaries for bulk actions.

### Phase 3 — Invite flow + engagement-policy Ed25519 signing

- Invite tokens (email + code + QR).
- `membership_policy_snapshots`, `membership_policy_acceptances`, `user_signing_keys` migrations.
- Ed25519 infrastructure (key gen, envelope encryption, RFC 8785 JCS canonicalization, recovery flow).
- Backend endpoints per §8.
- Frontend accept-invite page with itemized policy display, per-dimension checkboxes, signature dialog.
- Email templates: invite email + post-acceptance signed-policy PDF.

### Phase 4 — Person Identity domain

- `persons`, `identity_matches`, `identity_merge_consents` migrations.
- Cross-tenant merge workflow (both parties consent, Ed25519 signed).
- Data-subject-rights endpoints (access, erasure, portability, rectification per §7.5).
- Frontend: person-view page, merge proposal UI, consent flow, data-subject-request handling.
- Deletion propagation rules (§7.6) implemented.

### Phase 5 — Departure + policy enforcement + mid-membership changes

- TA admin UI for departure policies + engagement policy editing.
- Departure workflow (§6.3): freeze disputed assets, expose claims, off-platform resolution recording.
- Mid-membership policy-change flow (§8.5): suspension, diff view, re-signature, grandfathered departure.
- Runtime enforcement middleware for all 5 policy dimensions.
- Case-review dispute UI.

Each phase ships as a discrete PR with its own test coverage. No phase merges until its acceptance criteria are green. Phase 0 gate is BLOCKING for Phase 1.

---

## 15. Open questions to resolve during implementation

- **Analytics access model for platform staff:** platform-admin views may legitimately aggregate tenants for support. Explicit "platform mode" toggle only visible to `platform_role = 'platform_admin'`, audit-logged, and never exposed via any non-admin route.
- **Multi-browser-tab handling:** if a user opens two browser tabs with different `X-Active-Tenant-Id` values, does the localStorage persistence conflict? Options: per-tab session storage vs shared localStorage vs URL-based state. Decide during Phase 2.
- **Idempotency keys:** every creation and messaging endpoint should accept an idempotency key to prevent duplicate assets/broadcasts on retry. Add during Phase 1.
- **Rate limiting per operation-intent:** cross-tenant referrals and transfers may need distinct rate limits from ordinary creations. Design during Phase 2.
- **Person-identity match cooldown:** how long after a rejected match before it can be re-proposed? Prevents harassment. Suggest 90 days default; TA-configurable.
- **Legal counsel review:** Lebanese E-Transactions Law enforceability of Ed25519 signatures. Consult before Phase 3 ships.

---

## 16. Relationship to other docs

- **`tenant-authorization-architecture.md`** — data model (tenants, memberships, roles, affiliation modes, base ownership). Unchanged; this doc builds on top.
- **`AI-HANDOVER-2026-08-10-TENANT-AUTHORIZATION.md`** — implementation continuation. §7.7 (frontend tenant context) is now Phase 2 of this doc's migration path. §7.2 (legacy agency_members cutover) is now Phase 1.
- **`design-architecture-decisions.md`** — needs update to reference this doc and remove any assumption of auto-inference.
- **`crm-conversation-orchestrator-scope.md`** — the "single Contact record per person" line needs a note: single per-tenant record remains; the Person Identity domain (§7 of this doc) adds cross-tenant linkage with consent.

---

## 17. Reviewer credits and v2 change log

**v1 (2026-08-11):** initial design, Slack-vs-Gmail decision, 10 principles, Principle 11 added later same day.

**v2 (2026-08-11):** substantial rewrite following four-AI review. Consensus fixes:

1. Fixed Principle 5 vs Pattern B contradiction (Pattern B no longer defaults from active tab).
2. Reframed cross-tenant as deny-by-default with explicit allow-list, not "impossible by construction" enumeration.
3. Replaced `cross_tenant_confirmation` with `operation_intent`; server evaluates, client expresses.
4. Decomposed overloaded `tenant_id` into 7 explicit fields (§4).
5. Added Action Context concept (§10) with explicit AI-authorization rule.
6. Added Resource Ownership layer (§9) with compatibility rules.
7. Person Identity as first-class domain (§7) — full consent framework, GDPR-aware, not a hidden UUID.
8. Immutable-current vs immutable-history split (§6.1); TRANSFER as separate command (§6.2).
9. Departure = platform NOT arbitrator (§6.3, Principle 9).
10. Migration 028 backfill audit as blocking Phase 0 gate (§14).
11. `X-Active-Tenant-Id` explicit untrusted-view-hint rule (§12.1, Principle 5).
12. Naming: `target_tenant_id` in POST; `to_tenant_id` in transfer; "unauthorized cross-boundary operation" not "illegal combination".
13. Scale rule for >5 memberships (§11 Pattern C).
14. Analytics metric semantics rule (§13.3).
15. 10 Phase 1 acceptance gates (§14).

Also: added top-line invariant ("The UI may suggest context. Assets establish attribution. Authorization establishes permission. The server establishes truth."); 5 invariants preamble (§2); explicit product positioning (§1); Phase 0 non-negotiable status.

---

## 18. Approval trail

- Design proposed and refined through conversation with product owner on 2026-08-11.
- v1 approved for execution as the tenant view/interaction baseline.
- v1 externally reviewed by four AI systems; substantial critique produced.
- v2 (this document) supersedes v1 based on consensus reviewer feedback.
- Approved for execution as of v2. Any further deviation from the eleven principles requires explicit documented decision.
