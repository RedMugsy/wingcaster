# Ticket 029 — Attribution & Listing Identity (umbrella)

**Status:** Approved for build
**Decision date:** 2026-08-12
**Depends on:** M028 tenant authorization foundation (already applied)
**Blocks:** sold-price registry feature; marketing ROI reporting; cross-platform anti-fraud

## Purpose

Two capabilities land together because they share a migration slot and their data models interlock:

1. **Attribution** — every inquiry carries enough context (which listing, which campaign, which browsing session) to answer "where did this lead come from and what were they looking at."
2. **Listing identity** — every published listing carries a human-shareable public ID and a cryptographic proof of publication, so any listing can be verified as authentic and unaltered.

## Sub-tickets

| Ticket | Scope | File |
|---|---|---|
| 029a | Deep-link property_id seeding + UTM capture + portal session cross-reference | [`029a-deeplink-utm-attribution.md`](./029a-deeplink-utm-attribution.md) |
| 029b | HRUUID + Ed25519 listing signatures + verify endpoint | [`029b-listing-hrid-and-pki.md`](./029b-listing-hrid-and-pki.md) |
| 029b Phase 2 | HSM key custody, TSA counter-signing, blockchain anchoring — deferred items | [`029b-phase2-actions.md`](./029b-phase2-actions.md) |
| 029c | Bazaar Locality Code (BLC) scheme + `localities` table + backfill from `city`/`neighborhood` | [`029c-locality-code-scheme.md`](./029c-locality-code-scheme.md) |

## Migration sequence

Three migrations, in this order:

**Migration 029c — `031_locality_code_scheme.sql`** (must land first)
- `CREATE TABLE localities`
- `CREATE TABLE locality_code_ranges`
- `ALTER TABLE properties ADD locality_id`, `ADD locality_blc`
- Seed country entries, Lebanese governorates, and Beirut/Mount Lebanon/North/South/Bekaa starter neighborhoods
- Backfill `properties.locality_id` and `properties.locality_blc` from `city`+`neighborhood` fuzzy match

**Migration 029 — `029_attribution_and_listing_identity.sql`** (after 029c)

Composed of two clearly-labeled sections:

```
-- =============================================================
-- Section A: Attribution (029a)
-- =============================================================
--   ALTER TABLE inquiries ADD source_ref JSONB
--   ALTER TABLE contacts ADD first_touch_utm JSONB
--   CREATE TABLE portal_session_events (...)
--   CREATE INDEX ... on session_id, phone_hash

-- =============================================================
-- Section B: Listing identity (029b)
-- =============================================================
--   ALTER TABLE properties ADD hrid TEXT UNIQUE
--   CREATE TABLE agent_signing_keys (...)
--   CREATE TABLE property_signatures (...)
--   Backfill: hrid for existing properties (reads properties.locality_blc from 029c)
--   Backfill: initial listing-purpose key per active agent
```

Section B must not run before Section A completes (single transaction; both succeed or both roll back). Both sections assume 029c already ran and populated locality data.

**Note on migration numbering:** the locality scheme uses migration number `031` even though the ticket is `029c`. Migration numbers are sequential-by-application-order; ticket numbers group work-logically. This means the applied order is 027 → 028 → 031 (locality) → 029 (attribution + listing identity) → 030 (stage guards). Not ideal, but changing the migration numbering scheme mid-project would create confusion in the deploy tooling that keys off migration filenames.

## How the two interlock

- **Attribution** captures where a lead came from. **Listing identity** proves what listing they saw.
- The sold-price registry (future ticket 031) uses **both**: `sold_record.attributed_inquiry_id` links to an inquiry with `source_ref`; `sold_record.property_signature_id` links to the exact signed version of the listing at time of sale. Together this gives a full audit chain from ad click → browse session → inquiry → conversation → sale → signed listing version.
- Cross-platform syndication (WhatsApp/Instagram carousels of a listing) embeds the HRUUID and links back to a verifiable URL — anti-scraper-fraud story.

## Rollout order

Land 029c first (foundation), then 029b (needs BLCs), then 029a (needs hrids):

1. **029c step 1** — locality scheme. Ship migration `031_locality_code_scheme.sql`. Seed countries + Lebanese governorates + Beirut/Mount Lebanon/North/South/Bekaa starter neighborhoods. Verify: allocator issues BLCs correctly, ranges enforce, no overlaps.
2. **029c step 2** — property backfill. Run pre-migration hygiene script. Curator reviews ambiguous city/neighborhood matches. Run backfill on confidently-matched properties.
3. **029b step 1** — key infrastructure only. Create `agent_signing_keys`, backfill an active listing-purpose key per agent, expose `.well-known/rebazaar-keys.json`. No signing yet. Verify: key rotation works, revocation works. **Feature flag:** `LISTING_SIGNING_ENABLED=false`.
4. **029b step 2** — HRUUID assignment. Backfill `properties.hrid` from `created_at` year + `locality_blc` + generated suffix. Add hrid to public listing URLs alongside existing UUID URL (both work; UUID URL 301-redirects to hrid URL). Properties with NULL locality_blc are skipped and surfaced for curator review — remain UUID-accessible until curated. No signing yet.
5. **029b step 3** — signing goes live. Every property write signs the canonical content. `LISTING_SIGNING_ENABLED=true`. Verify endpoint `GET /api/listings/:hrid/verify` becomes authoritative.
6. **029a step 1** — deep-link seeding. Listing page contact buttons include `REF:<hrid>` in outbound URLs. Orchestrator parses. **Feature flag:** `ATTRIBUTION_DEEPLINK_ENABLED=true`.
7. **029a step 2** — UTM capture on portal. Contact form POSTs include `source_ref`. Inquiry-create writes it.
8. **029a step 3** — portal session events. Session cross-reference in orchestrator.

Each step is independently shippable and revertible via its flag.

## Feature flags introduced

| Flag | Default | Purpose |
|---|---|---|
| `LISTING_SIGNING_ENABLED` | `false` at rollout, `true` after step 3 stable | Enables per-listing Ed25519 signing on write |
| `ATTRIBUTION_DEEPLINK_ENABLED` | `false` at rollout | Enables REF token seeding on listing-page buttons and orchestrator parsing |
| `ATTRIBUTION_SESSION_XREF_ENABLED` | `false` at rollout | Enables `portal_session_events` writes and orchestrator lookup |

## Success criteria (all four must be true)

1. Every active locality with a listing has a BLC assigned; every new property write validates against `locality_id`.
2. A published listing exposes a verifiable signature: `GET /api/listings/:hrid/verify` returns 200 with a valid Ed25519 signature over the canonical content, and independent verification against the `.well-known` public key succeeds. HRUUID decodes cleanly to (year, BLC, suffix).
3. An inbound WhatsApp message from a listing page's WhatsApp button lands in the orchestrator with `inquiry.property_id` and `inquiry.source_ref` both populated automatically.
4. A contact who browsed the portal (UTM'd landing → 3 listings) and then messaged via WhatsApp has their inquiry's `source_ref.browsed_properties` include all 3 prior views, and `source_ref.utm_*` fields carry the original UTM package.

## Rollback plan

- Migration is one atomic transaction — a failure rolls back both sections.
- Feature flags let each step be toggled off independently without rolling back the schema.
- Signed properties: revoking `LISTING_SIGNING_ENABLED` stops new signatures but historical signatures remain queryable. No listing becomes unverifiable.
- HRUUIDs: never reused, never deleted. UUID URLs continue to work permanently.

## Out of scope for 029

- Sold-price registry itself (ticket 031)
- Inquiry stage transition guards (ticket 030 — independent, land in parallel)
- Meta Ads API integration
- WhatsApp Status posting
- Frontend read-and-verify UI ("verified listing" badge in agent inbox) — designed here, implemented in ticket 032
