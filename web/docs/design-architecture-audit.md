# Design & Architecture Decision Audit — Souq Ajjar / Real Estate Bazaar

**Generated:** 2026-08-05  
**Repository:** `https://github.com/RedMugsy/Real-Estate-Bazaar.git`  
**Branch:** `main` (`698d24d`)  
**Purpose:** A laundry-list of architectural and design decisions so another AI can audit intent, trade-offs, and implementation consistency.

---

## 1. Monorepo Layout

| Decision | Rationale | Files |
|----------|-----------|-------|
| Frontend + backend in one repo | Simplifies deploy config, shared types eventually, single CI pipeline. | Root `package.json`, `backend/` |
| Root `package.json` proxies to `backend/` | Railway originally pointed to root; `postinstall` and `start` scripts run `cd backend && npm install` / `npm start`. | `package.json` scripts |
| Vite React frontend + Express backend | Fast dev build, minimal backend footprint. | `vite.config.ts`, `backend/src/server.js` |

---

## 2. Storage & Persistence

| Decision | Rationale | Files |
|----------|-----------|-------|
| SQLite via `better-sqlite3` with a single `collections` table | Avoids schema migrations; JSON documents map to rows keyed by `(collection, id)`. Fast enough for current scale; easy to inspect. | `backend/src/db.js` |
| Collection-style CRUD helpers (`findAll`, `findOne`, `insert`, `update`, `remove`) | Hides SQL; enables swapping to Postgres later by re-implementing helpers. | `backend/src/db.js` |
| WAL mode + foreign keys enabled | Better concurrency and referential integrity checks. | `backend/src/db.js` loadDb() |
| Indexes on `(collection, created_at)` and `(collection, updated_at)` | Supports time-sorted lists and recent-run queries without full table scans. | `backend/src/db.js` |
| In-memory worker state (not persisted) | Workers are idempotent; state is for observability only. If server restarts, workers resume from DB. | `server.js` worker state objects |

---

## 3. Authentication & Authorization

| Decision | Rationale | Files |
|----------|-----------|-------|
| JWT with `token_version` | Allows session revocation on password change without a centralized session store. | `backend/src/auth.js`, `server.js` password change |
| Role stored on `agents.role` (`agent`, `admin`, `platform_admin`) | Simple flat RBAC. Agency membership roles are separate in `agency_members`. | `backend/src/server.js` registration, `requireAdmin` |
| Admin auto-promotion via env email | Lets the first admin be bootstrapped without a separate CLI. | `server.js` registration, env `ADMIN_EMAIL` / `SMOKE_ADMIN_EMAIL` |
| `authMiddleware` + explicit ownership checks | Not every endpoint uses RBAC middleware; some use ad-hoc ownership checks for backward compatibility. | Many endpoints in `server.js` |
| `requirePlatformAdmin` for global operations | Protects audit-log retention, user promotion, and cross-tenant operations. | `server.js` |

---

## 4. Conversation Orchestrator Architecture

| Decision | Rationale | Files |
|----------|-----------|-------|
| Single `contacts` table normalized by email/phone | Prevents duplicate leads across channels. | `backend/src/conversations/orchestrator.js` |
| One `conversation` per contact per channel | WhatsApp/SMS/Email/Instagram/TikTok/X threads are separate; merging is at contact level. | `orchestrator.js` |
| `conversation_messages` stores both inbound and outbound | Full audit trail; status field tracks delivery lifecycle. | `orchestrator.js`, `server.js` webhook handlers |
| Dispatchers return normalized `{ ok, provider, provider_message_id, simulated }` | Orchestrator is channel-agnostic; adding a new channel requires a dispatcher + branches. | `orchestrator.js`, `lib/notifications/*.js` |
| Inbound webhooks parse provider payloads into normalized events | Each channel has its own parser, but the orchestrator ingests a uniform shape. | `server.js` webhook handlers, `lib/notifications/*.js` |
| Public-comment visibility (`public`) vs. private channels | Prevents PII leakage on Instagram/TikTok/X public replies. | `orchestrator.js`, `server.js` webhook handlers |
| Dev simulation mode for all channels | Lets the platform be tested without live credentials; `*_DEV_ALWAYS_SUCCESS` env vars toggle failure paths. | `lib/notifications/{tiktok,x,instagram,sms,email}.js` |

---

## 5. Channel-Specific Implementation Notes

| Channel | Inbound | Outbound | Live Provider | Notes |
|---------|---------|----------|---------------|-------|
| WhatsApp | Cloud API webhooks | `whatsapp.js` Cloud API | Meta | Most mature channel. |
| SMS | Twilio webhook | Twilio Programmable SMS | Twilio | Dev simulator when `TWILIO_*` missing. |
| Email | SendGrid/Resend inbound parse | SendGrid/Resend SMTP | SendGrid/Resend | Resend for conversation; SendGrid for marketing. |
| Instagram DM | Meta Messenger webhook | Meta Graph API | Meta | Shared app with WhatsApp. 24h session window not enforced. |
| Instagram comment | Graph API webhook | Graph API comment reply | Meta | Public replies redirect to DM. |
| TikTok comment | Normalized webhook | Dev simulator / live scaffold | TikTok partner API | Live reply API is restricted; capture is primary use case. |
| TikTok DM | Normalized webhook | Dev simulator | Not generally available | Captured for record keeping; live sending deferred. |
| X DM | Normalized webhook | X API v2 scaffold | X API v2 (paid) | Expensive; dev simulator default. |
| X mention | Normalized webhook | X API v2 scaffold | X API v2 (paid) | Public replies redirect to DM. |

---

## 6. CRM Model Design

| Decision | Rationale | Files |
|----------|-----------|-------|
| `contacts` as the identity anchor | Every inbound message, inquiry, or form submission resolves to a contact. | `orchestrator.js`, `inquiries` endpoint |
| `inquiries` hold the lead status/stage/priority | Separate from contact because one contact can have multiple property inquiries. | `server.js`, `inquiries` collection |
| `opportunities` represent deals with economics | `deal_value`, `probability`, `expected_close_date` enable weighted pipeline. | `backend/src/opportunities.js` |
| `tasks` replace `next_follow_up_at` timestamps | Agents work from tasks; `inquiries.next_follow_up_at` is a derived cache. | `backend/src/tasks.js`, `syncInquiryNextFollowUp` |
| `viewings` capture outcomes and drive tasks | `interested` outcome creates/advances opportunity. | `server.js`, `opportunities.js` |
| `contact_notes` + `activity_log` + timeline builder | Timeline aggregates heterogeneous events into a chronological feed. | `backend/src/contacts/timeline.js` |

---

## 7. Campaign / Drip Sequence Design

| Decision | Rationale | Files |
|----------|-----------|-------|
| `campaigns` = reusable templates; `campaign_enrollments` = running instances | Separation allows versioning and reuse. | `backend/src/campaigns.js` |
| Each step has `delay_hours`, `channel`, `subject`, `body` | Simple rule-based scheduling; no complex branching yet. | `campaigns.js` |
| Scheduler creates a `task` per step rather than auto-sending | Avoids accidental live sends during dev; agent reviews before dispatch. Future iteration can auto-send via orchestrator. | `campaigns.js` `runCampaignScheduler` |
| Manual scheduler run is auth-gated (not admin-only) | Any authenticated agent can trigger a run; background worker runs automatically. | `server.js` `/api/campaigns/run-scheduler` |
| `tags_filter` + `trigger` for auto-enrollment | Campaigns can target contacts by tags; future triggers can be event-driven. | `campaigns.js` `autoEnrollContactsForCampaign` |

---

## 8. Worker & Automation Architecture

| Decision | Rationale | Files |
|----------|-----------|-------|
| Workers are `setInterval` loops inside the same process | Simpler than a separate job queue; acceptable for current scale. | `server.js` bottom section |
| Worker state exposed in `/api/health` | Observability without external monitoring. | `server.js` `/api/health` |
| Consumer automation checkpoints by user | Reduces full-table scans and prevents duplicate notifications. | `server.js` `getAutomationCheckpoint` |
| `force_alerts` bypasses dedupe for explicit re-runs | Manual runs can override; scheduled runs dedupe. | `server.js` automation |
| Distribution retry worker is separate from consumer automation | Different concerns: social post publishing vs. CRM nurture. | `server.js` |

---

## 9. GDPR & Compliance Design

| Decision | Rationale | Files |
|----------|-----------|-------|
| GDPR export returns all related collections | Single endpoint gives a complete data subject package. | `server.js` `exportContactData` |
| GDPR delete cascades through child collections | Removes messages, conversations, viewings, tasks, opportunities, notes, enrollments. | `server.js` `deleteContactData` |
| Audit log retention is configurable via env | Default 1 year; can be extended for compliance. | `server.js` `AUDIT_LOG_RETENTION_DAYS`, `ACTIVITY_LOG_RETENTION_DAYS` |
| Retention endpoint is platform-admin only | Prevents accidental mass deletion. | `server.js` `/api/admin/audit-log/retention` |
| `activity_log` is the primary audit store | `logActivity()` inserts a row for every significant state change. | `server.js` |

---

## 10. Frontend Architecture

| Decision | Rationale | Files |
|----------|-----------|-------|
| Centralized API client in `src/api/client.ts` | All backend calls go through one helper; auth headers centralized. | `src/api/client.ts` |
| `API_BASE` from `import.meta.env.VITE_API_URL` | Vite replaces env at build time; defaults to Railway URL. | `src/api/client.ts` |
| React Context for auth | `AuthContext.tsx` holds token and user state. | `src/context/AuthContext.tsx` |
| Tailwind + shadcn/ui primitives | Consistent styling with minimal custom CSS. | `src/components/ui/*`, `index.css` |
| Pages for each major feature area | Dashboard, CRM, inbox, tasks, opportunities, white-label, etc. | `src/pages/*` |
| Warning: main bundle > 500kB | Code-splitting improvements are a future optimization. | `vite build` output |

---

## 11. Security Decisions

| Decision | Rationale | Files |
|----------|-----------|-------|
| Helmet with CSP | Mitigates XSS and injection; allows inline scripts for Vite dev. | `server.js` Helmet config |
| CORS allowlist in production | `ALLOWED_ORIGINS` env; dev allows all. | `server.js` `getAllowedOrigins` |
| Rate limiting on auth and inquiries | Prevents brute-force and spam. | `server.js` rate limiters |
| `bcrypt` for passwords | Standard slow hashing. | `server.js` registration/login |
| Recovery tokens hashed with SHA-256 | Tokens are single-use, short-lived; hash stored in DB. | `server.js` account recovery |
| HTTPS redirect when `FORCE_HTTPS=true` | Production hardening behind proxy. | `server.js` |

---

## 12. Testing Strategy

| Decision | Rationale | Files |
|----------|-----------|-------|
| Single smoke test script covers end-to-end flows | One command validates the most critical paths after deploy. | `scripts/smoke-test.mjs` |
| Smoke test uses real server + DB | Catches integration issues that unit tests miss. | `package.json` `npm run smoke` |
| TypeScript type checking without unit tests | `tsc --noEmit` catches type regressions; vitest available but not heavily used. | `npm run typecheck`, `npm run test` |
| Admin-only flows are conditional in smoke | `SMOKE_ADMIN_EMAIL` / `SMOKE_ADMIN_PASSWORD` enable account-recovery approval branch. | `scripts/smoke-test.mjs` |

---

## 13. Deployment & Environment

| Decision | Rationale | Files |
|----------|-----------|-------|
| Railway for backend | Env-based config, easy SQLite persistence with disk mount. | `railway.json`, `.github/workflows/deploy-backend.yml` |
| Cloudflare Pages for frontend | Static build from `dist/`; `VITE_API_URL` points to Railway. | `.github/workflows/deploy-frontend.yml` |
| Environment variables for secrets | `JWT_SECRET`, provider tokens, DB path never committed. | `.env.example` |
| SQLite path configurable via `SQLITE_PATH` | Production can mount `/data` and set `SQLITE_PATH=/data/db.sqlite`. | `backend/src/db.js` |
| Postgres migration noted as future work | Current DB layer is synchronous; migrating to `pg` requires async refactor. | `docs/AI-HANDOVER-2026-08-02.md` |

---

## 14. Known Trade-offs & Technical Debt

| # | Decision / Debt | Impact | Mitigation |
|---|-----------------|--------|------------|
| 14.1 | All channel live APIs are scaffolds except WhatsApp | TikTok/X/Instagram sending requires real credentials and approval. | Dev simulators allow full smoke testing; provider env vars enable live paths. |
| 14.2 | Workers run in-process | Single point of failure; no horizontal scaling. | Acceptable for MVP; can migrate to Bull/Redis later. |
| 14.3 | Campaign scheduler creates tasks, not direct messages | Agents must manually send each step. | Safer default; auto-send toggle can be added. |
| 14.4 | No native mobile app / push notifications | In-app + email/WhatsApp only. | Web push can be added later. |
| 14.5 | Frontend bundle is large | Slower initial load. | Code-splitting with dynamic imports is recommended. |
| 14.6 | RBAC is partially ad-hoc | Some endpoints use inline checks rather than middleware. | Audit endpoints use middleware; legacy endpoints can be refactored incrementally. |
| 14.7 | Appointment reminder customization is hardcoded | `VIEWING_REMINDER_LEAD_MINUTES` and `VIEWING_NO_SHOW_GRACE_MINUTES` are global. | New user requirement: add per-agent/agency reminder policy. |
| 14.8 | Property CTAs are not explicitly surfaced | Contact/viewing/booking flows exist but not as dedicated CTA buttons. | New user requirement: add configurable CTA buttons on property detail. |

---

## 15. New Requirements Captured (Not Yet Implemented)

| # | Requirement | Proposed Design | Files to Touch |
|---|-------------|-----------------|----------------|
| 15.1 | Property detail CTA buttons: Contact, Schedule call, Book viewing | Add buttons in `PropertyDetailPage.tsx`; route to inquiry/task creation. | `src/pages/PropertyDetailPage.tsx`, `src/api/client.ts` |
| 15.2 | Agent/agency configurable CTA visibility | Add `cta_config` to `agents`/`agencies` table; backend filters returned CTAs. | `backend/src/server.js`, frontend property detail |
| 15.3 | Direct-to-agent vs. platform-routed contact | Add `contact_mode` flag; if `platform_routed`, backend sends auto-reply and forwards. | `backend/src/server.js` inquiry handling, `lib/notifications/*.js` |
| 15.4 | "More from this agent" / "More from this agency" CTAs | Reuse existing portfolio/agency pages; add labeled buttons. | `src/pages/PropertyDetailPage.tsx` |
| 15.5 | Customizable appointment reminders | Add `reminder_policies` collection with rules per appointment type, channel, and timing. | `backend/src/campaigns.js` or new module, `server.js` viewing automation |
| 15.6 | Reminder channels: email, WhatsApp, in-app | Dispatch reminders via orchestrator instead of only creating notifications. | `backend/src/server.js` `runViewingAutomation` |

---

## 16. How to Audit Consistency

1. For each feature in `docs/feature-capability-audit.md`, trace the backend endpoint in `server.js` and confirm it exists and is wired.
2. Check that every backend function mentioned in this doc is actually imported and used in `server.js`.
3. Verify dispatcher signatures in `lib/notifications/*.js` match what `orchestrator.js` expects.
4. Confirm smoke test assertions in `scripts/smoke-test.mjs` cover the claimed behavior.
5. Run `npm run typecheck`, `npm run smoke`, `npm run build` and expect all three to pass.
6. Review `.env.example` to ensure every required env variable is documented.

---

## 17. Verification Commands

```bash
npm run typecheck
npm run smoke
npm run build
```

Run against a fresh server:

```bash
PORT=3001 node backend/src/server.js
SMOKE_BASE_URL=http://127.0.0.1:3001 npm run smoke
```
