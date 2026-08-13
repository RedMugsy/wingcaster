# Design & Architecture Decisions — Souq Ajjar / Real Estate Bazaar

**Generated:** 2026-08-07  
**Repository:** `https://github.com/RedMugsy/Real-Estate-Bazaar.git`  
**Branch:** `main` (`a906a3a`)  
**Purpose:** A laundry-list reference of the key design and architecture decisions another AI can use to audit the platform.

---

## 1. Storage & Persistence

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 1.1 | SQLite via `better-sqlite3` for local/dev deployments | Single-file, zero-config, synchronous API fits the current scale and keeps local setup simple. | `backend/src/db.js` |
| 1.2 | Collection-style JSON documents in a single `collections` table | Schema flexibility while still using a relational store; each row is a JSON document keyed by `(collection, id)`. | `backend/src/db.js` |
| 1.3 | WAL mode + indexes on `collection`, `created_at`, `updated_at` | Improves read concurrency and filters/sorts by collection. | `backend/src/db.js` |
| 1.4 | In-memory reads for seed data during dev start | `seedData()` populates defaults if collections are empty; safe to rerun. | `backend/src/seed.js` |
| 1.5 | SQLite path configurable via `SQLITE_PATH` | Allows production persistent disk mounts. | `backend/src/db.js` |

---

## 2. Authentication & Authorization

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 2.1 | JWT sessions with `token_version` | Enables session revocation on password change without maintaining a session store. | `backend/src/auth.js` |
| 2.2 | `authMiddleware` decodes JWT and loads agent on every request | Keeps handlers stateless and consistently authorized. | `backend/src/auth.js`, `backend/src/server.js` |
| 2.3 | Role-based middleware (`requireAdmin`, `requirePlatformAdmin`, `requireRole`) | Reusable guards for admin/agency endpoints. | `backend/src/server.js` |
| 2.4 | First registrant matching `ADMIN_EMAIL` auto-promoted to `admin` | Bootstrap super-user without manual DB edits. | `backend/src/server.js` |
| 2.5 | Rate limiting split into general + auth paths | Auth/inquiry endpoints are more sensitive and get a stricter limit (`RATE_LIMIT_AUTH_MAX`). | `backend/src/server.js` |
| 2.6 | Rate-limit defaults relaxed in development (`500` general / `100` auth) | Smoke tests and local development can issue many requests without hitting limits. | `backend/src/server.js` |

---

## 3. Backend Routing & Error Handling

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 3.1 | Express app with async handler wrapper | Guarantees rejected promises reach the centralized error middleware. | `backend/src/server.js` (top of file) |
| 3.2 | Zod validation schemas + `validate`/`validateQuery` middleware | Type-safe request validation with structured error responses. | `backend/src/lib/validation.js` |
| 3.3 | Centralized activity/audit logging | `activity_log` collection records key events for compliance and debugging. | `backend/src/server.js` |
| 3.4 | Health + ready endpoints expose worker state | Operators can observe scheduler health and last-run results. | `GET /api/health`, `/api/ready` |
| 3.5 | CSP + Helmet + CORS allowlist | Defense in depth for a public marketplace. | `backend/src/server.js` |

---

## 4. CRM Data Model

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 4.1 | Unified `contacts` table upserted by email or phone | Prevents duplicate lead records across web forms, WhatsApp, SMS, and email. | `backend/src/conversations/orchestrator.js` |
| 4.2 | `contact_id` back-linked on `inquiries`, `viewings`, and `conversation_messages` | Drives timelines, attribution, and GDPR export/delete. | Multiple modules |
| 4.3 | `inquiries.next_follow_up_at` is a derived cache | Source of truth is the earliest pending `tasks` row; cache is rebuilt on every task mutation. | `backend/src/tasks.js` |
| 4.4 | Opportunity stage history derived from patch events | Simplifies model while keeping full audit trail. | `backend/src/opportunities.js` |
| 4.5 | Viewing outcomes generate follow-up tasks of the appropriate type | Automates agent workflow: `interested` → offer call, cancelled → re-engage, no-show → re-engage. | `backend/src/tasks.js` |
| 4.6 | Contact merge reconciles child records into the source contact | Keeps conversation/inquiry history intact when duplicates are found. | `backend/src/conversations/orchestrator.js` |

---

## 5. Conversation Orchestrator

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 5.1 | One conversation per `(contact_id, source_channel)` | Keeps WhatsApp, SMS, email, and each social channel in distinct threads. | `backend/src/conversations/orchestrator.js` |
| 5.2 | `visibility: public` for Instagram/TikTok/X comments | Marks public social comments so PII is never posted in replies. | `backend/src/conversations/orchestrator.js` |
| 5.3 | Outbound dispatchers return `{ok, status, provider_message_id, error, simulated}` | Unified status shape regardless of channel; `simulated` flag distinguishes dev stubs. | Channel dispatcher files |
| 5.4 | Dev simulators for SMS, email, and social channels | Allows smoke testing without live provider credentials. | `backend/src/lib/notifications/*.js` |
| 5.5 | Live WhatsApp Cloud API with fallback status when unconfigured | Graceful degradation in dev; production requires `WHATSAPP_*` env vars. | `backend/src/whatsapp.js` |
| 5.6 | Closed conversations reopen automatically on new inbound message | Reduces manual triage. | `backend/src/conversations/orchestrator.js` |
| 5.7 | WhatsApp and Instagram share Meta webhook infrastructure | Both use Meta Graph API / Messenger platform. | `backend/src/server.js`, `backend/src/lib/notifications/instagram.js` |

---

## 6. Consumer Automation Workers

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 6.1 | Three independent background timers | Retry worker, consumer automation worker, notification retry worker, and campaign scheduler each run on their own cadence. | `backend/src/server.js` |
| 6.2 | Workers are lightweight setInterval loops in the same process | Good enough for current scale; no message queue needed yet. | `backend/src/server.js` |
| 6.3 | Per-user checkpointing with 5-second minimum interval | Prevents redundant full scans when manual and scheduled runs overlap. | `backend/src/server.js` |
| 6.4 | `force_alerts` bypasses checkpoint gate | Smoke tests and admin runs can force immediate evaluation. | `backend/src/server.js` |
| 6.5 | Notification deduplication by day-level key | Avoids spam from repeated worker/manual runs. | `backend/src/server.js` |
| 6.6 | Saved-search alerts evaluated against current properties | Returns matching properties and creates notifications; no separate search index required at this scale. | `backend/src/server.js` |
| 6.7 | Viewing reminder policy resolution: agent → agency → global default | Most specific policy wins; global default acts as fallback. | `backend/src/reminders.js` |
| 6.8 | `viewings.reminders_sent` array tracks per-rule delivery | Supports multiple reminders per viewing with different offsets/channels. | `backend/src/reminders.js`, `backend/src/server.js` |

---

## 7. Lead Capture & Routing

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 7.1 | `POST /api/inquiries` creates a `contacts` row automatically | Unifies lead capture from web forms. | `backend/src/server.js` |
| 7.2 | `resolveLeadAgent` prefers listing agent, then agency routing rules, then agency owner | Inquiry ownership is deterministic and configurable. | `backend/src/whiteLabel.js` |
| 7.3 | `contact_mode` (`direct` / `platform_routed`) on inquiries | Direct mode exposes agent contact details; platform-routed mode keeps the platform in the loop with auto-reply + follow-up task. | `backend/src/server.js`, `backend/src/lib/validation.js` |
| 7.4 | Property CTA config merged from agency → agent with defaults | Agencies set baseline; agents can override per-button. | `backend/src/server.js` |

---

## 8. Frontend Architecture

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 8.1 | React + Vite + TypeScript + Tailwind CSS | Modern, fast dev/build, typed, utility-first styling. | `package.json`, `vite.config.ts` |
| 8.2 | React Router for SPA navigation | Clean route-based pages with protected routes. | `src/App.tsx` |
| 8.3 | Centralized API client (`src/api/client.ts`) | All backend calls go through one module for consistent headers, token handling, and error shaping. | `src/api/client.ts` |
| 8.4 | Lucide icons + Radix UI primitives | Lightweight, accessible component foundation. | `src/components/ui/*` |
| 8.5 | `useToast` context for feedback | Consistent user-facing errors/success messages. | `src/components/ui/toast.tsx` |
| 8.6 | Property detail page fetches CTA config separately | CTA rendering is driven by merged agent/agency configuration. | `src/pages/PropertyDetailPage.tsx` |

---

## 9. Deployment & Operations

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 9.1 | Backend deployed to Railway | Node-friendly managed hosting with environment variables. | `railway.json`, `.github/workflows/deploy-backend.yml` |
| 9.2 | Frontend deployed to Cloudflare Pages | Static hosting with GitHub Actions integration. | `.github/workflows/deploy-frontend.yml` |
| 9.3 | GitHub Actions for CI (`typecheck` + `build`) | Pre-merge verification. | `.github/workflows/ci.yml` |
| 9.4 | Secrets kept out of repository | `.env` and provider tokens supplied via GitHub / Railway secrets. | `.env.example` |
| 9.5 | SQLite production note: mount persistent disk at `/data` | Prevents data loss on redeploy; Postgres migration flagged as future work. | `docs/AI-HANDOVER-2026-08-02.md` |

---

## 10. Testing & Verification

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 10.1 | Single smoke test script exercises full backend flow | End-to-end confidence without a heavy test framework. | `scripts/smoke-test.mjs` |
| 10.2 | Smoke test creates a fresh agent/property/inquiries/viewings each run | Isolates tests and avoids brittle fixtures. | `scripts/smoke-test.mjs` |
| 10.3 | Smoke test assumes a fresh backend database | Persisted data from previous runs can cause collisions (e.g., reused contacts). | `scripts/smoke-test.mjs` |
| 10.4 | `npm run typecheck` via `tsc --noEmit` | Fast compile-time validation. | `package.json` |
| 10.5 | Build uses `tsc && vite build` | Type safety before bundling. | `package.json` |

---

## 11. Compliance & Security

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 11.1 | GDPR export returns JSON of contact + child records | Satisfies data-portability requirements. | `backend/src/server.js` |
| 11.2 | GDPR delete removes contact + child records | Right-to-erasure support. | `backend/src/server.js` |
| 11.3 | Public social comments never include PII in replies | Privacy guard; sensitive replies move to DM. | `backend/src/conversations/orchestrator.js` |
| 11.4 | Notification preferences with channel + per-event opt-ins | User-controlled communication consent. | `backend/src/server.js` |

---

## 12. Extension Points

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 12.1 | Channel dispatchers are isolated modules | Adding a new channel only requires a new dispatcher + webhook handler. | `backend/src/lib/notifications/*.js` |
| 12.2 | Reminder policies are generic per appointment type | Extends beyond viewings to calls, bookings, and meetings. | `backend/src/reminders.js` |
| 12.3 | Campaign engine uses step-based sequences with `delay_hours` | Supports nurture, re-engagement, and onboarding drips. | `backend/src/campaigns.js` |
| 12.4 | Campaign dispatch reuses conversation orchestrator | `runCampaignScheduler` resolves templates, builds variables, and calls `sendOutboundMessage` instead of creating tasks; failures are recorded and do not block the cursor. | `backend/src/campaigns.js` |
| 12.5 | Campaign opt-out model is tag + status based | Avoids a schema migration; `opted_out`/`unsubscribe`/`unsubscribed` tags or `status=do_not_contact` skip dispatch. | `backend/src/campaigns.js` |
| 12.6 | `CAMPAIGN_AUTO_DISPATCH_ENABLED` kill-switch | Lets operators disable live dispatch without a code revert; falls back to task creation. | `backend/src/campaigns.js` |
| 12.7 | Analytics endpoints aggregate existing collections | No separate analytics store needed at current scale. | `backend/src/analytics/crm.js` |

---

## 13. WhatsApp Listing Module Design Decisions

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 13.1 | Module boundary via `PlatformAdapter` | The module only touches core platform through `platform-adapter.js`; deleting `backend/src/modules/whatsapp-listings/` leaves core runnable. | `backend/src/modules/whatsapp-listings/platform-adapter.js` |
| 13.2 | SQLite-backed module collections | Reuses the platform's JSON-document `collections` table; module tables are `whatsapp_listing_*`. | `backend/src/modules/whatsapp-listings/infrastructure/db.js` |
| 13.3 | Entitlement hierarchy: agent → agency → platform | Most-specific scope wins; platform default fallback. | `backend/src/modules/whatsapp-listings/application/entitlements.js` |
| 13.4 | AI credit reserve/consume/release pattern | Prevents over-spend and refunds unused reserved credits on failure. | `backend/src/modules/whatsapp-listings/application/credits.js` |
| 13.5 | Fetch-based provider adapters with unified interface | Easy to add new AI providers; no provider-specific formatting in business logic. | `backend/src/modules/whatsapp-listings/infrastructure/ai/` |
| 13.6 | Template compositing on real photos (no AI image gen) | Lower cost, brand-controlled, avoids generative-artifacts. | `backend/src/modules/whatsapp-listings/infrastructure/templates/` |
| 13.7 | Instagram publishing via existing distribution retry queue | Reuses `distributions` table + retry worker instead of building a separate publisher. | `backend/src/modules/whatsapp-listings/platform-adapter.js` |
| 13.8 | Intent classifier with keyword → reference → AI fallback | Cheap heuristics handle common cases; AI only for ambiguity. | `backend/src/modules/whatsapp-listings/application/intent.js` |
| 13.9 | Asset versioning in `/uploads/properties/{id}/vN/` | Prevents CDN caching issues and keeps thumbnail history. | `backend/src/modules/whatsapp-listings/infrastructure/templates/engine.js` |
| 13.10 | **WhatsApp location pin as canonical coordinates** | GPS pin is ground truth; no geocoding or address parsing hallucinations. | `backend/src/modules/whatsapp-listings/application/pipeline.js` |
| 13.11 | **Most-recent pin wins in intake window** | Agents often correct a misplaced pin; last sent pin is canonical. | `backend/src/modules/whatsapp-listings/application/pipeline.js` |
| 13.12 | **Pin-aware AI prompt branches** | Saves tokens and prevents hallucinated addresses when a verified pin exists. | `backend/src/modules/whatsapp-listings/infrastructure/ai/shared.js` |
| 13.13 | **Approval message location confirmation** | Agent can verify coordinates before publishing; prompt to send a new pin if wrong. | `backend/src/modules/whatsapp-listings/application/pipeline.js` |
| 13.14 | **Explicit "done" trigger for intake** | Allows agents to close the 2-minute intake window immediately instead of waiting. | `backend/src/modules/whatsapp-listings/application/pipeline.js` |
| 13.15 | **AI vision hero image selection** | Vision model ranks submitted photos and selects the most appealing hero image for thumbnails. | `backend/src/modules/whatsapp-listings/infrastructure/ai/adapter.js` |
| 13.16 | **AI-generated change summary for updates** | Extraction prompt asks AI to diff against existing listing; pipeline merges AI summary with structural diff. | `backend/src/modules/whatsapp-listings/infrastructure/ai/shared.js` |
| 13.17 | **Update-specific approval UX** | WhatsApp approval card for updates shows "What changed" and offers `Update Listing` / `Update + Re-post` / `Discard`. | `backend/src/modules/whatsapp-listings/application/pipeline.js` |
| 13.18 | **Social re-posting rules on updates** | Minor text-only updates do not auto-repost; significant changes (price, status, photos) generate update-badged posts. | `backend/src/modules/whatsapp-listings/application/pipeline.js` |
| 13.19 | **Implicit listing matcher** | When no explicit listing reference is given, ranks the agent's active listings by detected location/text similarity. | `backend/src/modules/whatsapp-listings/application/matcher.js` |
| 13.20 | **Circuit breaker per AI provider** | Tracks failures per provider; unhealthy providers are skipped until they recover. | `backend/src/modules/whatsapp-listings/infrastructure/ai/adapter.js` |
| 13.21 | **Dead-letter queue with exponential backoff** | Failed jobs retry up to 5 times with exponential backoff; exhausted jobs move to DLQ for inspection. | `backend/src/modules/whatsapp-listings/infrastructure/queue.js` |
| 13.22 | **Module test suite** | Unit tests for AI adapter, template engine, state machine plus an integration test for the full pipeline. | `backend/src/modules/whatsapp-listings/tests/` |
| 13.23 | **Message templates as foundation layer** | Reusable templates with variable substitution are built before campaigns/auto-responders so later features share one rendering engine. | `backend/src/message-templates.js` |
| 13.24 | **Template owner scoping (agent/agency/platform)** | Mirrors reminder-policies access pattern; keeps permission logic predictable. | `backend/src/message-templates.js` |
| 13.25 | **Auto-extract template variables** | Variables are derived from body/subject rather than declared separately, preventing drift. | `backend/src/message-templates.js` |


---

## 14. Dual-Database Architecture (Postgres Primary + SQLite Mirror)

| # | Decision | Rationale | Location |
|---|----------|-----------|----------|
| 14.1 | Introduce a DAL facade instead of direct `better-sqlite3` calls | Allows switching the primary engine from SQLite to Postgres without changing business logic; centralizes query logging and correlation IDs. | `backend/src/persistence/index.js` |
| 14.2 | Keep the existing document-store semantics in Postgres first (parity phase) | De-risks cutover: business code continues to use `findAll`/`findOne`/`insert`/`update`/`remove` on JSON documents; gradual normalization can happen later. | `backend/src/persistence/postgres-adapter.js` |
| 14.3 | Postgres schema uses `(collection, id)` composite primary key with JSONB `data` | Mirrors SQLite `collections` table exactly; GIN index on `data` allows targeted queries during the parity phase. | `backend/src/persistence/postgres-adapter.js` |
| 14.4 | Dual-write: Postgres commit first, then mirror to SQLite | Primary correctness is non-negotiable; SQLite mirror is a hot standby and diagnostic copy, not authoritative. | `backend/src/persistence/index.js`, `mirror-orchestrator.js` |
| 14.5 | Mirror failures do not fail the request | Avoids making Postgres reliability dependent on local file-system state; failures are logged, metered, and retried. | `backend/src/persistence/mirror-orchestrator.js` |
| 14.6 | Exponential backoff with deterministic per-row mirror operations | 3 retries with 100ms/500ms/2s delays; per-row `UPDATE`/`DELETE` by `id` makes replays idempotent. | `backend/src/persistence/mirror-orchestrator.js` |
| 14.7 | Feature flags for staged rollout | `DB_PRIMARY`, `DB_MIRROR_SQLITE`, `DB_CONSISTENCY_MODE`, `DB_RECONCILE_ON_START` let operators cut over gradually and roll back to SQLite instantly. | `backend/src/persistence/config.js` |
| 14.8 | Async-refactor the entire business layer before Postgres cutover | Postgres is inherently async (`pg` returns Promises); `seed.js`, `server.js`, and all dependent modules were converted to `await` DAL calls before enabling `DB_PRIMARY=postgres`. | `backend/src/seed.js`, `backend/src/server.js`, `backend/src/tasks.js`, `backend/src/campaigns.js`, etc. |
| 14.9 | `.env` loaded before persistence config evaluation | `import 'dotenv/config'` at the top of `server.js` ensures `DATABASE_URL` and `DB_PRIMARY` are present when `config.js` reads `process.env`. | `backend/src/server.js` |
| 14.10 | Backfill and reconciliation deferred to Phase 2 | Phase 0–1 focuses on safe dual-write behavior; historical SQLite→Postgres import and scheduled diff-sync are not required while SQLite remains the default. | `docs/db-migration-architecture.md` |
