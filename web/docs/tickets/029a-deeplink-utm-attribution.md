# Ticket 029a — Deep-link property_id seeding + UTM capture + session cross-reference

**Status:** Approved for build
**Parent:** [029 umbrella](./029-attribution-and-listing-identity.md)
**Depends on:** 029b (HRUUID must exist so REF token has something to point at)

## Problem

`conversations/orchestrator.js:ingestInboundMessage` auto-creates an inquiry when an inbound message arrives on any channel, but the inquiry has:
- `property_id = null` — no idea which listing the person was looking at
- no source attribution — no idea where they came from (Google, Instagram, direct, WhatsApp broadcast)
- no session context — no idea what else they browsed

Result: agents waste the first message asking "which property?"; marketing spend is unmeasurable; the sold-price registry cannot attribute sales to campaigns.

## Design

Three interlocking mechanisms:

**1. Deep-link seeding on outbound-conversation buttons.** Every listing page's WhatsApp/SMS/Email/portal-form contact button embeds `REF:<hrid>` into the outbound message or form payload. The orchestrator parses `REF:<hrid>` from the first inbound and attaches `property_id` automatically.

**2. UTM capture on portal.** Frontend captures `utm_*`, `document.referrer`, and `landing_page_url` on every page load, stores them in a session cookie under a rotating `session_id`, and forwards them with any inquiry-creating action (portal contact form, WhatsApp click, phone click).

**3. Portal session cross-reference.** Portal page views (only) get logged to `portal_session_events` keyed by `session_id` + a hash of the contact's phone (when known). When an inbound WhatsApp message arrives, orchestrator looks up recent sessions matching the sender's phone hash and attaches the last-seen UTM package + browsed-property list to `inquiry.source_ref`.

## Data model changes

### `inquiries` — new column

```sql
ALTER TABLE inquiries
  ADD COLUMN source_ref JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX idx_inquiries_source_ref_campaign
  ON inquiries ((source_ref->>'utm_campaign'))
  WHERE source_ref ? 'utm_campaign';
```

`source_ref` shape (JSON schema, all fields optional individually):
```json
{
  "utm_source": "instagram",
  "utm_medium": "paid",
  "utm_campaign": "batroun_summer_2026",
  "utm_content": "carousel_v2",
  "utm_term": null,
  "referrer_url": "https://l.instagram.com/...",
  "landing_page_url": "/property/RB-LB01-4K7Q",
  "session_id": "sess_01H...",
  "seeded_via": "whatsapp_deeplink",
  "browsed_properties": ["RB-LB01-4K7Q", "RB-LB01-8N2R", "RB-LB01-XYZ0"],
  "captured_at": "2026-08-12T14:22:11Z"
}
```

`seeded_via` enum: `whatsapp_deeplink | sms_deeplink | email_deeplink | portal_form | ig_dm | phone_click | organic`

### `contacts` — new column

```sql
ALTER TABLE contacts
  ADD COLUMN first_touch_utm JSONB;
```

Populated ONCE on the first inquiry that has a `source_ref.utm_*` — subsequent inquiries do not overwrite. Preserves first-touch attribution even if the contact converts through a different channel later.

### `portal_session_events` — new table

```sql
CREATE TABLE portal_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  contact_phone_hash TEXT,             -- SHA-256 of E.164 phone; nullable if unknown
  contact_email_hash TEXT,             -- SHA-256 of lowercased email; nullable
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,            -- 'page_view' | 'listing_view' | 'search' | 'contact_button_click' | 'wa_button_click'
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  property_hrid TEXT,                  -- denormalized for query convenience
  url TEXT NOT NULL,
  referrer_url TEXT,
  utm JSONB,                           -- utm_source/medium/campaign/content/term at page load
  user_agent TEXT,
  ip_country TEXT,                     -- coarse only, no full IP stored
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_pse_session ON portal_session_events(session_id, created_at DESC);
CREATE INDEX idx_pse_phone_hash ON portal_session_events(contact_phone_hash, created_at DESC)
  WHERE contact_phone_hash IS NOT NULL;
CREATE INDEX idx_pse_email_hash ON portal_session_events(contact_email_hash, created_at DESC)
  WHERE contact_email_hash IS NOT NULL;
CREATE INDEX idx_pse_property ON portal_session_events(property_id, created_at DESC)
  WHERE property_id IS NOT NULL;
```

Privacy notes:
- Full IP is never stored — only `ip_country` (coarse country lookup, retained for fraud/geo signal)
- Phone and email are hashed with SHA-256 (with a server-held salt) — hashes are the join key
- TTL: 90 days. A daily worker prunes rows older than 90 days. Configurable via `PORTAL_SESSION_EVENT_TTL_DAYS` env
- No user tracking outside this table — no third-party analytics scripts implied

## API changes

### `POST /api/inquiries` — portal contact form

Backend already exists. Extend request body validation (`lib/validation.js:inquirySchema`) to accept optional `source_ref` object:

```js
source_ref: z.object({
  utm_source: z.string().max(200).optional(),
  utm_medium: z.string().max(200).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_content: z.string().max(200).optional(),
  utm_term: z.string().max(200).optional(),
  referrer_url: z.string().url().max(2000).optional(),
  landing_page_url: z.string().max(2000).optional(),
  session_id: z.string().max(100).optional(),
}).optional()
```

Handler writes `source_ref` with `seeded_via = 'portal_form'` and adds `captured_at = now()`.

### `POST /api/portal-events` — new endpoint

Frontend beacon endpoint for page views. Called on every portal page load and on button clicks. Idempotent by client-side event_id. Rate-limited (bucket per session_id).

```
POST /api/portal-events
{
  session_id: "sess_...",
  event_type: "listing_view",
  property_hrid: "RB-LB01-4K7Q",
  url: "/property/RB-LB01-4K7Q",
  referrer_url: "https://...",
  utm: {utm_source, utm_medium, utm_campaign, utm_content, utm_term},
  contact_phone: "+9617...", // only if the user has volunteered it (e.g. saved contact)
  contact_email: "..."       // same
}
→ 202 Accepted (fire-and-forget)
```

Server hashes phone/email server-side (never stores plaintext), looks up `property_id` from `hrid`, writes `portal_session_events` row.

### `GET /api/listings/:hrid/contact-links` — new endpoint

Returns pre-constructed deep-link URLs for the listing's active contact channels, so the frontend never has to know how to construct them:

```
GET /api/listings/RB-LB01-4K7Q/contact-links?session_id=sess_...
→ 200
{
  hrid: "RB-LB01-4K7Q",
  whatsapp_url: "https://wa.me/96170...?text=Hi%2C%20REF%3ARB-LB01-4K7Q",
  sms_url: "sms:+96170...?body=Hi%20REF%3ARB-LB01-4K7Q",
  email_url: "mailto:agent@x.com?subject=Property%20RB-LB01-4K7Q&body=REF%3ARB-LB01-4K7Q",
  phone_click_url: "/api/phone-clicks?hrid=RB-LB01-4K7Q&session_id=sess_..." // 302 to tel:
}
```

Session_id is optional; when present it's carried through the phone_click redirect for later join.

### `GET /api/phone-clicks` — new redirect endpoint

Logs a `portal_session_events` row with `event_type='contact_button_click'`, then 302-redirects to `tel:<agent_phone>`. Captures the click even though tel: itself doesn't reveal anything.

## Orchestrator changes

`conversations/orchestrator.js:ingestInboundMessage` gains a step between "getOrCreateContact" and "getOrCreateInquiry":

```js
// Extract REF token from inbound text (WhatsApp, SMS, email body)
const refMatch = String(text || '').match(/\bREF:([A-Z0-9\-]{6,20})\b/i)
const seededHrid = refMatch?.[1]?.toUpperCase() || null
const seededPropertyId = seededHrid
  ? (await findOne('properties', p => p.hrid === seededHrid))?.id
  : null

// Cross-reference recent portal sessions when session xref enabled
let sessionSourceRef = null
if (process.env.ATTRIBUTION_SESSION_XREF_ENABLED === 'true' && contact.phone) {
  sessionSourceRef = await lookupRecentSessionForPhone(contact.phone, {maxAgeMinutes: 60})
}

// Compose source_ref
const source_ref = {
  ...(sessionSourceRef || {}),
  seeded_via: seededHrid ? `${channel}_deeplink` : 'organic',
  captured_at: new Date().toISOString(),
}
```

`lookupRecentSessionForPhone` queries `portal_session_events` where `contact_phone_hash = sha256(phone + salt)` in the last N minutes, aggregates the UTM package from the earliest event and browsed_properties from all events in the session.

First-touch UTM: on contact create (or on first inquiry with UTM if contact predates the feature), populate `contacts.first_touch_utm` from `source_ref` — only if currently null. Never overwrite.

## Frontend changes (to be verified against actual frontend on read)

Presumed frontend is React/Vite/TypeScript with per-page components. Changes:

1. **Global session bootstrap** (in app entry): on load, read/write a `rb_session_id` cookie (30-day expiry); read `location.search` UTMs; store `{session_id, utm_*, referrer, landing_page}` in a session store (Zustand/Redux/context — whichever exists).

2. **Page-view beacon** (in router hook): on route change, POST `/api/portal-events` with `event_type='page_view'` and — if the route is `/property/:hrid` — `event_type='listing_view'` with `property_hrid`.

3. **Contact buttons on listing page**: replace hardcoded links with a call to `GET /api/listings/:hrid/contact-links?session_id=...` and render the returned URLs. This lets the backend own URL construction so the token format can evolve without frontend redeploys.

4. **Contact form submit**: attach `source_ref` from session store to the POST body.

## Migration diff (Section A of 029)

```sql
-- Section A: Attribution (029a)

ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS source_ref JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_inquiries_source_ref_campaign
  ON inquiries ((source_ref->>'utm_campaign'))
  WHERE source_ref ? 'utm_campaign';

CREATE INDEX IF NOT EXISTS idx_inquiries_source_ref_source
  ON inquiries ((source_ref->>'utm_source'))
  WHERE source_ref ? 'utm_source';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS first_touch_utm JSONB;

CREATE TABLE IF NOT EXISTS portal_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  contact_phone_hash TEXT,
  contact_email_hash TEXT,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  property_hrid TEXT,
  url TEXT NOT NULL,
  referrer_url TEXT,
  utm JSONB,
  user_agent TEXT,
  ip_country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pse_session ON portal_session_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pse_phone_hash ON portal_session_events(contact_phone_hash, created_at DESC)
  WHERE contact_phone_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pse_email_hash ON portal_session_events(contact_email_hash, created_at DESC)
  WHERE contact_email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pse_property ON portal_session_events(property_id, created_at DESC)
  WHERE property_id IS NOT NULL;
```

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `ATTRIBUTION_DEEPLINK_ENABLED` | `false` | Master switch for REF token parsing in orchestrator |
| `ATTRIBUTION_SESSION_XREF_ENABLED` | `false` | Master switch for portal-session lookup |
| `PORTAL_SESSION_EVENT_TTL_DAYS` | `90` | Retention window for portal_session_events |
| `PORTAL_SESSION_HASH_SALT` | required in prod | Salt for SHA-256 phone/email hashing |

## Files touched

**Backend (paths grounded in code I've read):**
- `backend/src/conversations/orchestrator.js` — add REF parsing + session lookup
- `backend/src/lib/validation.js` — extend `inquirySchema` with optional `source_ref`
- `backend/src/server.js` — new routes: `POST /api/portal-events`, `GET /api/listings/:hrid/contact-links`, `GET /api/phone-clicks`
- `backend/src/persistence/table-mapper.js` — register `portal_session_events` mapping; add `source_ref` to inquiries mapping; add `first_touch_utm` to contacts mapping
- `backend/src/whiteLabel.js` — widget bootstrap script UTM forwarding on `/api/inquiries` submit
- New: `backend/src/lib/session-lookup.js` — `lookupRecentSessionForPhone(phone, opts)` helper
- New: `backend/src/persistence/migrations/029_attribution_and_listing_identity.sql` (Section A)

**Frontend (to be confirmed after frontend read):**
- App entry — session bootstrap
- Router hook — page-view beacon
- Listing page component — contact buttons via `/api/listings/:hrid/contact-links`
- Contact form component — attach `source_ref` on submit

## Testing

- Unit: REF token parser handles surrounding text, unicode, missing token, malformed hrid
- Unit: session_ref composer merges browsed_properties in order, dedups, respects max=20
- Unit: first_touch_utm never overwrites once set
- Integration: portal page view → session event row → subsequent WhatsApp inbound within TTL → inquiry source_ref populated
- Integration: WhatsApp REF-tagged message → inquiry.property_id populated regardless of session xref
- Integration: portal contact form POST → inquiry with correct seeded_via, utm fields
- Integration: contact form POST when contact predates first_touch_utm → contacts row gets first_touch_utm set
- Load: session lookup index performance at 10M portal_session_events rows

## Rollout

1. Deploy backend with all flags `false`. Migration runs (both sections — 029a and 029b together).
2. Enable `ATTRIBUTION_DEEPLINK_ENABLED=true`. Test with staging WhatsApp number; verify inquiry.property_id populates.
3. Deploy frontend changes (session bootstrap + beacon + contact-links call).
4. Enable `ATTRIBUTION_SESSION_XREF_ENABLED=true`. Monitor `portal_session_events` write rate; tune TTL if storage growth surprises.
5. Backfill: no backfill for source_ref (only forward-looking). Historical inquiries stay with `source_ref = {}`.

## Success metrics (30 days post-launch)

- ≥ 85% of inquiries from listing-page contact buttons have `property_id` set (vs. 0% today)
- ≥ 70% of inquiries have some `utm_*` field populated
- ≥ 30% of WhatsApp inbounds successfully cross-referenced to a portal session (subject to WhatsApp-first vs portal-first traffic mix)
- Zero PII incidents from portal_session_events (audit hash salt rotation quarterly)
