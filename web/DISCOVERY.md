# Area Intelligence Engine + Market Pricing Intelligence — Discovery Report

**Date:** 2026-08-07  
**Auditor:** Kimi Code  
**Scope:** Verify platform architecture before implementing both modules. Based on 100% line reads of referenced files and both spec documents.  
**Build Order:** Area Intelligence Engine first; Market Pricing Intelligence second (depends on `area_profiles`).

---

## 0. User Decisions / Answers to Open Questions

| Question | Decision | Implication |
|----------|----------|---------------|
| Map library | Google Maps JS API, install `@googlemaps/js-api-loader` | Frontend dependency; all maps use Google Maps. |
| Google API credentials | Env var `GOOGLE_MAPS_API_KEY`; budget cap $500/month; log all usage | Cost-control + audit logging required. |
| Field inspector role | Reuse `agent` role; add `inspector_assignments` table | No new auth role; assignments link agents to areas. |
| Seed example areas | Yes — Batroun and Mar Mikhael | Seed in migration and/or `seedData()`. |
| Arabic fields | Required — `name_ar`, `summary_ar` must be present | Schema + UI must enforce or strongly require these. |
| AI default provider | Reuse Gemini from WhatsApp module | Extend existing adapter; no duplicate AI code. |
| `robots.txt` | Create now with Area Intelligence spec rules | New `public/robots.txt` file. |
| Score/price visibility | Public to unauthenticated visitors | Public endpoints; admin panels restricted. |
| WhatsApp AI adapter reuse | Reuse and extend; do not duplicate | Import from `backend/src/modules/whatsapp-listings/infrastructure/ai/`. |

---

## 1. Verified Facts

### 1.1 Runtime & Package Management

| Fact | Verified Value | Evidence |
|------|----------------|----------|
| Runtime | Node.js (no `engines` field in `package.json`) | `package.json` does **not** contain an `engines` field. Spec claims "Node.js 22" but it is not enforced. |
| Package manager | npm | `package-lock.json` present; `postinstall` runs `cd backend && npm install`. |
| Module system | ESM (`"type": "module"`) | `package.json` line 5. |
| Frontend build | Vite + TypeScript + React | `package.json` scripts `dev`, `build`, `typecheck`; deps include `vite`, `react`, `typescript`. |

### 1.2 Backend Framework & Routing

| Fact | Verified Value | Evidence |
|------|----------------|----------|
| Framework | Express with ESM imports | `backend/src/server.js` lines 1–12 import Express and register routes via `app.get/post/put/delete`. |
| Route prefix | `/api/*` | Every backend endpoint uses `/api/...` (`server.js:341`, `:356`, `:5682`). |
| Auth middleware | JWT Bearer token + `authMiddleware` | `backend/src/auth.js` exports `authMiddleware`, used throughout `server.js`. |
| Rate limiting | `express-rate-limit` | `server.js:9`, `server.js:341-343`. |
| Validation | Zod via `validate()` / `validateQuery()` | `backend/src/lib/validation.js` exports `validate`, `validateQuery`, and many schemas. |

### 1.3 Database & Persistence (CRITICAL STALENESS FOUND)

| Spec Claim | Verified Reality | Evidence |
|------------|------------------|----------|
| SQLite via `better-sqlite3` | **FALSE.** Postgres is the sole primary database. | `backend/src/db.js` is a barrel re-exporting `backend/src/persistence/index.js`, which is an async-only Postgres DAL. |
| No ORM / migrations, lazy schema in `loadDb()` / `seed.js` | **FALSE.** Ordered SQL migrations exist and run on startup. | `backend/src/persistence/migrations/*.sql` (001–022), `backend/src/persistence/migrations/runner.js` uses `schema_migrations` table + `pg_advisory_xact_lock`. |
| `better-sqlite3` still in deps | TRUE, but it is no longer used in the runtime primary path. It only remains as a legacy dependency and in `scripts/backfill/`. | `package.json:37`; `backend/scripts/backfill/sqlite-adapter.js` is the renamed former adapter. |

Current persistence contract:

```js
// backend/src/db.js
export { findAll, findOne, insert, update, remove, transaction, loadDb, getDb, closeDb } from './persistence/index.js'
```

All persistence operations are **async** and return Promises. Any code using them must `await`.

### 1.4 How New Tables Are Added

1. Create a numbered SQL file in `backend/src/persistence/migrations/` (e.g., `023_area_intelligence.sql`, `024_market_pricing.sql`).
2. Add the collection → table mapping to `backend/src/persistence/table-mapper.js`.
3. Migrations run automatically on startup via `loadDb()` → `runMigrations()`.
4. For module isolation, prefer a dedicated Postgres schema (e.g., `area_intelligence.*` or `market_pricing.*`) like the WhatsApp module does (`wa_listings.*`).

### 1.5 Workers

| Fact | Verified Value | Evidence |
|------|----------------|----------|
| Pattern | `setInterval` inside `startServer` | `server.js:5702`, `:5733`, `:5763`, `:5791`. |
| Existing workers | distribution retry, consumer automation, notification retry, campaign scheduler | `server.js:5700-5815`. |
| New module worker registration | Module exposes `registerWorker()`; called in `server.js` if module enabled | WhatsApp module pattern in `backend/src/modules/whatsapp-listings/index.js:60-62` and `server.js:381-383`. |

### 1.6 Media Uploads

| Fact | Verified Value | Evidence |
|------|----------------|----------|
| Storage | `multer` disk storage to `backend/uploads/` | `server.js:356-372`. |
| Public URL | `/uploads/:filename` served statically | `server.js:358`. |
| Endpoint | `POST /api/uploads` (auth required) | `server.js:386-401`. |
| Allowed types | image/video only | `server.js:370-371`. |

### 1.7 Logging

| Fact | Verified Value | Evidence |
|------|----------------|----------|
| Library | `pino` | `backend/src/lib/logger.js`. |
| Default level | `debug` in dev, `info` in prod | `logger.js:4`. |

### 1.8 Auth & Roles

| Middleware | Role Required | Evidence |
|------------|---------------|----------|
| `authMiddleware` | Valid JWT | `backend/src/auth.js:38-67`. |
| `requireAdmin` | `admin` or `platform_admin` | `server.js:466-476`. |
| `requirePlatformAdmin` | `platform_admin` only | `server.js:479-485`. |
| `requireAnyAgencyRole` | `req.agencyId` set (agency member) | `server.js:453-460`. |

Agent roles observed in code: `agent`, `admin`, `platform_admin`.

### 1.9 Frontend Architecture

| Fact | Verified Value | Evidence |
|------|----------------|----------|
| Router | React Router DOM v6 | `src/main.tsx:3`, `src/App.tsx:1`, `BrowserRouter`, `Routes`, `Route`. |
| Styling | Tailwind CSS + custom design tokens | `src/index.css:1-76`. |
| Components | shadcn/ui-style primitives in `src/components/ui/` | `button.tsx`, `card.tsx`, `tabs.tsx`, `badge.tsx`, `input.tsx`, `label.tsx`, `separator.tsx`, `avatar.tsx`, `dropdown-menu.tsx`, `toast.tsx`. |
| Icons | Lucide React | `src/pages/PropertyDetailPage.tsx:3`, many others. |
| State | React Context for auth/favorites/toast | `src/App.tsx:97-104`. |
| API client | `src/api/client.ts` — typed fetch wrapper | `src/api/client.ts`. |

### 1.10 Map Integration

| Spec Question | Answer | Evidence |
|---------------|--------|----------|
| Does any map library exist? | **No.** No Google Maps, Mapbox, or Leaflet dependency or import found. | Search of `src/` and `package.json` for `react-google-maps`, `mapbox-gl`, `react-map-gl`, `leaflet`, `@react-google-maps/api` returned zero matches. |
| Existing geographic data | Properties have `city`, `neighborhood`, `location`, `latitude`, `longitude` columns, plus a `territories` table. | `backend/src/persistence/table-mapper.js` (`properties`, `territories`); `validation.js:105-110`. |

### 1.11 Social / Signal Ingestion Patterns

| File | Reusable Pattern |
|------|------------------|
| `backend/src/lib/notifications/instagram.js` | Dev/live provider switch via env (`INSTAGRAM_PROVIDER=dev`), fetch-based Meta Graph calls, simulated response objects when credentials missing. |
| `backend/src/whatsapp.js` | `getWhatsAppConfig()`, `isWhatsAppConfigured()`, health check that hits live API, normalized error handling. |
| `backend/src/lib/notifications/sms.js` | Twilio fallback patterns. |

### 1.12 Module Architecture (Critical for Reuse)

The WhatsApp Listing Module is the blueprint to follow:

```
backend/src/modules/whatsapp-listings/
  index.js              # createModule({ platformAdapter })
  platform-adapter.js   # DefaultPlatformAdapter — only file touching core platform
  application/          # use cases: pipeline, entitlements, credits, webhook, intent, matcher
  domain/               # state machine, types
  infrastructure/       # DB, queue, AI adapters, storage, templates
  interface/            # admin-routes.js, agency-routes.js, agent-routes.js
  tests/
  config.js
  logger.js
  README.md
```

Module registration in `server.js`:

```js
const whatsAppListingsModule = createWhatsAppListingsModule({ platformAdapter: null })
if (whatsAppListingsModule.enabled) {
  await whatsAppListingsModule.registerRoutes(app)
  await whatsAppListingsModule.registerWorker()
}
```

### 1.13 AI Provider Abstraction

A reusable, multi-provider AI adapter already exists in the WhatsApp module:

```
backend/src/modules/whatsapp-listings/infrastructure/ai/
  adapter.js        # createAiAdapter with circuit breaker, fallback chain
  shared.js         # prompt builders, safe JSON parse
  providers/
    openai.js
    gemini.js       # default provider
    claude.js
    deepseek.js
    qwen.js
    kimi.js
```

This can be extracted to a shared location or imported by both new modules. It is fetch-based and provider-agnostic.

### 1.14 Existing Area / Location / City / Neighborhood Tables

**No dedicated area intelligence tables exist.** The platform has:

- `territories` — high-level country/territory records (e.g., Lebanon).
- `properties` — has `city`, `neighborhood`, `location`, `latitude`, `longitude`, but these are per-listing free-text/strings.
- No `area_profiles`, `score_dimensions`, `source_types`, `area_signals`, or related tables.

### 1.15 Existing Pricing / Comparable Tables

**No market pricing intelligence tables exist.** The platform has:

- `properties` — price, price_unit, bedrooms, bathrooms, area, area_unit, property_type, city, neighborhood, latitude, longitude.
- `price_history` — tracks price changes per property.
- No `pricing_match_configs`, `property_price_analyses`, `external_comparables`, `price_trend_snapshots`, or `currency_rates` tables.

### 1.16 Currency Handling

The platform currently stores `price` and `price_unit` on properties. There is no currency normalization or parallel market rate table. Market Pricing must introduce this from scratch.

---

## 2. Discovered Facts

1. **Postgres cutover is complete and live.** Both specs' SQLite architecture sections are outdated. All new modules must use the Postgres DAL + migration runner.
2. **Module isolation precedent exists.** `wa_listings` schema in Postgres isolates WhatsApp module tables. Both new modules should follow the same pattern.
3. **No map library is installed.** The Interactive Proximity Ring Explorer, Semi-Circle Radar, admin pin selector, and inspector map will require `@googlemaps/js-api-loader`.
4. **No `robots.txt` exists yet** in `public/`. Must create it per the Area Intelligence spec.
5. **Property detail page already imports location-related icons** (`MapPin`, `School`, `Footprints`, `Bus`, `Thermometer`, etc.) from Lucide, suggesting these icons can be reused for score gauges.
6. **`src/api/client.ts` is the canonical frontend API client.** New endpoints must be typed there.
7. **The auth token key in localStorage is `fi_token`** (legacy alias `sa_token`). Frontend API calls use Bearer tokens from this key.
8. **`requirePlatformAdmin` is the correct guard for admin-level config**, while public area/pricing pages need no auth.
9. **Existing workers run on fixed intervals with `running` flags** to prevent overlap. New scoring/pricing workers should follow this exact pattern.
10. **Area Intelligence is a prerequisite for Market Pricing.** The pricing spec references `area_profiles`, `area_id`, and area-level trend snapshots. Build Area Intelligence schema first.
11. **WhatsApp module already implements credit and entitlement services**, but both new specs say build WITHOUT gating. No entitlement checks or credit consumption.
12. **External scraping is specified for Market Pricing Tier 2 sources** (OLX Lebanon, Confidence Real Estate, Property Finder Lebanon). Actual scraper implementation is out of initial scope; provide a configurable worker skeleton that logs attempts and gracefully falls back to internal data.

---

## 3. Assumptions Rejected (Spec Staleness)

| Spec Statement | Actual Code Reality | Impact |
|----------------|---------------------|--------|
| "Database: SQLite via `better-sqlite3`" | Postgres-only async DAL | New tables must be added via SQL migrations, not `seed.js` lazy schema. |
| "ORM / migrations: NONE — schema created lazily in `loadDb()`" | Ordered SQL migration runner exists | Must create `backend/src/persistence/migrations/023_area_intelligence.sql`, `024_market_pricing.sql`, etc. |
| "Runtime: Node.js 22" | `package.json` has no `engines` field | No runtime version enforcement; code should target modern Node features used elsewhere. |
| "Database: SQLite JSON-document store" | Postgres with typed relational columns + JSONB `data` column | New schema should use typed columns for queryable fields and JSONB only for flexible metadata. |

---

## 4. Collision Points

1. **Route collisions** — Existing endpoints:
   - `/api/properties/*` (do not modify)
   - `/api/webhooks/whatsapp` (do not create new webhooks)
   - `/api/admin/*` already used; new admin endpoints should use `/api/admin/areas`, `/api/admin/scoring/*`, `/api/admin/pricing/*`.
   - `/api/pricing/*` is green field for public pricing endpoints.
   - `/api/areas/*` is green field for public area endpoints.
2. **Database collisions** —
   - Do not create tables outside a module-owned schema/prefix.
   - Do not add columns to `properties` directly; read via DAL.
   - Market Pricing must reference `area_profiles` (created by Area Intelligence) but keep its own tables under `market_pricing.*` or strict prefix.
3. **Worker collisions** — New `setInterval` workers must guard against overlap with a `running` boolean.
4. **Upload collisions** — Field inspection photos reuse `POST /api/uploads` and `/uploads/*` static serving.
5. **Frontend route collisions** — Existing `/property/:id`, `/search`, `/agents`; new routes `/areas`, `/areas/:slug`, `/inspector`, `/admin/areas`, `/admin/scoring/*`, `/admin/pricing/*` are available.
6. **Map library collisions** — Green field, but adding `@googlemaps/js-api-loader` affects bundle size and requires env key.
7. **AI adapter collisions** — Both modules will reuse the same adapter; ensure prompt builders and provider configs do not clash.

---

## 5. Reuse Opportunities

| Component | Location | Reuse For |
|-----------|----------|-----------|
| Multi-provider AI adapter | `backend/src/modules/whatsapp-listings/infrastructure/ai/` | Area narratives, AI synthesis scoring, market context sentences. |
| `transaction()` helper | `backend/src/db.js` | Atomic score calculation writes, price analysis caching. |
| `validate()` / `validateQuery()` | `backend/src/lib/validation.js` | Admin/inspector/pricing API validation. |
| Multer upload endpoint | `server.js:386-401` | Field inspection photo uploads. |
| `requirePlatformAdmin` / `requireAdmin` | `server.js:466-485` | Admin API authorization. |
| `pino` logger | `backend/src/lib/logger.js` | Google API usage, scoring audit, pricing recalculation logs. |
| shadcn/ui primitives | `src/components/ui/*` | Admin and inspector UI. |
| Lucide icons | already imported across pages | Score gauge icons. |
| `api` client | `src/api/client.ts` | New typed frontend API calls. |
| Module registration pattern | WhatsApp module | Both Area Intelligence and Market Pricing module bootstrap. |
| WhatsApp pipeline approval message builder | `backend/src/modules/whatsapp-listings/application/pipeline.js` | Inject market pricing context before approval message is sent. |

---

## 6. Open Questions Remaining

1. **Google API key scope:** Should the same `GOOGLE_MAPS_API_KEY` be used for Maps JS API, Places API, and Distance Matrix API, or do you have separate keys?
2. **Google API rate limiting implementation:** The spec says 100 calls/minute. Should this be enforced in-memory per process, or do you want a Redis/external rate limiter? (Existing platform has no Redis.)
3. **Field inspector assignment model:** Should assignments be created automatically for all agents in an area, or should an admin manually assign agents to areas?
4. **Area boundaries:** Do you have GeoJSON boundaries for Batroun/Mar Mikhael, or should we start with center lat/lng only and optional boundary upload?
5. **Currency rate source:** For Market Pricing, what is the authoritative source for the USD/LBP parallel market rate? Manual admin input, or an external API? If external, which one?
6. **External scraping legal/technical:** Are actual OLX/Confidence scrapers in scope for this implementation, or should we provide the schema + skeleton worker only?
7. **Score composite normalization:** Should all dimension scores be stored on a 0–10 scale internally, or 0–100? (Spec UI shows "8.8 / 10".)
8. **Area-to-property linkage:** Should properties auto-link to an `area_profile` based on lat/lng + level, or should the agent/admin manually select the area?

---

## 7. Recommended Module Layout

### Area Intelligence Engine

```
backend/src/modules/area-intelligence/
  index.js                         # createModule({ platformAdapter })
  config.js                        # env vars, feature toggles
  logger.js                        # module-scoped pino child
  platform-adapter.js              # only core-platform touch point
  domain/
    types.js                       # constants, defaults, scoring logic types
    scoring/                       # interpreters: weighted_average, conditional_rules, ai_synthesis, composite
  application/
    area-service.js                # CRUD + status workflow
    dimension-service.js           # score_dimensions CRUD
    source-type-service.js          # source_types CRUD
    source-service.js              # area_sources CRUD + monitoring
    signal-service.js              # area_signals ingestion/extraction
    score-service.js               # calculation engine + audit
    inspector-service.js           # assignments, submissions, review queue
    google-service.js              # Places/Distance Matrix fetch + cache
    narrative-service.js           # AI-generated area narrative
  infrastructure/
    db.js                          # module DAL wrapper
    queue.js                       # scoring / ingestion worker
    ai-adapter.js                  # reuses WhatsApp AI adapter
    google-client.js               # fetch wrappers for Google APIs
    storage.js                     # inspection photo helpers
  interface/
    admin-routes.js                # /api/admin/areas, /api/admin/scoring/*
    inspector-routes.js            # /api/inspector/*
    public-routes.js               # /api/areas/*
  tests/
  README.md

src/pages/admin/areas/
src/pages/admin/scoring/
src/pages/inspector/
src/pages/AreaDirectoryPage.tsx
src/pages/AreaProfilePage.tsx
src/components/area-intelligence/
  ScoreGauge.tsx
  SemiCircleRadar.tsx
  ProximityRingExplorer.tsx
  AreaScoreCard.tsx
  InspectionForm.tsx
  DimensionManager.tsx
  SourceTypeManager.tsx
```

### Market Pricing Intelligence

```
backend/src/modules/market-pricing/
  index.js                         # createModule({ platformAdapter })
  config.js
  logger.js
  platform-adapter.js
  domain/
    types.js                       # constants, normalization rules, confidence levels
    matching/                      # comparable matching algorithm
    analysis/                      # price range + percentile calculation
    trend/                         # quarterly snapshot calculation
  application/
    config-service.js              # pricing_match_configs CRUD
    analysis-service.js            # property_price_analyses calculation + caching
    comparable-service.js          # internal + external comparables query
    trend-service.js               # price_trend_snapshots generation
    currency-service.js            # currency_rates CRUD + normalization
    external-scraper-service.js    # skeleton worker for external sources
  infrastructure/
    db.js
    queue.js                       # weekly recalculation worker
    ai-adapter.js                  # market context sentence generation
  interface/
    admin-routes.js                # /api/admin/pricing/*
    public-routes.js               # /api/pricing/*
  tests/
  README.md

src/pages/admin/pricing/
src/components/market-pricing/
  MarketContextCard.tsx
  ComparableListModal.tsx
  TrendMiniChart.tsx
  PriceHealthIndicator.tsx
```

---

## 8. Go/No-Go Recommendation

**Go** for Area Intelligence Engine implementation first, then Market Pricing Intelligence.

**Required before implementation starts:**

- Confirm or answer the remaining open questions in Section 6, especially:
  - Google API key scope (single key or separate keys).
  - Currency rate source for Market Pricing.
  - External scraping scope (real scrapers or skeleton only).
  - Area-to-property linkage strategy.

The platform is architecturally ready: Postgres migrations, module isolation, AI adapter, upload infrastructure, auth/roles, and frontend component stack all exist. Both specs must be implemented against the verified Postgres reality, ignoring their stale SQLite assumptions.
