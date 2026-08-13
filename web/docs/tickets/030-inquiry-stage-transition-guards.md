# Ticket 030 — Inquiry stage transition guards

**Status:** Approved for build
**Independent of:** 029 (can land in parallel)
**Blocks:** trustworthy CRM funnel analytics; automation triggers on stage entry/exit

## Problem

`inquiries.status` and `inquiries.stage` are free-form TEXT columns (migration 004:38-39). Nothing in the code prevents any caller from writing any value. Consequences:

- Free-text drift: `status='new'`, `status='New'`, `status='NEW'`, `status='open'` all coexist. Analytics grouping is unreliable.
- Illegal transitions succeed silently: a closed inquiry can be reopened by a stale UI, a won opportunity can be pushed back to prospecting, and there's no runtime record of why.
- No canonical enumeration of stages exists in code — every route file uses its own strings.
- Automation cannot reliably fire on stage entry ("send follow-up when stage moves to `qualified`") because it can't trust that `qualified` is the canonical label.

Contrast with two places in the codebase where the pattern is done right:

- `backend/src/modules/whatsapp-listings/domain/state.js` — `transitions` map + `canTransition(from, to)` + `transition(session, to)` that throws on invalid moves
- `backend/src/tenant-authorization.js` — guardrails on role×affiliation combinations (guest→non_exclusive only, admin→exclusive|personal only)

Both have proven to catch real bugs early. Inquiries deserve the same rigor.

## Design

Port the whatsapp-listings pattern to inquiries. Add a canonical stage enumeration, an explicit transition map, a `canTransition`/`transition` pair, and enforce them at every write site.

### Canonical stages

Chosen to align with real estate CRM practice and existing text values I observed in code:

| Stage | Meaning | Terminal? |
|---|---|---|
| `new` | Inbound just received, not yet reviewed by an agent | No |
| `contacted` | Agent has responded (any outbound sent) | No |
| `qualified` | Agent confirmed real intent, budget, timeline | No |
| `nurturing` | Longer-cycle lead, waiting for market/timing | No |
| `viewing_scheduled` | At least one viewing on calendar | No |
| `viewing_completed` | Viewing happened, outcome recorded | No |
| `negotiating` | Offer/counter-offer discussion active | No |
| `won` | Sale/lease closed — terminal | Yes |
| `lost` | Explicitly disqualified — terminal | Yes |
| `duplicate` | Merged into another inquiry — terminal | Yes |
| `spam` | Not a real lead — terminal | Yes |

Non-stage state (kept as separate fields):
- `status` — becomes derived from stage (open | closed) and no longer independently mutable
- `priority` — orthogonal to stage
- `contact_mode` — orthogonal to stage

### Transitions

```js
export const InquiryStage = {
  NEW: 'new',
  CONTACTED: 'contacted',
  QUALIFIED: 'qualified',
  NURTURING: 'nurturing',
  VIEWING_SCHEDULED: 'viewing_scheduled',
  VIEWING_COMPLETED: 'viewing_completed',
  NEGOTIATING: 'negotiating',
  WON: 'won',
  LOST: 'lost',
  DUPLICATE: 'duplicate',
  SPAM: 'spam',
}

export const transitions = {
  [InquiryStage.NEW]: [
    InquiryStage.CONTACTED,
    InquiryStage.QUALIFIED,        // fast-path when first contact already qualifies
    InquiryStage.LOST,             // triaged as unqualified without ever contacting
    InquiryStage.DUPLICATE,
    InquiryStage.SPAM,
  ],
  [InquiryStage.CONTACTED]: [
    InquiryStage.QUALIFIED,
    InquiryStage.NURTURING,
    InquiryStage.VIEWING_SCHEDULED,
    InquiryStage.LOST,
    InquiryStage.DUPLICATE,
  ],
  [InquiryStage.QUALIFIED]: [
    InquiryStage.NURTURING,
    InquiryStage.VIEWING_SCHEDULED,
    InquiryStage.NEGOTIATING,      // rare but valid: qualified buyer skips viewing
    InquiryStage.LOST,
  ],
  [InquiryStage.NURTURING]: [
    InquiryStage.QUALIFIED,        // re-engaged
    InquiryStage.VIEWING_SCHEDULED,
    InquiryStage.LOST,
  ],
  [InquiryStage.VIEWING_SCHEDULED]: [
    InquiryStage.VIEWING_COMPLETED,
    InquiryStage.QUALIFIED,        // rescheduled to indefinite → drop back
    InquiryStage.LOST,
  ],
  [InquiryStage.VIEWING_COMPLETED]: [
    InquiryStage.NEGOTIATING,
    InquiryStage.VIEWING_SCHEDULED, // second viewing scheduled
    InquiryStage.NURTURING,         // "thanks, we'll think about it"
    InquiryStage.LOST,
  ],
  [InquiryStage.NEGOTIATING]: [
    InquiryStage.WON,
    InquiryStage.LOST,
    InquiryStage.VIEWING_SCHEDULED, // additional viewing during negotiation
  ],
  [InquiryStage.WON]: [],            // terminal — sold-price registry hook fires here
  [InquiryStage.LOST]: [
    InquiryStage.NURTURING,          // recycled from drip campaign
  ],
  [InquiryStage.DUPLICATE]: [],      // terminal
  [InquiryStage.SPAM]: [],           // terminal
}

export function canTransition(from, to) {
  const allowed = transitions[from] || []
  return allowed.includes(to)
}
```

**Note on `lost → nurturing`**: intentional. `lost` with `lost_reason='timing'` should be revivable when the campaign scheduler pulls the contact back into a drip.

### Won-reason and lost-reason enums

Replaces free-text `lost_reason` on `opportunities` and eliminates the current asymmetry (no `won_reason`).

```
LostReason = {
  PRICE_TOO_HIGH: 'price_too_high',
  PRICE_TOO_LOW: 'price_too_low',            // seller-side lost
  WRONG_FIT: 'wrong_fit',
  TIMING: 'timing',
  NO_RESPONSE_CONTACT: 'no_response_contact',
  NO_RESPONSE_AGENT: 'no_response_agent',
  CHOSE_COMPETITOR: 'chose_competitor',
  PROPERTY_UNAVAILABLE: 'property_unavailable',
  OTHER: 'other',
}

WonReason = {
  BEST_FIT: 'best_fit',
  BEST_PRICE: 'best_price',
  AGENT_RELATIONSHIP: 'agent_relationship',
  URGENCY: 'urgency',
  LOCATION: 'location',
  OTHER: 'other',
}
```

Both stored on the inquiry (and mirrored to opportunity if one exists) when transitioning to WON or LOST.

## Data model changes

### `inquiries` — schema tightening

```sql
-- Add CHECK constraint for stage enum
ALTER TABLE inquiries
  DROP CONSTRAINT IF EXISTS inquiries_stage_check;
ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_stage_check
  CHECK (stage IS NULL OR stage IN (
    'new','contacted','qualified','nurturing',
    'viewing_scheduled','viewing_completed',
    'negotiating','won','lost','duplicate','spam'
  ));

-- Add stage transition history table
CREATE TABLE IF NOT EXISTS inquiry_stage_history (
  id TEXT PRIMARY KEY,
  inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,                          -- won_reason / lost_reason / notes
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_inquiry_stage_history_inquiry
  ON inquiry_stage_history(inquiry_id, changed_at DESC);

-- Add won_reason / lost_reason typed columns
ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS won_reason TEXT,
  ADD COLUMN IF NOT EXISTS lost_reason TEXT;

ALTER TABLE inquiries
  DROP CONSTRAINT IF EXISTS inquiries_won_reason_check;
ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_won_reason_check
  CHECK (won_reason IS NULL OR won_reason IN (
    'best_fit','best_price','agent_relationship','urgency','location','other'
  ));

ALTER TABLE inquiries
  DROP CONSTRAINT IF EXISTS inquiries_lost_reason_check;
ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_lost_reason_check
  CHECK (lost_reason IS NULL OR lost_reason IN (
    'price_too_high','price_too_low','wrong_fit','timing',
    'no_response_contact','no_response_agent',
    'chose_competitor','property_unavailable','other'
  ));

-- Terminal-stage requires a reason
ALTER TABLE inquiries
  DROP CONSTRAINT IF EXISTS inquiries_terminal_reason_check;
ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_terminal_reason_check
  CHECK (
    (stage = 'won' AND won_reason IS NOT NULL) OR
    (stage = 'lost' AND lost_reason IS NOT NULL) OR
    stage NOT IN ('won', 'lost') OR
    stage IS NULL
  );
```

Legacy stage-value cleanup (before CHECK constraint applies):

```sql
-- Normalize known variants to canonical
UPDATE inquiries SET stage = 'new' WHERE lower(stage) IN ('new','open');
UPDATE inquiries SET stage = 'contacted' WHERE lower(stage) IN ('contacted','reached');
UPDATE inquiries SET stage = 'qualified' WHERE lower(stage) IN ('qualified','q');
-- ... etc
-- Anything not in the enum after normalization: set to NULL and log for manual review
UPDATE inquiries SET stage = NULL
  WHERE stage IS NOT NULL AND stage NOT IN (
    'new','contacted','qualified','nurturing',
    'viewing_scheduled','viewing_completed',
    'negotiating','won','lost','duplicate','spam'
  );
```

The pre-migration hygiene script (`backend/scripts/pre-migration-030-check.js` — new) surfaces every non-canonical stage value before running the migration, in the same style as `pre-migration-027-028-check.js`.

## Code changes

### New file: `backend/src/inquiries/state.js`

Exports `InquiryStage`, `transitions`, `canTransition`, `transition` — modeled directly on `backend/src/modules/whatsapp-listings/domain/state.js`.

### New file: `backend/src/inquiries/service.js`

```js
export async function transitionInquiryStage(inquiryId, toStage, { actorId, reason, wonReason, lostReason }) {
  const inquiry = await findOne('inquiries', i => i.id === inquiryId)
  if (!inquiry) throw notFound('Inquiry not found')

  const fromStage = inquiry.stage
  if (!canTransition(fromStage, toStage)) {
    throw invalidTransition(`Cannot transition inquiry from ${fromStage} to ${toStage}`)
  }

  if (toStage === InquiryStage.WON && !wonReason) {
    throw validationError('won_reason is required to transition to won')
  }
  if (toStage === InquiryStage.LOST && !lostReason) {
    throw validationError('lost_reason is required to transition to lost')
  }

  await transaction(async () => {
    await update('inquiries', i => i.id === inquiryId, i => ({
      ...i,
      stage: toStage,
      won_reason: wonReason || i.won_reason,
      lost_reason: lostReason || i.lost_reason,
      status: TERMINAL_STAGES.has(toStage) ? 'closed' : 'open',
      updated_at: new Date().toISOString(),
    }))

    await insert('inquiry_stage_history', {
      id: uuidv4(),
      inquiry_id: inquiryId,
      from_stage: fromStage,
      to_stage: toStage,
      changed_by: actorId,
      reason: reason || null,
      changed_at: new Date().toISOString(),
      data: { won_reason: wonReason, lost_reason: lostReason },
    })
  })

  return await findOne('inquiries', i => i.id === inquiryId)
}
```

### Refactor sites in `server.js`

I did not enumerate every stage-writing site during the code read (~13 sites suspected across `/api/inquiries/*`, campaign automation, viewing-created hook, opportunity-advance hook). The refactor:

1. Grep for `stage:` and `stage =` across `backend/src/**` (excluding modules that don't touch inquiries)
2. Replace every direct `update('inquiries', ..., { stage: X })` call with `transitionInquiryStage(id, X, {...})`
3. Any caller that cannot supply `actorId` (e.g., automation) uses a synthetic `system:<automation_name>` actor ID
4. Endpoints that returned 200 for invalid stage writes now return 409 with `{error: 'invalid_transition', from, to, allowed}`

### Validation

`lib/validation.js:inquiryUpdateSchema` becomes stage-aware:

```js
stage: z.enum([
  'new','contacted','qualified','nurturing',
  'viewing_scheduled','viewing_completed',
  'negotiating','won','lost','duplicate','spam'
]).optional(),
won_reason: z.enum([...]).optional(),
lost_reason: z.enum([...]).optional(),
```

Server handler routes stage updates through `transitionInquiryStage` instead of the raw update path.

### Automation hooks

Once transitions are enforced, add stage-entry event emission for automation:

- `inquiry.stage_entered.qualified` — triggers welcome-nurture drip
- `inquiry.stage_entered.viewing_scheduled` — triggers viewing-reminder chain
- `inquiry.stage_entered.won` — **triggers sold-price registry prompt on the associated property** (integration point with the future ticket 031)
- `inquiry.stage_entered.lost` — triggers drip based on lost_reason (`timing` → 90-day re-engage; `wrong_fit` → new-inventory alert on updated preferences)

Emission goes through the existing `activity_log` insert pattern for now; migrating to an event bus is out of scope.

## API changes

| Method | Path | Change |
|---|---|---|
| `PATCH` | `/api/inquiries/:id` | If `stage` in body, route through `transitionInquiryStage`; return 409 on invalid |
| `POST` | `/api/inquiries/:id/transition` | New: dedicated stage-transition endpoint with mandatory `to_stage`, optional reason/won_reason/lost_reason |
| `GET` | `/api/inquiries/:id/stage-history` | New: returns full transition history for the inquiry |

## Files touched

- `backend/src/persistence/migrations/030_inquiry_stage_transitions.sql` (new)
- `backend/scripts/pre-migration-030-check.js` (new — hygiene script)
- `backend/src/inquiries/state.js` (new)
- `backend/src/inquiries/service.js` (new)
- `backend/src/lib/validation.js` — inquiry stage/reason enums
- `backend/src/server.js` — ~13 stage-write sites refactored; new `/transition` and `/stage-history` routes
- `backend/src/campaigns.js` — automation triggers listen for `inquiry.stage_entered.*`
- `backend/src/persistence/table-mapper.js` — register `inquiry_stage_history`
- `backend/src/opportunities.js` — mirror `won_reason` / `lost_reason` from inquiry to opportunity when transitioning
- `backend/src/tasks.js` — auto-close open follow-up tasks when inquiry transitions to a terminal stage

## Testing

- `state.test.js` — canTransition matrix, transition() throws on invalid, terminal-stage constraint
- `service.test.js` — transitionInquiryStage happy path, invalid transition rejection, missing-reason rejection, history row insertion
- Integration: PATCH with invalid stage returns 409; POST /transition with valid arg returns 200; stage-history query returns ordered
- Migration idempotency: run twice, constraints hold
- Legacy-value cleanup: seed 5 non-canonical values, run migration script, assert canonical after
- Automation: fake inquiry transitions to qualified → drip campaign was scheduled

## Rollout

1. Pre-migration hygiene: run `pre-migration-030-check.js` against production copy. Manually reconcile any non-canonical stage values that the automatic normalizer can't map. Repeat until clean.
2. Deploy code (still uses old direct writes — feature flag `INQUIRY_STAGE_GUARDS_ENABLED=false`).
3. Run migration in production. CHECK constraints now hold, but new code paths are inactive.
4. Flip `INQUIRY_STAGE_GUARDS_ENABLED=true`. All new stage writes go through `transitionInquiryStage`. Illegal transitions return 409.
5. Monitor 409 rate for 1 week — spikes indicate a caller wasn't refactored. Fix and redeploy.
6. Delete legacy direct-write paths after 30 days of clean 409 telemetry.

Rollback: flip flag off — new writes revert to legacy path. Schema constraints remain (they're not blocking, they're canonicalizing).

## Success metrics (30 days post-launch)

- 0 stage values outside the canonical enum in production
- 100% of stage changes have a matching `inquiry_stage_history` row
- Weekly funnel analytics query returns clean stage groupings without post-processing normalization
- Automation triggers fire reliably on stage entry (audit: campaign schedules match stage-entered events 1:1)
- Zero silent illegal transitions (all rejected at 409)

## Out of scope

- Redesigning the opportunity stage model (opportunities have their own separate stage machine — this ticket does not touch them; a symmetric ticket for opportunities is future work)
- Building the drip campaign templates that will consume the new stage-entered events (existing `campaigns.js` scheduler is enough)
- UI redesign of the inquiry detail page to surface stage-history (backend endpoint delivered; UI is a separate ticket)
