# Ticket 031 — Property sold-price registry

**Status:** Approved for build
**Depends on:**
- [029b listing HRUUID + PKI](./029b-listing-hrid-and-pki.md) — sold records bind to a specific signed version of the listing
- [029a attribution](./029a-deeplink-utm-attribution.md) — sold records inherit attribution snapshot from the winning inquiry's `source_ref`
- [029c locality codes](./029c-locality-code-scheme.md) — pricing benchmarks aggregate by BLC
- [030 inquiry stage guards](./030-inquiry-stage-transition-guards.md) — sold record recording synchronizes with `inquiry.stage = 'won'` transition
**Blocks:** public price benchmarking; agent attribution dashboard; ROI reporting

## Purpose

Close the loop from listing → conversation → sale, capturing:

1. **What the property actually sold for** (not the asking price) → feeds pricing intelligence as the highest-trust price signal
2. **Where the buyer came from** (mandatory attribution) → answers "does the platform actually generate sales?"
3. **Which listing version was live at the time of sale** (signature-bound) → auditable price-history integrity
4. **Aggregate market truth over time** → the platform becomes the authoritative price benchmark for its markets

The existing `agent_price_reports` table already handles **external** sales the agent knows about (e.g. "my competitor sold a similar villa for X"). This ticket adds the parallel first-party mechanism for the agent's **own** listings when they close, with mandatory attribution to platform vs. non-platform buyer.

## Trigger point

The record is created at the moment the agent transitions their property to `status = 'sold'`. This is not optional — the status transition and the sold record are atomically coupled. You cannot mark sold without recording; you cannot record without marking sold.

Same pattern as 030 for inquiry stage transitions: `properties.status` becomes an enum with CHECK constraint, and a transition guard function refuses the write unless the accompanying sold_record payload is valid.

## Property status enum (new)

```
DRAFT → ACTIVE → { PENDING → SOLD, RENTED, OFF_MARKET, WITHDRAWN }
                ↕ back to ACTIVE
              → SOLD (skips pending — direct close)
              → RENTED
```

| Status | Meaning | Terminal? |
|---|---|---|
| `draft` | Being composed, not visible | No |
| `active` | Live on marketplace, accepting inquiries | No |
| `pending` | Under offer/negotiation, still visible with "under offer" badge | No |
| `sold` | Sale closed; requires companion sold_record | Yes (until admin correction) |
| `rented` | Lease signed; requires companion sold_record with `transaction_type='rent'` | Yes |
| `off_market` | Withdrawn temporarily (owner decision, seasonal, etc.) | No |
| `withdrawn` | Explicitly withdrawn permanently, no sale | Yes (until admin reactivation) |

Transitions to `sold` and `rented` require a sold_record. Other transitions do not.

## Mandatory sold-record fields

At transition to sold (or rented), the agent must supply:

| Field | Type | Required | Notes |
|---|---|---|---|
| `transaction_type` | enum | ✅ | `sale` or `rent` |
| `sold_price` | numeric > 0 | ✅ | Final closing price (sale) or contracted rent (rent) |
| `sold_currency` | text | ✅ | ISO code — USD, LBP, AED, etc. |
| `sold_date` | date | ✅ | Actual close date; must be ≤ today and ≥ property `listed_date` |
| `buyer_from_platform` | boolean | ✅ | The mandatory attribution question |
| `attributed_inquiry_id` | FK inquiries | ✅ when `buyer_from_platform = true` | Picklist scoped to inquiries for THIS property |
| `external_source_type` | enum | ✅ when `buyer_from_platform = false` | `walk_in \| referral \| other_agent \| print_ad \| repeat_client \| other` |
| `attribution_notes` | text | Optional | Free-text edge cases |
| `supporting_document_urls` | JSONB array | Optional | Sale contract PDF, receipt, etc. — for verification tier |

For rentals: `sold_price` represents the periodic rent, `rent_period` (`monthly | annual`) becomes required.

## Data model

### `property_sold_records` — new table

```sql
CREATE TABLE property_sold_records (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  hrid TEXT,                                    -- denormalized snapshot of property.hrid at record time
  property_signature_id TEXT REFERENCES property_signatures(id) ON DELETE RESTRICT,
                                                -- exact signed version of the listing at sale
  locality_id TEXT REFERENCES localities(id) ON DELETE SET NULL,   -- denormalized
  locality_blc INTEGER,                          -- denormalized for aggregation

  -- Transaction
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('sale','rent')),
  rent_period TEXT CHECK (rent_period IN ('monthly','annual')),
  sold_price NUMERIC NOT NULL CHECK (sold_price > 0),
  sold_currency TEXT NOT NULL,
  sold_price_normalized_usd NUMERIC,             -- via currency-service at record time
  currency_rate NUMERIC,
  currency_rate_source TEXT,
  currency_rate_effective_at TIMESTAMPTZ,
  currency_rate_is_stale BOOLEAN,
  sold_date DATE NOT NULL,

  -- Attribution
  buyer_from_platform BOOLEAN NOT NULL,
  attributed_inquiry_id TEXT REFERENCES inquiries(id) ON DELETE SET NULL,
  attributed_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  attributed_channel TEXT,                       -- copied from inquiry.first_touch_channel at record time
  attributed_source_ref JSONB,                   -- frozen snapshot of inquiry.source_ref at record time
  external_source_type TEXT CHECK (external_source_type IN
    ('walk_in','referral','other_agent','print_ad','repeat_client','other')),
  attribution_notes TEXT,

  -- Provenance
  recorded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Verification
  verification_status TEXT NOT NULL DEFAULT 'self_reported'
    CHECK (verification_status IN ('self_reported','verified','disputed','superseded')),
  verified_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  supporting_document_urls JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Correction chain
  supersedes_id TEXT REFERENCES property_sold_records(id) ON DELETE SET NULL,
  superseded_by_id TEXT REFERENCES property_sold_records(id) ON DELETE SET NULL,
  correction_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Constraints
  CONSTRAINT sold_records_attribution_shape CHECK (
    (buyer_from_platform = true  AND attributed_inquiry_id IS NOT NULL) OR
    (buyer_from_platform = false AND external_source_type IS NOT NULL)
  ),
  CONSTRAINT sold_records_rent_period CHECK (
    (transaction_type = 'rent'  AND rent_period IS NOT NULL) OR
    (transaction_type = 'sale'  AND rent_period IS NULL)
  ),
  CONSTRAINT sold_records_verified_by CHECK (
    (verification_status = 'verified' AND verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL) OR
    verification_status <> 'verified'
  )
);

-- One ACTIVE (non-superseded) record per property. Corrections coexist but only newest is active.
CREATE UNIQUE INDEX uq_sold_records_active_per_property
  ON property_sold_records(property_id)
  WHERE superseded_by_id IS NULL AND verification_status <> 'superseded';

CREATE INDEX idx_sold_records_property ON property_sold_records(property_id);
CREATE INDEX idx_sold_records_attributed_inquiry ON property_sold_records(attributed_inquiry_id)
  WHERE attributed_inquiry_id IS NOT NULL;
CREATE INDEX idx_sold_records_attributed_contact ON property_sold_records(attributed_contact_id)
  WHERE attributed_contact_id IS NOT NULL;
CREATE INDEX idx_sold_records_locality_blc ON property_sold_records(locality_blc)
  WHERE locality_blc IS NOT NULL;
CREATE INDEX idx_sold_records_sold_date ON property_sold_records(sold_date DESC);
CREATE INDEX idx_sold_records_recorded_by ON property_sold_records(recorded_by_user_id);
CREATE INDEX idx_sold_records_utm_campaign
  ON property_sold_records ((attributed_source_ref->>'utm_campaign'))
  WHERE attributed_source_ref ? 'utm_campaign';
```

### `properties` — status enum tightening

```sql
-- Normalize existing status values first (analogous to 030 pre-migration hygiene)
UPDATE properties SET status = 'active' WHERE lower(status) IN ('active','live','published');
UPDATE properties SET status = 'sold' WHERE lower(status) IN ('sold','closed');
-- etc. Non-mappable → NULL, surfaced for review

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_status_check;
ALTER TABLE properties
  ADD CONSTRAINT properties_status_check
  CHECK (status IS NULL OR status IN (
    'draft','active','pending','sold','rented','off_market','withdrawn'
  ));

-- Status transition history (mirrors inquiry_stage_history from 030)
CREATE TABLE IF NOT EXISTS property_status_history (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  sold_record_id TEXT REFERENCES property_sold_records(id) ON DELETE SET NULL,
  changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_property_status_history_property
  ON property_status_history(property_id, changed_at DESC);
```

Existing `properties.status='sold'` rows without a sold_record are backfilled to a synthetic record with `verification_status='migrated_no_attribution'` — a new enum value added specifically to keep migrated rows out of attribution metrics:

```sql
ALTER TABLE property_sold_records
  DROP CONSTRAINT IF EXISTS property_sold_records_verification_status_check;
ALTER TABLE property_sold_records
  ADD CONSTRAINT property_sold_records_verification_status_check
  CHECK (verification_status IN
    ('self_reported','verified','disputed','superseded','migrated_no_attribution'));
```

Migrated rows have `buyer_from_platform=false`, `external_source_type='other'`, `attribution_notes='backfilled from pre-registry sold status'`. Analytics filters these out by default.

## Transition guard service

New: `backend/src/properties/status-service.js` — mirrors the pattern from 030:

```js
export const PropertyStatus = {
  DRAFT: 'draft', ACTIVE: 'active', PENDING: 'pending',
  SOLD: 'sold', RENTED: 'rented',
  OFF_MARKET: 'off_market', WITHDRAWN: 'withdrawn',
}

export const transitions = {
  [PropertyStatus.DRAFT]:      [PropertyStatus.ACTIVE, PropertyStatus.WITHDRAWN],
  [PropertyStatus.ACTIVE]:     [PropertyStatus.PENDING, PropertyStatus.SOLD, PropertyStatus.RENTED,
                                PropertyStatus.OFF_MARKET, PropertyStatus.WITHDRAWN],
  [PropertyStatus.PENDING]:    [PropertyStatus.SOLD, PropertyStatus.RENTED, PropertyStatus.ACTIVE, PropertyStatus.WITHDRAWN],
  [PropertyStatus.OFF_MARKET]: [PropertyStatus.ACTIVE, PropertyStatus.WITHDRAWN],
  [PropertyStatus.SOLD]:       [],   // terminal — admin correction only
  [PropertyStatus.RENTED]:     [],   // terminal — admin correction only
  [PropertyStatus.WITHDRAWN]:  [PropertyStatus.ACTIVE],
}

export async function transitionPropertyStatus(propertyId, toStatus, {
  actorId,
  soldRecordPayload,   // required when toStatus IN (sold, rented)
  reason,
}) {
  // 1. Load property, verify canTransition(current, toStatus)
  // 2. If toStatus IN (sold, rented):
  //    a. Validate soldRecordPayload against schema
  //    b. Verify attributed_inquiry_id (if given) belongs to this property
  //    c. Look up latest property_signatures row → signature_id
  //    d. Normalize sold_price via currency-service (snapshot rate)
  //    e. If buyer_from_platform: copy inquiry.contact_id, first_touch_channel, source_ref
  // 3. In a transaction:
  //    a. INSERT property_sold_records
  //    b. UPDATE properties SET status=toStatus
  //    c. INSERT property_status_history
  //    d. If attributed_inquiry_id: transitionInquiryStage(inquiry, 'won', {actorId, wonReason:'converted'})
  //    e. Invalidate pricing analyses for the area via recalculationJobService.invalidateForPropertyChange
  // 4. Return {property, sold_record}
}
```

## Attribution inheritance (frozen snapshot)

When `buyer_from_platform = true` and `attributed_inquiry_id` is set, the service reads the inquiry ONCE and copies to the sold_record:

- `attributed_contact_id` ← inquiry.contact_id
- `attributed_channel` ← inquiry.first_touch_channel (or contact.first_touch_channel if inquiry lacks one)
- `attributed_source_ref` ← inquiry.source_ref (deep clone — a frozen JSON snapshot)

This is intentional: if the inquiry is later edited, the sold record's attribution does not shift. The sale is attributed to what we knew at record time. Prevents post-hoc attribution rewriting.

The attributed inquiry is also transitioned to stage `won` in the same transaction (via 030's `transitionInquiryStage`) with `won_reason` derivable from the sold_record.

## Signature binding (loop closure with 029b)

At record time:

```sql
SELECT id, version
FROM property_signatures
WHERE property_id = :property_id
ORDER BY version DESC
LIMIT 1
```

Store as `property_sold_records.property_signature_id`. This lets any auditor answer:

- "What was the listed price when it sold?" → look up the signed content_hash and canonical_json for that signature
- "Was the description altered after the sale to hide something?" → any content edit after sale creates a new signature; the sold record's signature_id is frozen, so a diff is machine-checkable

If the property was published before 029b landed (no signatures ever), `property_signature_id` is NULL and the sold_record records that fact in `data.no_signature_reason`. Not fatal — just a lower audit tier for that record.

## Pricing intelligence integration

Extend `backend/src/modules/market-pricing/application/comparable-service.js:findAgentReportCandidates` to also read from `property_sold_records`:

```js
// Existing: reads from agent_price_reports (external sales)
const externalReports = await dal.findAll(Collections.AGENT_PRICE_REPORTS,
  (r) => r.status === 'verified')

// NEW: read first-party sold records
const firstPartySales = await dal.findAll('property_sold_records', (r) =>
  ['self_reported', 'verified'].includes(r.verification_status) &&
  r.superseded_by_id === null &&
  r.transaction_type === 'sale' &&  // rent excluded from sale comparables
  r.locality_blc === targetLocalityBlc
)
```

Weight order in comparable pool (highest trust first):

1. **`internal_sold_verified`** — property_sold_records with `verification_status='verified'` — reliability 1.0
2. **`internal_sold_self_reported`** — property_sold_records with `verification_status='self_reported'` — reliability 0.9
3. **`external_agent_report_verified`** — existing agent_price_reports verified — reliability 0.8
4. **`external_scraped`** — external_comparables — reliability per source (0.5–0.7)
5. **`internal_listing`** — active listing asking prices — reliability 0.4 (asking, not sold)

New comparable type `internal_sold` recognized in `analysis-service.js:comparableType()`. Existing IQR outlier quarantine and weighted-quantile stats work unchanged.

**Aging bonus:** sold records from within the last 90 days get a time-weight bonus (recency premium in a moving market). Sold records older than 730 days get downweighted. Implemented in the existing time-weight formula in `comparable-service.js` — just needs new coefficients for the `internal_sold` type.

## Public benchmarking (aggregation only)

**Never expose per-record data publicly.** Only aggregations, gated by minimum sample size:

```
GET /api/pricing/benchmarks?blc=10002&property_type=apartment&bedrooms=3&period=quarterly
→ 200
{
  "blc": 10002,
  "locality_name": "Achrafieh",
  "property_type": "apartment",
  "bedrooms": 3,
  "period": "2026-Q2",
  "sample_size": 14,
  "median_price_usd": 385000,
  "p25_price_usd": 320000,
  "p75_price_usd": 445000,
  "median_price_per_sqm_usd": 3200,
  "trend_vs_prev_quarter_pct": -2.3,
  "confidence": "medium",
  "data_source": "internal_sold_records_verified_and_self_reported"
}
```

Rules:
- Sample size < 5 → return 404 (insufficient data)
- Sample size 5–11 → confidence `low`, no trend %
- Sample size 12–24 → confidence `medium`
- Sample size ≥ 25 → confidence `high`
- Rentals in a separate namespace (`&transaction_type=rent`)
- Cache 1 hour per query key
- Rate-limited: 60 rpm per IP

Feeds into 029c's locality-first UX: browsing a neighborhood shows "here's what apartments actually sold for this quarter" not just "here's what people are asking."

## Admin correction workflow

Sold records are immutable once written. Corrections create a new record and mark the old as superseded:

```
POST /api/agent/properties/:id/sold-record/correct
{
  new_data: { ...full sold_record payload },
  correction_reason: "Wrong buyer selected — actual buyer was inquiry Y not X"
}
→ 201
{
  new_record: {...},
  superseded_record_id: "..."
}
```

Server:
1. Load the current active sold_record for the property
2. Set `verification_status = 'superseded'`, `superseded_by_id = new_record_id`
3. Insert new record with `supersedes_id = old_record_id`, `verification_status = 'self_reported'`
4. Insert `property_status_history` audit row noting the correction

Corrections require:
- Agent who recorded the original, OR
- Tenant admin of the tenant that owns the property, OR
- Platform admin

Corrections are visible in the property's sold-record history endpoint. Attribution analytics use the newest active record only.

## Verification workflow

Platform admin (or tenant admin, per configuration) can move a record from `self_reported` → `verified` by reviewing supporting documents:

```
POST /api/admin/sold-records/:id/verify
{
  verification_notes: "Sale contract PDF attached; matches record"
}
→ 200 { record with verification_status='verified' }
```

Verification raises the record's comparable-tier reliability from 0.9 to 1.0. Verifier and timestamp are stamped on the record.

Optional supporting document upload happens at record time and is stored in the same tenant asset store used elsewhere (or ticket-032-scoped as future work: signed document uploads with independent hash chain).

## Access control matrix

| Role | Read own sold_records | Read tenant's sold_records | Read all sold_records | Create | Correct own | Correct any | Verify | Read aggregate benchmarks |
|---|---|---|---|---|---|---|---|---|
| Anonymous | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Agent | ✅ | ❌ | ❌ | ✅ (for own properties) | ✅ | ❌ | ❌ | ✅ |
| Tenant admin | ✅ | ✅ (their tenant) | ❌ | ✅ (for tenant properties) | ✅ | ✅ (tenant) | Optional | ✅ |
| Platform admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Attribution details (which contact was the winning buyer) are visible only to Agent + Tenant admin + Platform admin. Public benchmarks strip all attribution.

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/properties/:id/status` | agent | Transition property status; requires `sold_record_payload` when transitioning to sold/rented |
| `GET` | `/api/properties/:id/sold-record` | agent/tenant admin | Read the active sold_record for a property |
| `GET` | `/api/properties/:id/sold-record/history` | agent/tenant admin | Read full correction chain |
| `POST` | `/api/agent/properties/:id/sold-record/correct` | recording agent | Create correction |
| `GET` | `/api/agent/properties/:id/eligible-inquiries` | agent | Picklist for the attribution dropdown (inquiries scoped to this property) |
| `POST` | `/api/admin/sold-records/:id/verify` | platform admin | Mark verified |
| `GET` | `/api/admin/sold-records` | platform admin | Search / filter (by agent, tenant, date range, status) |
| `GET` | `/api/pricing/benchmarks` | none (public) | Aggregated market benchmarks |
| `GET` | `/api/agent/attribution-analytics` | agent | Agent's own sold-record analytics |
| `GET` | `/api/agency/attribution-analytics` | tenant admin | Tenant-wide analytics |

## Attribution analytics

Agent dashboard endpoints:

```
GET /api/agent/attribution-analytics?period=last_90_days
→ 200
{
  "total_sold_records": 8,
  "buyer_from_platform_count": 5,
  "buyer_from_platform_rate_pct": 62.5,
  "total_sold_value_usd": 3200000,
  "platform_sourced_sold_value_usd": 2100000,
  "platform_sourced_sold_value_pct": 65.6,
  "by_channel": {
    "whatsapp": {"count": 3, "value_usd": 1400000},
    "instagram_dm": {"count": 1, "value_usd": 400000},
    "portal": {"count": 1, "value_usd": 300000}
  },
  "by_utm_campaign": {
    "batroun_summer_2026": {"count": 2, "value_usd": 900000},
    "achrafieh_autumn_2026": {"count": 1, "value_usd": 450000}
  },
  "avg_days_first_touch_to_sold": 47,
  "median_days_first_touch_to_sold": 38
}
```

`by_utm_campaign` is the commercial proof-of-value that closes the loop from ad spend → attribution → conversion. Marketing spend becomes measurable.

## Files touched

**Backend:**
- New: `backend/src/persistence/migrations/032_property_sold_price_registry.sql`
- New: `backend/scripts/pre-migration-032-check.js` — enumerate non-canonical `properties.status` values before CHECK enforcement
- New: `backend/src/properties/status.js` — `PropertyStatus` enum, `transitions` map, `canTransition`
- New: `backend/src/properties/status-service.js` — `transitionPropertyStatus` orchestrator
- New: `backend/src/services/sold-record-service.js` — creation, correction, verification, attribution inheritance
- `backend/src/modules/market-pricing/application/comparable-service.js` — extend `findAgentReportCandidates` to include `property_sold_records`
- `backend/src/modules/market-pricing/application/analysis-service.js` — new `comparableType` value `internal_sold`; time-weight coefficients for sold records
- `backend/src/modules/market-pricing/application/trend-service.js` — augment quarterly snapshots to include sold_records as a primary source (weighted higher than listings)
- New: `backend/src/services/benchmarks-service.js` — public benchmark aggregation with sample-size gates
- New: `backend/src/services/attribution-analytics-service.js` — per-agent and per-tenant analytics rollup
- `backend/src/server.js` — new routes; refactor `PATCH /api/properties/:id` and `POST /api/properties/:id/status` through `transitionPropertyStatus`
- `backend/src/lib/validation.js` — `soldRecordCreateSchema`, `soldRecordCorrectSchema`, `propertyStatusTransitionSchema`
- `backend/src/persistence/table-mapper.js` — register `property_sold_records`, `property_status_history`
- `backend/src/campaigns.js` — on sold_record insert with `buyer_from_platform=true`, emit `sale.attributed` event for future automation
- `backend/src/analytics/crm.js` — new metrics: platform-sourced sale rate, first-touch-to-sold time

**Frontend (to be verified after frontend read):**
- Property card: "Mark as sold" button opens Sold modal (see below)
- Sold modal component: form with pricing-context banner, price/date/currency inputs, buyer-from-platform radio, conditional inquiry dropdown or external-source picklist, optional document upload
- Property detail: display sold badge + summary when status=sold
- Agent dashboard: attribution analytics tile
- Public listing pages: benchmark widget on neighborhood pages ("sold prices this quarter")
- Admin panel: sold-records queue with verify/reject actions

## Frontend modal spec

**Trigger:** agent clicks "Mark as sold" on their property.

**Modal layout:**

1. **Header:** "Record sale — [property title]"
2. **Pricing context banner** (calls `pricing/analysis` for the property):
   > "You listed at $450,000. Market median for similar 3-bed apartments in Achrafieh was $385,000 (14 recent sales). Recording sale at $Z will be shown as N% above/below/at market."
3. **Fields:**
   - Sold price + currency (default: listing price/currency)
   - Sold date (default: today; must be ≤ today and ≥ property listed_date)
   - Transaction type toggle: Sale / Rent (if Rent → rent_period picker appears)
   - **"Did the buyer come from the platform?" Yes / No radio (required, no default)**
     - If **Yes**: dropdown of inquiries for this property, showing `contact.name · first_touch_channel · created_at`. Sorted newest first. Include "Other contact from platform — search" fallback with typeahead against all contacts with any inquiry on any of the agent's properties
     - If **No**: picklist of external_source_type
   - Attribution notes (optional textarea)
   - Attach supporting document (optional; enables faster admin verification)
4. **Footer:**
   - Cancel button
   - "Record sale and mark sold" primary button — disabled until all required fields valid

**On submit:**
1. POST `/api/properties/:id/status` with `{to_status: 'sold', sold_record_payload: {...}}`
2. Success → confirmation modal: "Sale recorded. This contributes to platform benchmarking for [neighborhood name]. Anonymized aggregate data is used only after 5+ sales per neighborhood/type/bedroom cohort."
3. Refresh property card to show sold badge

**On error (409 — sold record already exists):** show correction path with reason field.

## Testing

- Cannot create two active sold records for the same property (unique partial index)
- Correction workflow: old record becomes `superseded`, new record active, unique index still holds
- Attribution inheritance: after record, editing inquiry.source_ref does NOT change sold_record.attributed_source_ref
- Attribution constraint: `buyer_from_platform=true` without `attributed_inquiry_id` rejected by CHECK
- Signature binding: sold_record.property_signature_id = latest property_signatures.id at record time; if no signature exists, NULL with reason logged
- Inquiry synchronization: recording sold with attributed_inquiry_id transitions the inquiry to stage='won' atomically
- Pricing integration: sold record appears as internal_sold in findComparables output; higher weight than external_agent_report
- Benchmarks: sample_size<5 returns 404; sample_size=6 returns confidence=low without trend
- Currency snapshot: sold_price_normalized_usd computed once, doesn't shift when USD/LBP rate later changes
- Migration idempotency: run twice, backfill produces same synthetic records
- Status transition guard: PATCH property status='sold' without sold_record_payload → 400
- Access control: agent-B cannot read agent-A's sold_records

## Rollout

1. Ship migration + `SOLD_PRICE_REGISTRY_ENABLED=false`. Backfill existing `status='sold'` properties with synthetic migrated records.
2. Enable for platform admins only. Test end-to-end with test properties.
3. Enable for a pilot agency (2–3 agents). Monitor error rate on 409 (already-recorded).
4. Full rollout to all agents.
5. Enable public benchmarks endpoint once first-party sold record count per (BLC, property_type, bedrooms) exceeds threshold in any cohort. Start with major neighborhoods only.
6. Ongoing: weekly report to agents ("your platform-sourced sale rate this quarter: N%; median first-touch-to-sold: X days").

Rollback: flip flag off → sold-record creation blocked, property status transitions to `sold`/`rented` return 400. Existing records stay queryable but no new ones. Schema remains.

## Success metrics (90 days post-launch)

- ≥ 95% of `status='sold'` transitions produce a sold_record (should be 100% after guard enforcement; the tail is admin overrides)
- Median `buyer_from_platform=true` rate across agents (target: > 30% as the north-star metric)
- ≥ 25% of sold_records verified within 30 days of recording
- Pricing benchmarks endpoint answers ≥ 100 unique (BLC, type, bedrooms) queries per week without 404
- Median-sold vs median-listed delta per BLC becomes a trusted number in trend dashboards
- Zero silent property status transitions bypassing the sold_record requirement (audit weekly)

## Interactions with other tickets

- **029a (attribution):** sold_record.attributed_source_ref is the frozen snapshot of the inquiry's source_ref at record time. This is the loop closure — UTM package captured months earlier is preserved on the sale.
- **029b (PKI):** sold_record.property_signature_id binds to the signed listing version. Auditor can prove what the price was in the listing at sale time.
- **029c (BLC):** sold_record.locality_blc is the aggregation key for public benchmarks and for pricing intelligence stratification.
- **030 (inquiry stage guards):** recording sold transitions the attributed inquiry to `stage='won'` atomically in the same transaction — one place, one truth.
- **Existing `agent_price_reports`:** unchanged. Still used for external sales the agent knows about but did not participate in. Public benchmark endpoint may optionally include verified agent_price_reports as a supplementary source when first-party sample is small — configurable.

## Out of scope for this ticket

- **Buyer opt-in for identity disclosure in benchmarks.** Sold records currently never expose buyer identity publicly. A future ticket may add opt-in "verified buyer testimonial" surfacing for agents' portfolio pages.
- **Rent renewal tracking.** Rent records capture the initial contract only. Renewals, rent escalations, and lease terminations are a separate future scope.
- **Cross-listing sold detection.** A property listed by 3 different agents (rare) closes once but might trigger 3 sold record attempts. Handled by the unique-per-property-active constraint — first record wins; duplicates return 409 with instructions to contact platform admin for cross-listing reconciliation.
- **Third-party sold data ingestion.** Registry authorities publishing sold data via API — deferred to a future integrations ticket.
- **Immutable/blockchain anchoring of sold records.** Deferred to 029b Phase 2 (same infrastructure once it exists).
