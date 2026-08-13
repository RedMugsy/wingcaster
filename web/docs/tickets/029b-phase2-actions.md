# Ticket 029b — Phase 2 actions (deferred)

**Parent:** [029b listing HRUUID + PKI](./029b-listing-hrid-and-pki.md)
**Status:** Deferred — items listed here are explicit v2/v3 scope, not to be built as part of the 029b v1 landing. Each item has a trigger condition that moves it from "deferred" to "planned."

## Why this document exists

029b v1 chose the pragmatic path: server-held Ed25519 keys sealed with a KMS-managed master, server timestamp inside the signed payload, single-organization key roster. Those choices are correct for launch. They will not remain correct forever. This document tracks the items that were consciously deferred so nothing gets lost.

## Deferred items

### 1. HSM / hardware-backed key custody

**Current (v1):** private keys sealed with libsodium `crypto_secretbox` under a master key from env, decrypted in-process only at sign time.

**Deferred (v2):** per-agent private keys held in an HSM (AWS CloudHSM, Google Cloud HSM, YubiHSM 2, or Azure Dedicated HSM), signing operations performed inside the HSM, keys never leave the device.

**Trigger to plan:** any of —
- First enterprise agency contract that stipulates FIPS 140-2 Level 3+ key custody
- First regulator inquiry about key handling
- 10,000+ active agents (blast radius becomes commercially meaningful)
- First security incident involving credential leakage anywhere in the org

**Scope when planned:**
- Vendor selection (CloudHSM vs. YubiHSM vs. Azure DHSM — cost, latency, MENA region availability)
- `agent_signing_keys.private_key_enc` replaced by `hsm_key_handle` on migrated rows
- `lib/signing/index.js` gains an HSM adapter alongside the software-sealed adapter
- Key migration: for each existing key, generate a new HSM-resident key, transition signing to the new key, revoke the old key after grace period
- No historical signature invalidation — old software-sealed keys stay revoked but present

**Estimated effort:** 2-3 sprints depending on vendor choice; add 1 sprint if regulator audit is in scope.

---

### 2. Trusted Timestamp Authority (RFC 3161) counter-signing for high-value listings

**Current (v1):** `signed_at` is a server timestamp inside the signed payload. Trust root is the platform's server clock and DB integrity.

**Deferred (v2):** for opt-in listings (e.g., listings above a price threshold, or agent-flagged "premium verification"), the signature is additionally counter-signed by an RFC 3161 TSA (FreeTSA, DigiCert, SectigoTSA, etc.). The TSA's counter-signature attests to the signature's existence at a time the platform cannot backdate.

**Trigger to plan:** any of —
- First legal dispute where a signature's timestamp becomes evidentiary
- First enterprise contract requiring third-party timestamping
- Agents ask for it as a paid premium feature

**Scope when planned:**
- TSA vendor selection (cost per stamp, availability, jurisdictional coverage)
- New table `property_signature_timestamps` with `tsa_provider`, `tsa_response_der`, `tsa_certificate_chain`, `timestamped_at`
- Sign flow: after Ed25519 sign, if listing is TSA-eligible, POST signature to TSA, store TSA response
- Verify endpoint returns `tsa_timestamp` alongside primary signature
- Eligibility policy: configurable per-tenant (all listings, listings above $X, agent opt-in per listing)
- Cost model: platform absorbs / passes through / paid add-on — pricing decision at plan time

**Estimated effort:** 1-2 sprints.

---

### 3. Blockchain / append-only anchoring

**Current (v1):** signatures live in Postgres, which is a mutable store from the platform operator's perspective (even with WAL and backups, a determined operator could rewrite history).

**Deferred (v3):** batch daily Merkle roots of all new signatures and anchor the root to a public blockchain (Ethereum, Bitcoin via OpenTimestamps, or a cheaper L2). Every signature can then be independently proven to have existed as of a specific block time without trusting the platform.

**Trigger to plan:** any of —
- Public accusation of the platform tampering with signatures (existential trust event)
- Regulatory push toward blockchain-anchored real-estate records in any operating market
- Cost per anchor drops below $0.10 daily

**Scope when planned:**
- Choice of anchoring service (self-hosted OpenTimestamps calendar vs. commercial like Chainpoint)
- Daily batch worker: aggregate hashes → Merkle tree → root anchor
- Merkle proof storage per signature
- Verify endpoint extension: return Merkle proof + blockchain reference
- Public dashboard showing anchor history

**Estimated effort:** 2 sprints for OpenTimestamps route; longer for custom L2.

---

### 4. Cross-tenant key delegation

**Current (v1):** each agent has their own keys. A tenant admin cannot sign on behalf of an agent, even for legitimate reasons (agent on leave, listing marked sold after agent departure).

**Deferred (v2):** tenant admins hold a "tenant admin listing" key that can sign amendments to listings owned by their tenant, with an explicit `signed_on_behalf_of` field in the signature payload. Preserves accountability while enabling operational continuity.

**Trigger to plan:** any of —
- Agencies request the capability
- First "agent unreachable, listing needs correction" incident
- Departing-agent workflow reaches production

**Scope when planned:**
- New purpose enum value: `tenant_admin_listing`
- Extend canonical serialization with optional `signed_on_behalf_of: {original_agent_id, reason, tenant_admin_id}`
- Verify endpoint clearly displays "signed by tenant admin on behalf of agent X"
- Audit trail: every delegated signature triggers an audit_log entry visible to both the tenant admin and the original agent (if reachable)
- Delegation policy: which admins can sign for which agents, expiration, revocation

**Estimated effort:** 1 sprint.

---

### 5. Formal key ceremony + published operational security document

**Current (v1):** keys are generated in-process on first agent activity. Master key is a Railway secret. No published ceremony.

**Deferred (v2):** on-demand key generation is fine for individual agents, but the platform's master key deserves a formal ceremony (multiple people present, hardware entropy source, split-key backup via Shamir's Secret Sharing, video-recorded and notarized if a regulator asks). Plus a public-facing OpSec document explaining custody, rotation cadence, revocation policy, and incident response.

**Trigger to plan:** any of —
- SOC 2 / ISO 27001 audit begins
- Enterprise procurement asks for a written key management policy
- Post-mortem on any signing-related incident

**Scope when planned:**
- Ceremony script + participants list
- Shamir split (e.g., 5-of-7) of master key material, stored across geographic locations
- Public OpSec document (Markdown, hosted at `/security/key-management`)
- Annual re-ceremony calendar
- External auditor review

**Estimated effort:** 1 sprint of prep + 1 day of ceremony + ongoing operational burden.

---

### 6. Third-party verification SDK

**Current (v1):** verify endpoint returns everything a verifier needs, but each verifier has to build their own client (fetch JSON, reconstruct canonical, compute hash, verify signature).

**Deferred (v2):** publish a small verification library (npm + Python + Go) that consumes the verify endpoint output and returns a boolean + failure reasons. Zero platform trust required to use it.

**Trigger to plan:** any of —
- First external site or portal wants to display "verified RB listing" badges
- Marketing wants a public "check if a listing is real" web tool
- Sold-price registry needs partners (banks, notaries) to independently verify records

**Scope when planned:**
- npm package `@realestatebazaar/verify` (~200 LoC — canonical rebuild, Ed25519 verify via libsodium-wrappers)
- Python package `rebazaar-verify` (PyPI, uses PyNaCl)
- Go module `github.com/realestatebazaar/verify`
- Documentation site with runnable examples
- Public test-vector set for verifier conformance testing

**Estimated effort:** 1 sprint for the primary SDK (npm), 0.5 sprint each for Python/Go.

---

### 7. Signature-linked media pinning

**Current (v1):** canonical serialization includes `media[].hash` (SHA-256 of file bytes), so tampering with the image after publish would invalidate the signature. But if the URL 404s, verification can only confirm the hash you had — you can't fetch and recompute.

**Deferred (v2):** pin canonical media to IPFS or a content-addressable store keyed by hash. If the origin URL disappears, media remains fetchable from the pinning service.

**Trigger to plan:** any of —
- Media loss incidents (agent deletes S3 object, hosting provider outage)
- Legal request to produce media in original form years after sold
- Cost of IPFS pinning per GB becomes trivial

**Scope when planned:**
- Pinning provider selection (Pinata, web3.storage, self-hosted IPFS cluster)
- Sign hook: after computing media hash, upload media to pin service, store IPFS CID alongside URL
- Verify endpoint: return both origin URL and IPFS CID
- Cost model + retention policy per tenant tier

**Estimated effort:** 1 sprint.

---

### 8. Public listing history browser

**Current (v1):** `property_signatures` stores every version. Only accessible via admin endpoint.

**Deferred (v2):** public `GET /listings/:hrid/history` page shows the timeline of every signed version — what changed between versions, when, by whom (agent name only, no PII). Transparency signal to buyers.

**Trigger to plan:** any of —
- Agents ask for it (proof of price journey — "this listing was $500k for 6 months before dropping to $450k")
- Buyers ask for it (spot-check for panic-drops or repeat listings)
- Legal/compliance want transparent price history public

**Scope when planned:**
- New public endpoint aggregating property_signatures with diff computation between versions
- Frontend history browser component
- Diff highlighter (which fields changed)
- Privacy filter (redact non-content changes, hide internal notes)

**Estimated effort:** 1 sprint.

---

## Cross-cutting: monitoring items to add in v1

Not deferred features per se, but instrumentation to add during 029b v1 so Phase 2 triggers can fire:

- `hrid_pool_pressure_events` — count of times HRUUID generation retried; alert if per-territory pressure rises
- `signature_write_latency_p95` — surfaces before it becomes an SLO problem
- `verify_endpoint_traffic` — informs when SDK is worth building
- `key_age_distribution` — surfaces when rotation is overdue
- `master_key_id_rotation_last` — never should be null for more than 400 days

Grafana dashboard `security/signing` exposes all six.
