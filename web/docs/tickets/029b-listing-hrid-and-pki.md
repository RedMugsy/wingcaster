# Ticket 029b — Listing HRUUID + Ed25519 signatures + verify endpoint

**Status:** Approved for build
**Parent:** [029 umbrella](./029-attribution-and-listing-identity.md)
**Depends on:** [029c BLC scheme](./029c-locality-code-scheme.md) — must land first
**Deferred items:** [029b Phase 2 actions](./029b-phase2-actions.md)
**Blocks:** 029a (REF token points at HRUUIDs), sold-price registry, anti-fraud verify page

## Problem

Listings today have UUID primary keys that are:
- Not human-shareable (`e4b8f92a-3c1d-...`)
- Not tamper-evident (no proof the content shown matches what was published)
- Not verifiable across platforms (a syndicated Instagram post cannot be independently authenticated as originating from RB)

Consequences:
- Print/social/QR channels are awkward — no memorable ID to share
- No defense against listing-scraping fraud (a scam site copies your listing, alters the price, claims to be the source)
- The sold-price registry cannot bind a sold record to a specific *version* of a listing (was the price $450k in the signed content when it sold, or was it edited after?)

## Design

Every listing gets two additional identifiers:

**HRUUID (human-readable, public)** — a short, memorable, printable ID visible in URLs, WhatsApp REF tokens, IG captions, QR codes. Format: `RB-<CC><TerritoryNum>-<XXXX>`.

**Cryptographic signature (machine-verifiable, public)** — every publish (create or update) signs the canonical serialization of the listing content with the agent's Ed25519 listing-purpose key. Signature + content_hash + signed_at + key_id are stored in `property_signatures`, one row per publish version. Full history preserved.

## HRUUID format

Locked format: **`RB-YYLLLLL-XXXX`**

- `RB` — fixed brand prefix
- `YY` — last 2 digits of listing's `created_at` year (`26` = 2026); locked at creation, never changes
- `LLLLL` — 5-digit **Bazaar Locality Code** (BLC) of the listing's most-specific locality; see [029c](./029c-locality-code-scheme.md) for the BLC allocation scheme
- `XXXX` — 4-character Crockford base32 suffix, uppercase, random, unique per (year × BLC)

**Example HRUUIDs:**

| HRUUID | Decodes to |
|---|---|
| `RB-2610002-4K7Q` | 2026 · Lebanon / Beirut / Achrafieh (BLC 10002) · suffix 4K7Q |
| `RB-2610003-8N2R` | 2026 · Lebanon / Beirut / Mar Mikhael (BLC 10003) · suffix 8N2R |
| `RB-2612002-M3P0` | 2026 · Lebanon / North / Batroun (BLC 12002) · suffix M3P0 |
| `RB-2720051-A1B2` | 2027 · UAE cluster (group 2) · locality 0051 (hypothetical) · suffix A1B2 |

Total length: `RB-` (3) + `2610002` (7) + `-` (1) + `4K7Q` (4) = **15 chars**.

**Character set for XXXX:** Crockford base32 excluding `I`, `L`, `O`, `U` (visually ambiguous or profane-adjacent). Actual alphabet: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — 32 chars, no ambiguity.

**Namespace math:** 32⁴ = 1,048,576 unique suffixes per (year × BLC). Achrafieh in a single year could see ~1M new listings before pressure; realistic ceiling is hundreds. Zero practical collision risk.

**Collision handling:** on insert, generate random suffix, `INSERT ... ON CONFLICT (hrid) DO NOTHING`, retry up to 5 times. If all 5 collide (statistically ~1 in 10^24), extend suffix to 5 chars for that listing. Logged as a `hrid_pool_pressure_event` for monitoring.

**Reserved words:** the suffix generator excludes a stoplist of 4-char sequences that spell offensive terms in EN/AR/FR. Stoplist lives in `backend/src/lib/hrid/stoplist.txt`, checked at generate time.

**Year segment semantics:** `YY` is locked at listing `created_at` — a 2026 listing stays `RB-26...` forever, even when re-signed in 2028. This preserves the "hrid is permanent identity" property. New 2027 listings start with `RB-27...`. Rolls over cleanly on Jan 1 without operator action.

**BLC segment semantics:** `LLLLL` comes from `properties.locality_blc`, which is the BLC of the locality assigned at listing creation. If the property's locality is later corrected (curator moves it from Beirut/Achrafieh to Beirut/Sioufi), the **hrid does not change** — locality changes are tracked in the property row, but the hrid retains the original BLC. This is intentional: hrids are permanent references. A locality-correction event is stored in `activity_log`.

## Ed25519 signing infrastructure

### Key model

One `agent_signing_keys` row per (agent, purpose) pair. Purposes:

- `consent` — signs engagement-policy consent statements (Principle 11 from tenant-authorization-architecture.md)
- `listing` — signs listing content (this ticket)
- `transfer` — signs lead/asset transfer receipts (future)

Each key has a `key_id` (referenced by signatures) and a lifecycle: `active | rotating | revoked`. Only one `active` key per (agent, purpose) at a time; multiple `rotating` allowed briefly during handover.

### Custody (v1)

- Ed25519 keypair generated server-side using `crypto.generateKeyPairSync('ed25519')` (node built-in, libsodium under the hood)
- Private key is sealed with `sodium.crypto_secretbox_easy` using a master key `LISTING_SIGNING_MASTER_KEY` (32 bytes, hex-encoded env var, provisioned via Railway secrets)
- Master key rotation: generate new master key, re-encrypt all `private_key_enc` rows in a background job, atomically switch `LISTING_SIGNING_MASTER_KEY_ID` env, retire old master
- Signing: `LISTING_SIGNING_MASTER_KEY` is read into memory on process start, private keys are decrypted only inside the sign function (never logged, never written to disk)
- Public key is stored in cleartext on the row and exposed at `.well-known/rebazaar-keys.json`

**HSM/hardware custody is Phase 2** — see [029b Phase 2 actions](./029b-phase2-actions.md).

### Signing algorithm

1. Take the listing row + its media list + its published version number
2. Build the canonical JSON (see below) — deterministic key ordering, no whitespace, UTF-8 NFC normalization
3. Compute `content_hash = sha256(canonical_json)` (hex, lowercase)
4. Sign the bytes `"rebazaar-listing-v1|" || content_hash || "|" || signed_at_iso || "|" || key_id || "|" || version` with the active listing-purpose Ed25519 private key for the agent
5. Insert a `property_signatures` row

The domain-separation prefix `"rebazaar-listing-v1|"` prevents signature reuse across purposes even if the same key were mistakenly used for another domain (defense in depth against the "one key many purposes" concern).

### Canonical serialization

Included fields (grounded in `properties` schema from migration 003 + tenant_id/ownership additions from 028):

```
{
  "hrid": "RB-LB01-4K7Q",
  "id": "<internal-uuid>",
  "tenant_id": "agency:...",
  "agent_id": "<uuid>",
  "version": 3,
  "title": "...",
  "description": "...",
  "listing_type": "sale" | "rent",
  "property_type": "apartment" | ...,
  "price": 450000,
  "price_unit": "USD",
  "bedrooms": 3,
  "bathrooms": 2.5,
  "area": 220,
  "area_unit": "sqm",
  "city": "...",
  "neighborhood": "...",
  "latitude": 34.2559,
  "longitude": 35.6586,
  "territory_id": "territory-lb",
  "status": "active" | "sold" | "off_market",
  "media": [
    {"url": "https://...", "hash": "sha256:...", "type": "image", "order": 0},
    ...
  ]
}
```

Rules:
- JSON keys sorted alphabetically at every level
- No trailing whitespace, no indentation, single-line output
- `null` fields omitted entirely
- `media[].hash` computed as SHA-256 of the media file bytes (fetched at sign time; cached with 24h TTL to avoid refetch on every re-sign)
- Numbers as JSON numbers (no string coercion), booleans as booleans
- Unicode strings normalized to NFC

Fields **excluded** from canonical (metadata, not content):
- `created_at`, `updated_at`, `last_asset_generated_at`, `asset_version`, `views`
- Any `data` JSONB overflow fields (opaque, versioning-hostile)
- Any admin-only fields (moderation notes, internal tags)

Excluded fields can change without triggering a re-sign.

### When to sign

- On property create: sign version 1
- On property update: recompute canonical; if canonical hash differs from previous version's `content_hash`, sign new version N+1
- If canonical hash matches (edit only touched excluded fields): no new signature, `updated_at` bumps only
- On media reorder or add/remove: sign new version (media is in canonical)

### Verify endpoint

```
GET /api/listings/:hrid/verify
→ 200
{
  "hrid": "RB-LB01-4K7Q",
  "canonical_content": { ... exact bytes signed ... },
  "content_hash": "sha256:hex",
  "signature": "base64",
  "signed_at": "2026-08-12T14:22:11.000Z",
  "key_id": "kagent_abc123_listing_v1",
  "version": 3,
  "agent_public_key": "base64",
  "verify_instructions": {
    "algorithm": "ed25519",
    "signed_bytes_construction": "\"rebazaar-listing-v1|\" || content_hash || \"|\" || signed_at || \"|\" || key_id || \"|\" || version",
    "canonical_json_spec": "sorted keys, no whitespace, UTF-8 NFC, nulls omitted"
  },
  "well_known_url": "https://realestatebazaar.com/.well-known/rebazaar-keys.json"
}
```

Callable by anyone, no auth. Rate-limited per IP.

### `.well-known/rebazaar-keys.json`

```
GET /.well-known/rebazaar-keys.json
→ 200 (cached 5 min)
{
  "keys": [
    {
      "key_id": "kagent_abc123_listing_v1",
      "agent_id": "<uuid>",
      "agent_display_name": "Ali Achkar",
      "purpose": "listing",
      "algorithm": "ed25519",
      "public_key": "base64",
      "status": "active" | "rotating" | "revoked",
      "activated_at": "2026-01-01T00:00:00Z",
      "revoked_at": null
    },
    ...
  ]
}
```

Revoked keys stay in the endpoint indefinitely so historical signatures can still be verified — a signature made by a since-revoked key is still valid *as of its signed_at time*, provided the key wasn't revoked for compromise. Compromise revocations set an additional `compromised_at` field; verifiers should treat signatures made after `compromised_at` as untrusted.

### Key rotation

Scheduled every 365 days per key (configurable). Rotation flow:

1. Generate new keypair for the same (agent, purpose)
2. Set new key status = `active`, old key status = `rotating`
3. New signatures use new key
4. After 30-day grace period (during which agents may still be publishing content signed with the old key from cached processes), set old key status = `revoked` with `revoked_at = now`, `compromised_at = null`
5. Old signatures remain valid; verifier gets the old public key from `.well-known` and confirms

### Compromise revocation

Manual admin action (`POST /api/admin/signing-keys/:key_id/revoke {reason, compromised_at}`):
- Sets status = `revoked`, `revoked_at = now`, `compromised_at = provided timestamp`
- All signatures with `signed_at > compromised_at` display as "untrusted" in verify response
- Immediately rotates in a new active key
- Emails/notifies the affected agent

## Data model changes

### `localities` — provided by 029c

BLC assignment lives in [029c](./029c-locality-code-scheme.md). This ticket assumes:
- `localities` table exists with `blc INTEGER UNIQUE`
- `properties.locality_id` and `properties.locality_blc` columns already added
- Property backfill for locality mapping has already run (via 029c pre-migration hygiene script)

No territory-prefix work is done here. HRUUID composition reads `properties.locality_blc` directly.

### `properties` — new column

```sql
ALTER TABLE properties
  ADD COLUMN hrid TEXT UNIQUE;

CREATE INDEX idx_properties_hrid ON properties(hrid);
```

Backfill: iterate existing properties in create-date order (so year segment matches actual creation year), read `locality_blc` (populated by 029c backfill), generate suffix from the (year, BLC) pool, update.

Properties whose `locality_blc` is NULL after 029c backfill (unmapped locality) are surfaced in a backfill report and require curator intervention before their hrid can be issued. Their listing stays accessible via UUID URL until then.

### `agent_signing_keys` — new table

```sql
CREATE TABLE agent_signing_keys (
  key_id TEXT PRIMARY KEY,
  agent_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('consent', 'listing', 'transfer')),
  algorithm TEXT NOT NULL DEFAULT 'ed25519' CHECK (algorithm = 'ed25519'),
  public_key BYTEA NOT NULL,
  private_key_enc BYTEA NOT NULL,           -- libsodium secretbox-sealed
  master_key_id TEXT NOT NULL,              -- which LISTING_SIGNING_MASTER_KEY_ID sealed this
  status TEXT NOT NULL CHECK (status IN ('active', 'rotating', 'revoked')),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  compromised_at TIMESTAMPTZ,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX uq_signing_keys_active_per_agent_purpose
  ON agent_signing_keys(agent_user_id, purpose)
  WHERE status = 'active';

CREATE INDEX idx_signing_keys_purpose ON agent_signing_keys(purpose, status);
```

### `property_signatures` — new table

```sql
CREATE TABLE property_signatures (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  content_hash TEXT NOT NULL,           -- sha256 hex, lowercase
  canonical_json JSONB NOT NULL,        -- exact bytes signed, stored for audit
  signature BYTEA NOT NULL,             -- ed25519 signature bytes
  signed_at TIMESTAMPTZ NOT NULL,
  signed_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  signing_key_id TEXT NOT NULL REFERENCES agent_signing_keys(key_id) ON DELETE RESTRICT,
  algorithm TEXT NOT NULL DEFAULT 'ed25519',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX uq_property_signatures_version
  ON property_signatures(property_id, version);

CREATE INDEX idx_property_signatures_latest
  ON property_signatures(property_id, version DESC);

CREATE INDEX idx_property_signatures_hash
  ON property_signatures(content_hash);
```

`ON DELETE RESTRICT` on `signing_key_id` — never orphan a signature. Revoked keys are kept but not deletable.

## API surface

### New endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/listings/:hrid/verify` | none | Return signature + canonical + verify instructions for a listing |
| `GET` | `/.well-known/rebazaar-keys.json` | none | Public key roster |
| `POST` | `/api/admin/signing-keys/:key_id/revoke` | platform_admin | Compromise revocation |
| `POST` | `/api/admin/signing-keys/:agent_user_id/rotate` | platform_admin | Manual rotation trigger |

### Modified endpoints

| Method | Path | Change |
|---|---|---|
| `GET` | `/api/properties/:id` | Accept hrid OR uuid; 301 to hrid canonical URL |
| `POST` | `/api/properties` | On success, sign version 1 |
| `PATCH` | `/api/properties/:id` | On canonical-changing update, sign new version |
| `POST` | `/api/properties/:id/media` | Media add triggers re-sign |
| `DELETE` | `/api/properties/:id/media/:mid` | Media remove triggers re-sign |

## Files touched

**Backend:**
- `backend/src/persistence/migrations/029_attribution_and_listing_identity.sql` (Section B)
- `backend/src/persistence/table-mapper.js` — register `agent_signing_keys`, `property_signatures`; add `hrid` to properties mapping. (Locality mappings come from 029c.)
- New: `backend/src/lib/hrid/index.js` — generate/validate HRUUIDs, collision retry, stoplist check, format-parse (extract year + BLC + suffix)
- New: `backend/src/lib/hrid/stoplist.txt` — 4-char sequences to skip
- New: `backend/src/lib/signing/index.js` — key generation, sealing, sign/verify primitives
- New: `backend/src/lib/signing/canonical.js` — canonical JSON serializer
- New: `backend/src/lib/signing/keystore.js` — key rotation, revocation, active-key lookup
- New: `backend/src/services/listing-signer.js` — orchestrates content_hash → sign → property_signatures insert
- `backend/src/server.js` — new routes; sign hooks on property write endpoints
- `backend/src/whiteLabel.js` — listing import assigns hrid; signs on import
- `backend/src/modules/whatsapp-listings/platform-adapter.js` — `createListing` / `updateListing` sign after write
- `backend/src/seed.js` — seed data gets hrids

**Testing:**
- New: `backend/src/lib/signing/canonical.test.js` — determinism (same input → same bytes across Node versions, locales)
- New: `backend/src/lib/signing/signer.test.js` — sign/verify roundtrip, tamper detection, key rotation
- New: `backend/src/lib/hrid/index.test.js` — collision retry, stoplist, format validation

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `LISTING_SIGNING_ENABLED` | `false` | Master switch — when off, property writes skip signing |
| `LISTING_SIGNING_MASTER_KEY` | required in prod | 32-byte hex for libsodium secretbox |
| `LISTING_SIGNING_MASTER_KEY_ID` | required in prod | Identifier for rotation tracking |
| `LISTING_SIGNING_ROTATION_DAYS` | `365` | Days between scheduled key rotations |
| `LISTING_SIGNING_ROTATION_GRACE_DAYS` | `30` | Grace period before old rotating key → revoked |
| `MEDIA_HASH_CACHE_TTL_HOURS` | `24` | Cache TTL for media SHA-256 lookups |

## Testing

- Canonical determinism across Node versions and locales (NFC normalization gotcha)
- Sign/verify roundtrip
- Tamper detection: alter a field in canonical → verify fails
- Key rotation: sign with key v1 → rotate to v2 → verify old signature still works via revoked key lookup
- Compromise revocation: revoke with `compromised_at = T` → signature signed after T shows as untrusted, before T stays trusted
- HRUUID collision retry: force 3 collisions, verify 4th attempt succeeds
- HRUUID stoplist: forbidden sequences never emitted (property-based test with fixed seed)
- Verify endpoint returns exact canonical bytes; independent Node script can verify with only public key
- Migration idempotency: run twice, no errors

## Rollout

Follows the 3-step sequence in the umbrella doc:

1. Land migration (keys table + signatures table + hrid columns). Backfill hrids on existing properties. `LISTING_SIGNING_ENABLED=false`. Verify endpoint returns "unsigned" status for pre-signing properties.
2. Backfill: generate active listing-purpose key per existing agent (background job, batched, resumable). Verify `.well-known/rebazaar-keys.json` populates.
3. Flip `LISTING_SIGNING_ENABLED=true`. Backfill re-sign of all active properties (batched job, low priority, respects concurrency). New writes sign inline.

Rollback: flip flag off — new signatures stop, old signatures remain valid and queryable.

## Success metrics (30 days post-launch)

- 100% of active listings have at least one signature
- 100% of property writes produce a signature within 500ms p95
- Verify endpoint p50 latency < 30ms (single DB round-trip + JSON serialize)
- Zero signature validation failures on ANY historical signature (integrity monitor runs hourly)
- Zero private key exposures in logs (grep audit weekly)

## Related documents

- [Tenant Authorization Architecture](../tenant-authorization-architecture.md) — Principle 11 blesses Ed25519 for consent; this ticket introduces the shared key infrastructure
- [029 umbrella](./029-attribution-and-listing-identity.md)
- [029b Phase 2 actions](./029b-phase2-actions.md)
