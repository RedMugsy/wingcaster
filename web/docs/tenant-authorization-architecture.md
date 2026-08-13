# Tenant, Membership, Routing, and Asset Architecture

**Decision date:** 2026-08-10  
**Status:** Approved product baseline; implementation is incremental.

## 1. Separation of concerns

- A **user** is the durable authentication principal.
- An **agent profile** is the professional public identity; it is not an authorization role.
- A **tenant** is a commercial, policy, billing, and data-ownership boundary.
- A **tenant membership** grants scoped authority inside exactly one tenant.
- `platform_admin` is reserved exclusively for platform staff and is never a tenant role.

## 2. Tenant types

- Every agent owns one durable `personal` tenant.
- Every agency is represented by one `agency` tenant.
- Personal tenants are preserved when an agent joins or leaves an agency.
- For an exclusive agency membership, the Tenant Admin configures whether the personal tenant remains commercially active or becomes read-only.

## 3. Membership model

Tenant roles are `owner`, `admin`, `member`, and `guest`.

- `owner`: ownership, billing, ownership transfer, administrators, and destructive tenant actions.
- `admin`: day-to-day Tenant Admin operations without ownership transfer or tenant deletion.
- `member`: publicly affiliated operational professional with own/assigned work.
- `guest`: external, referral, or temporary collaborator with explicit limited grants.

Affiliation mode is separate from role:

- `personal`: ownership of the agent's personal tenant.
- `exclusive`: primary agency affiliation; at most one active exclusive membership per user.
- `non_exclusive`: agency affiliation or collaboration that can coexist according to Tenant Admin policy.

For non-exclusive relationships, the Tenant Admin explicitly chooses `member` or `guest`. Multiple guest relationships are allowed. Multiple non-exclusive member relationships are governed by tenant policy. An exclusive agency may prohibit concurrent full memberships.

## 4. Agency control

Agency-context work is governed by the agency tenant.

- Exclusive members spend from the agency wallet when the agency grants spending rights.
- Non-exclusive work uses scoped wallets: personal work spends personal credits; agency work spends agency credits under a revocable allowance.
- Credits do not move between tenant wallets merely because a membership starts or ends.
- Exclusive memberships support per-item `required`, `default`, or `optional` policy/template enforcement.
- Non-exclusive memberships receive agency policies/templates as defaults unless a separate explicit agreement grants stronger enforcement.

## 5. Lead routing

Central agency routing is defined by the Tenant Admin, not by a platform-global strategy. Policies may be scoped by source, team, geography, property, campaign, price, availability, or other configured criteria.

Supported routing strategies:

- `round_robin`
- `first_response`
- `least_loaded`
- `weighted`
- `manual`

Each policy defines eligibility, claim timeout, meaningful-response timeout, retry count, cooldown, and escalation. Relationship-first evaluation is a Tenant Admin policy flag.

Claim timeout and response timeout are distinct:

1. Claim timeout controls how long an offered agent has to accept.
2. Response timeout controls how long a claiming/assigned agent has to perform a meaningful customer-contact action.
3. Timeout atomically revokes and requeues the assignment, temporarily excludes the timed-out agent, and escalates after the configured maximum attempts.

## 6. Buyer, seller, and listing-side relationships

Relationships distinguish:

- buyer-side or tenant-side `representation`
- seller-side or landlord-side `mandate`
- prior-interaction `affinity`

If buyer Agent X represents a consumer who inquires about listing Agent Y's property:

- Active exclusive buyer representation routes the buyer-side lead to X and notifies Y on the listing side.
- Active non-exclusive buyer representation requires the consumer's explicit choice between X and Y.
- Affinity alone does not override Y or Y's Tenant Admin routing policy.
- Y retains the seller/listing mandate in every case.
- A response timeout may reassign the lead, but relationship ownership changes only through a separate audited action.

## 7. Resource ownership and assignment

Every commercial asset is classified as:

- `personal`: owned and held by a personal tenant.
- `agency`: owned and held by an agency tenant.
- `shared`: custody and assignment are explicit and separately recorded.

Ownership, custody, source attribution, and current assignment are separate facts. Transfers are explicit and audited; assignment alone never changes ownership.

## 8. Membership termination

- Agency-owned and agency-assigned properties remain with the agency under an exclusive arrangement.
- A property sourced by another agent remains with the agency.
- A property sourced by the departing agent follows its recorded exit disposition.
- `case_review` disposition requires approval by both the agency and departing agent.
- Pending or disputed cases remain in agency custody without silently transferring legal ownership.
- Historical attribution is preserved after membership ends.
- Platform staff may facilitate the workflow but do not decide legal ownership.

## 9. Non-negotiable safeguards

- A tenant must retain at least one active owner.
- Tenant roles never grant platform access.
- New agency members do not receive `admin` or `owner` implicitly.
- Guest access is explicit, scoped, and preferably expiring.
- Membership, routing, wallet, policy, relationship, and asset disposition changes are auditable.
- No production platform staff, agency membership, or ownership decision is fabricated during migration.