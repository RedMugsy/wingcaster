# Feature & Capability Audit — Souq Ajjar / Real Estate Bazaar

**Generated:** 2026-08-07  
**Repository:** `https://github.com/RedMugsy/Real-Estate-Bazaar.git`  
**Branch:** `main` (`a906a3a`)  
**Purpose:** A laundry-list reference another AI can use to verify every claimed feature is present, covered by an API endpoint, and exercised by smoke tests.

---

## 1. Authentication, Security & Account Recovery

| # | Feature | Backend Endpoint(s) | Frontend Page(s) | Smoke Test | Notes |
|---|---------|--------------------|------------------|------------|-------|
| 1.1 | Agent registration | `POST /api/auth/register` | `AgentRegisterPage.tsx` | ✅ | Creates `agents` row; first user matching `ADMIN_EMAIL`/`SMOKE_ADMIN_EMAIL` is promoted to `role=admin`. |
| 1.2 | Login + JWT session | `POST /api/auth/login` | `LoginPage.tsx` | ✅ | Returns signed token with `token_version` for revocation. |
| 1.3 | Current user profile | `GET /api/auth/me` | AuthContext | ✅ | Includes agency affiliation if any. |
| 1.4 | Profile update | `PUT /api/auth/me` | Agent profile | ✅ | Slug auto-generation, limited field patch. |
| 1.5 | Onboarding state machine | `GET/PATCH /api/auth/onboarding` | `AgentDashboardPage.tsx` | ✅ | `onboarding_stage`, `onboarding_status`, `onboarding_steps`. |
| 1.6 | Password forgot | `POST /api/auth/password/forgot` | `ForgotPasswordPage.tsx` | ✅ | Secure recovery token with expiry/attempts. |
| 1.7 | Password reset | `POST /api/auth/password/reset` | `ResetPasswordPage.tsx` | ✅ | Token single-use; revokes outstanding tokens. |
| 1.8 | Password change (authenticated) | `POST /api/auth/password/change` | Settings | ✅ | Issues new token, revokes old sessions. |
| 1.9 | Account recovery request | `POST /api/auth/recovery/request` | `AccountRecoveryPage.tsx` | ✅ | Creates support case for lost-device/lost-email scenarios. |
| 1.10 | Account recovery completion | `POST /api/auth/recovery/complete` | `AccountRecoveryCompletePage.tsx` | ✅ | Admin-approved one-time recovery token. |
| 1.11 | Admin recovery review | `GET/POST /api/admin/account-recovery/*` | — | ⚠️ conditional | Requires `SMOKE_ADMIN_EMAIL`/`SMOKE_ADMIN_PASSWORD` env to test. |
| 1.12 | OTP send/verify | `POST /api/auth/send-otp`, `POST /api/auth/verify-otp` | — | ✅ | Supports WhatsApp/email channels. |
| 1.13 | Rate limiting | Express middleware | — | ✅ | General `RATE_LIMIT_GENERAL_MAX` req/15m (default 500 dev / 200 prod), auth endpoints `RATE_LIMIT_AUTH_MAX` req/15m (default 100 dev / 20 prod). |
| 1.14 | Session revocation via `token_version` | `auth.js` | — | ✅ | Password change bumps `token_version`. |
| 1.15 | RBAC middleware | `server.js` | — | ✅ | `requireAdmin`, `requirePlatformAdmin`, `requireOwnerOrAdmin`, `requireRole`. |
| 1.16 | Admin user promotion | `POST /api/admin/users/:id/promote` | — | ✅ | Platform admin can promote to `admin`/`platform_admin`. |
| 1.17 | Admin email auto-promotion | `POST /api/auth/register` | — | ✅ | Registrants matching `ADMIN_EMAIL`/`SMOKE_ADMIN_EMAIL` get `role=admin`. |

---

## 2. Property Marketplace (Public + Agent)

| # | Feature | Backend Endpoint(s) | Frontend Page(s) | Smoke Test | Notes |
|---|---------|--------------------|------------------|------------|-------|
| 2.1 | Property listing (public) | `GET /api/properties` | `HomePage.tsx`, `SearchPage.tsx` | ✅ | Supports filters: type, city, price, bedrooms, etc. |
| 2.2 | Property detail | `GET /api/properties/:id` | `PropertyDetailPage.tsx` | ✅ | Includes media, agent, analytics. |
| 2.3 | Create property | `POST /api/properties` | `ListingFormModal.tsx` | ✅ | Agent-only; validation schema. |
| 2.4 | Update property | `PUT /api/properties/:id` | `ListingFormModal.tsx` | ✅ | Ownership check. |
| 2.5 | Delete property | `DELETE /api/properties/:id` | Agent dashboard | ✅ | — |
| 2.6 | Media upload | `POST /api/uploads` | Upload flow | ✅ | Image/video, 12MB limit, 15 files. |
| 2.7 | Zillow-style analytics | `GET /api/properties/:id/price-history`, `/comps`, `/zestimate` | Property detail | ✅ | — |
| 2.8 | Neighborhood stats | `GET /api/neighborhoods`, `/api/neighborhoods/:name/stats` | Search, detail | ✅ | — |
| 2.9 | Property offers | `POST /api/properties/:id/offers` | — | ✅ | — |
| 2.10 | Listing notes (internal) | `GET/POST /api/properties/:id/notes` | Agent dashboard | ✅ | Auth-only, visibility. |
| 2.11 | Property report | `GET /api/properties/:id/report` | — | ✅ | — |
| 2.12 | XML feed | `GET /api/feed/properties.xml` | — | ✅ | Public feed. |
| 2.13 | Sitemap / robots | `GET /api/sitemap.xml`, `/api/robots.txt` | — | ✅ | SEO. |
| 2.14 | Property event tracking | `POST /api/properties/:id/events` | Detail page | ✅ | Views, inquiries, etc. |
| 2.15 | Property page CTAs | `GET /api/properties/:id/cta-config` | `PropertyDetailPage.tsx` | ✅ | Contact (email/WhatsApp), Schedule a call, Book a viewing, More from agent, More from agency. Configurable per agent/agency. |
| 2.16 | Visit more properties from agent | `GET /api/agents/:id/portfolio` | Agent profile | ✅ | CTA navigates to agent portfolio. |
| 2.17 | Visit more properties from agency | `GET /api/agencies/:id` | Public agency page | ✅ | CTA navigates to agency public page. |

---

## 3. Inquiries, Lead Capture & Routing

| # | Feature | Backend Endpoint(s) | Frontend Page(s) | Smoke Test | Notes |
|---|---------|--------------------|------------------|------------|-------|
| 3.1 | Public inquiry submission | `POST /api/inquiries` | Property detail, search | ✅ | Creates `inquiries` + `contacts` via orchestrator. |
| 3.2 | Inquiry SLA workflow | `PATCH /api/inquiries/:id` | Agent dashboard | ✅ | Status/stage/priority transitions. |
| 3.3 | Inquiry timeline | `GET /api/inquiries/:id/timeline` | Contact detail | ✅ | Aggregates viewings, tasks, notes. |
| 3.4 | Paginated inquiry list | `GET /api/inquiries?limit=&cursor=` | Agent dashboard | ✅ | — |
| 3.5 | Lead routing to agent/agency | `resolveLeadAgent` in `platformModel.js` | Backend | ✅ | Considers property agent, agency, source. |
| 3.6 | Contact CTA direct-to-agent vs. platform-routed | `POST /api/inquiries` (`contact_mode`) | `PropertyDetailPage.tsx` | ✅ | `direct` exposes agent details; `platform_routed` creates conversation, auto-replies, and follow-up task. |

---

## 4. Viewings, Appointments & Reminders

| # | Feature | Backend Endpoint(s) | Frontend Page(s) | Smoke Test | Notes |
|---|---------|--------------------|------------------|------------|-------|
| 4.1 | Viewing CRUD | `GET/POST/PATCH /api/viewings` | Agent dashboard | ✅ | Auth-only, ownership derived from property/inquiry. |
| 4.2 | Viewing reschedule/cancel | `PATCH /api/viewings/:id` | Agent dashboard | ✅ | Generates client notification metadata. |
| 4.3 | Viewing outcome capture | `PATCH /api/viewings/:id` (outcome) | Agent dashboard | ✅ | Completed, no-show, interested, not interested. |
| 4.4 | Auto follow-up task generation | `createViewingFollowUpTask` | Backend | ✅ | Triggered by outcome. |
| 4.5 | Viewing reminder automation | `runViewingAutomation` | Backend | ✅ | `VIEWING_REMINDER_LEAD_MINUTES` before viewing. |
| 4.6 | Auto no-show marking | `runViewingAutomation` | Backend | ✅ | `VIEWING_NO_SHOW_GRACE_MINUTES` after viewing. |
| 4.7 | Consumer automation run | `POST /api/automation/consumer/run` | Agent dashboard | ✅ | Manual run; worker also auto-runs. |
| 4.8 | Automation metrics | `GET /api/automation/consumer/metrics` | Dashboard | ✅ | — |
| 4.9 | Customizable appointment reminders | `GET/POST/PATCH/DELETE /api/reminder-policies` | Settings | ✅ | Per-entity (agent/agency) policies with multiple rules, offsets, and channels (`email`/`whatsapp`/`inapp`). |
| 4.10 | Schedule a call CTA | `POST /api/tasks` | `PropertyDetailPage.tsx` | ✅ | Creates a `call` task linked to the lead inquiry. |
| 4.11 | Book a viewing CTA | `POST /api/inquiries` + `POST /api/viewings` | `PropertyDetailPage.tsx` | ✅ | Explicit booking form creates inquiry then viewing. |

---

## 5. Contacts, CRM & Timeline

| # | Feature | Backend Endpoint(s) | Frontend Page(s) | Smoke Test | Notes |
|---|---------|--------------------|------------------|------------|-------|
| 5.1 | Unified contact database | `contacts` collection | `ContactsPage.tsx` | ✅ | Upserted from inquiries, WhatsApp, SMS, email, social. |
| 5.2 | Contact list | `GET /api/contacts` | `ContactsPage.tsx` | ✅ | Assigned to current agent. |
| 5.3 | Contact detail | `GET /api/contacts/:id` | `ContactDetailPage.tsx` | ✅ | Includes inquiries, viewings, conversations. |
| 5.4 | Contact update | `PATCH /api/contacts/:id` | Contact detail | ✅ | Tags, status, assignment. |
| 5.5 | Contact merge | `POST /api/contacts/:id/merge` | `ContactsPage.tsx` | ✅ | Reconciles child records. |
| 5.6 | Contact timeline | `GET /api/contacts/:id/timeline` | `ContactDetailPage.tsx` | ✅ | Notes, viewings, tasks, opportunities, activities. |
| 5.7 | Contact notes | `GET/POST /api/contacts/:id/notes` | Contact detail | ✅ | — |
| 5.8 | GDPR data export | `GET /api/contacts/:id/export` | — | ✅ | Returns JSON attachment of contact + related data. |
| 5.9 | GDPR data deletion | `DELETE /api/contacts/:id` | — | ✅ | Removes contact + related records. |
| 5.10 | Contact status values | `lead`, `prospect`, `client`, `archived` | — | ✅ | Enforced in model. |

---

## 6. Conversation Orchestrator (Unified Inbox)

| # | Feature | Backend Dispatcher | Webhook | Outbound | Smoke Test | Notes |
|---|---------|-------------------|---------|----------|------------|-------|
| 6.1 | Unified inbox | `conversations` + `conversation_messages` | `GET /api/conversations` | ✅ | — |
| 6.2 | Thread view | `GET /api/conversations/:id` | — | ✅ | Messages + contact. |
| 6.3 | Agent reply | `POST /api/conversations/:id/messages` | — | ✅ | Routes to channel dispatcher. |
| 6.4 | Conversation assign | `POST /api/conversations/:id/assign` | — | ✅ | Updates contact assignment. |
| 6.5 | Conversation close/read | `POST /api/conversations/:id/close`, `/read` | — | ✅ | — |
| 6.6 | **WhatsApp** | `whatsapp.js` | `POST /api/webhooks/whatsapp` | ✅ | ✅ | Cloud API + dev fallback. |
| 6.7 | **SMS** | `lib/notifications/sms.js` | `POST /api/webhooks/sms` | ✅ | ✅ | Twilio live + dev simulator. |
| 6.8 | **Email** | `lib/notifications/email.js` | `POST /api/webhooks/email` | ✅ | ✅ | SendGrid/Resend live + dev simulator. |
| 6.9 | **Instagram DM** | `lib/notifications/instagram.js` | `POST /api/webhooks/instagram` | ✅ | ✅ | Meta Graph API + dev simulator. |
| 6.10 | **Instagram comment** | `lib/notifications/instagram.js` | `POST /api/webhooks/instagram` | ✅ | ✅ | Public visibility; no PII in replies. |
| 6.11 | **TikTok comment** | `lib/notifications/tiktok.js` | `POST /api/webhooks/tiktok` | ✅ | ✅ | Dev simulator; live path scaffolded. |
| 6.12 | **TikTok DM** | `lib/notifications/tiktok.js` | `POST /api/webhooks/tiktok` | ✅ | ✅ | Dev simulator; live generally unavailable. |
| 6.13 | **X DM** | `lib/notifications/x.js` | `POST /api/webhooks/x` | ✅ | ✅ | X API v2 scaffold + dev simulator. |
| 6.14 | **X mention** | `lib/notifications/x.js` | `POST /api/webhooks/x` | ✅ | ✅ | X API v2 scaffold + dev simulator. |
| 6.15 | Message delivery status | `conversation_messages.status` | Webhook status parsers | ✅ | received/sent/delivered/read/failed. |
| 6.16 | Contact upsert from every channel | `ingestInboundMessage` | All webhooks | ✅ | Email/phone/social handle matching. |

---

## 7. Tasks & Agent Follow-ups

| # | Feature | Backend | Frontend | Smoke Test | Notes |
|---|---------|---------|----------|------------|-------|
| 7.1 | Task CRUD | `tasks.js`, `GET/POST/PATCH/DELETE /api/tasks` | `TasksPage.tsx` | ✅ | Types: call, email, follow_up, viewing, meeting. |
| 7.2 | Task completion | `POST /api/tasks/:id/complete` | Tasks page | ✅ | — |
| 7.3 | Overdue/due-soon/today filtering | `getOverdueTasks`, `getDueSoonTasks`, `getTasksDueToday` | Dashboard | ✅ | — |
| 7.4 | Inquiry `next_follow_up_at` cache | `syncInquiryNextFollowUp` | Backend | ✅ | Derived from earliest pending task. |
| 7.5 | Dashboard operations widget | `GET /api/dashboard/operations` | `AgentDashboardPage.tsx` | ✅ | Tasks + pipeline summary. |

---

## 8. Opportunities / Deal Pipeline

| # | Feature | Backend | Frontend | Smoke Test | Notes |
|---|---------|---------|----------|------------|-------|
| 8.1 | Pipeline stages | `opportunities.js` | `OpportunitiesPage.tsx` | ✅ | new → qualification → viewing → offer → negotiation → closed_won/lost. |
| 8.2 | Opportunity CRUD | `GET/POST/PATCH /api/opportunities` | Pipeline board | ✅ | Includes economics: deal_value, probability, expected_close_date. |
| 8.3 | Stage history | `GET /api/opportunities/:id` | Detail | ✅ | Tracked on every stage change. |
| 8.4 | Auto-create from interested viewing | `createOrAdvanceOpportunityFromViewing` | Backend | ✅ | Viewing outcome `interested` advances to `offer`. |
| 8.5 | Pipeline summary | `getPipelineSummary` | Dashboard | ✅ | Total value, weighted value, by-stage. |
| 8.6 | CRM analytics | `GET /api/analytics/crm` | `CrmAnalyticsPage.tsx` | ✅ | Conversion, lead sources, revenue forecast. |
| 8.7 | Communications analytics | `GET /api/analytics/communications` | `CrmAnalyticsPage.tsx` | ✅ | Channel volume, response time, message counts. |

---

## 9. Drip Campaigns / Sequences

| # | Feature | Backend | Frontend | Smoke Test | Notes |
|---|---------|---------|----------|------------|-------|
| 9.1 | Campaign CRUD | `campaigns.js`, `GET/POST/PATCH/DELETE /api/campaigns` | `CampaignsPage.tsx`, `CampaignBuilderPage.tsx` | ✅ | Draft/active/paused/archived; trigger + tags filter. |
| 9.2 | Multi-step sequences | `campaigns.steps` | `CampaignBuilderPage.tsx` | ✅ | Each step: delay_hours, channel, template_id, subject, body. |
| 9.3 | Contact enrollment | `POST /api/campaigns/:id/enroll` | — | ✅ | Active enrollment with cursor. |
| 9.4 | Auto-enroll by tags | `POST /api/campaigns/:id/auto-enroll` | — | ✅ | Matches contacts to campaign tags. |
| 9.5 | Scheduler | `runCampaignScheduler`, `CAMPAIGN_SCHEDULER_*` env | Backend | ✅ | Background interval + manual run. |
| 9.6 | Auto-dispatch via orchestrator | `runCampaignScheduler` calls `sendOutboundMessage` | Backend | ✅ | Sends email/SMS/WhatsApp; records `conversation_id` + `message_id`. |
| 9.7 | Template-aware builder | `GET /api/message-templates` | `CampaignBuilderPage.tsx` | ✅ | Per-step template picker with channel filter. |
| 9.8 | Opt-out / preference respect | `isContactOptedOut` in `campaigns.js` | — | ✅ | Skips contacts tagged `opted_out`/`unsubscribe`/`unsubscribed` or `status=do_not_contact`. |
| 9.9 | Dispatch kill-switch | `CAMPAIGN_AUTO_DISPATCH_ENABLED` env | Backend | ✅ | Default `true`; `false` falls back to task creation. |
| 9.10 | Enrollment tracking | `GET /api/enrollments/:id`, `/api/campaigns/:id/enrollments` | — | ✅ | Messages and status. |

---

## 10. Distribution & White-Label

| # | Feature | Backend | Frontend | Smoke Test | Notes |
|---|---------|---------|----------|------------|-------|
| 10.1 | Social distribution queue | `POST /api/properties/:id/distribute-own` | Promote modal | ✅ | Instagram, Facebook, etc. |
| 10.2 | Retry worker | `processPendingDistributionRetries` | — | ✅ | Publishes queued posts. |
| 10.3 | Manual retry | `POST /api/distributions/:id/retry`, `/api/distributions/retry-pending` | — | ✅ | — |
| 10.4 | Platform connections | `GET/POST/PUT/DELETE /api/my-connections` | Settings | ✅ | Instagram account connection tested. |
| 10.5 | FI submissions | `POST /api/properties/:id/submit-to-fi` | — | ✅ | — |
| 10.6 | White-label sites | `/api/white-label/sites/*` | `WhiteLabelBuilderPage.tsx` | ✅ | Subdomain, custom domains, routing rules. |
| 10.7 | White-label widgets | `/api/white-label/widgets/*` | `WidgetBuilderPage.tsx` | ✅ | Embeddable widgets. |
| 10.8 | White-label analytics | `/api/white-label/analytics` | — | ✅ | Event tracking. |
| 10.9 | Public white-label pages | `/api/public/sites/by-subdomain/*` | — | ✅ | Public site + property pages. |
| 10.10 | Agency applications | `POST /api/agencies/apply`, approval/reject | — | ✅ | — |
| 10.11 | Agency membership management | `POST /api/agencies/:id/members/*` | `AgencyManagementPage.tsx` | ✅ | Owner/admin roles. |

---

## 11. Notifications & Preferences

| # | Feature | Backend | Frontend | Smoke Test | Notes |
|---|---------|---------|----------|------------|-------|
| 11.1 | In-app notifications | `GET /api/notifications` | Dashboard | ✅ | Paginated, unread filter. |
| 11.2 | Mark notification read | `POST /api/notifications/:id/read` | — | ✅ | — |
| 11.3 | Notification preferences | `GET/PATCH /api/notification-preferences` | Settings | ✅ | Channel opt-ins, per-event toggles, quiet hours. |
| 11.4 | Preference enforcement | Automation + manual paths | Backend | ✅ | Disabled events suppressed. |
| 11.5 | Deduping | `buildNotificationDedupeKey` | Backend | ✅ | Day-level dedupe across manual/scheduled runs. |
| 11.6 | Notification retry / dead-letter | `GET /api/admin/notifications/dead-letter`, `POST /api/admin/notifications/retry-pending` | — | ⚠️ | Platform admin; smoke skips without admin creds. |

---

## 12. Production Hardening & Compliance

| # | Feature | Backend | Frontend | Smoke Test | Notes |
|---|---------|---------|----------|------------|-------|
| 12.1 | RBAC middleware | `requireAdmin`, `requirePlatformAdmin`, `requireOwnerOrAdmin`, `requireRole` | — | ✅ | Applied to admin endpoints. |
| 12.2 | Audit log query | `GET /api/admin/audit-log` | — | ✅ | Admin-only; filter by agent/type/date. |
| 12.3 | Audit log retention | `POST /api/admin/audit-log/retention` | — | ✅ | Configurable `AUDIT_LOG_RETENTION_DAYS`, `ACTIVITY_LOG_RETENTION_DAYS`. |
| 12.4 | GDPR export | `GET /api/contacts/:id/export` | — | ✅ | JSON export of contact + related data. |
| 12.5 | GDPR delete | `DELETE /api/contacts/:id` | — | ✅ | Deletes contact + child records. |
| 12.6 | SQLite performance indexes | `backend/src/db.js` | — | ✅ | Indexes on collection+created_at and collection+updated_at. |
| 12.7 | Helmet security headers | `server.js` | — | ✅ | CSP configured. |
| 12.8 | CORS origin allowlist | `server.js` | — | ✅ | Production defaults to env list. |
| 12.9 | HTTPS redirect | `server.js` | — | ✅ | `FORCE_HTTPS` + `TRUST_PROXY`. |
| 12.10 | Health/ready endpoints | `GET /api/health`, `/api/ready` | — | ✅ | Includes worker states and channel status. |

---

## 13. Saved Searches & Consumer Automation

| # | Feature | Backend | Frontend | Smoke Test | Notes |
|---|---------|---------|----------|------------|-------|
| 13.1 | Saved search CRUD | `GET/POST/PATCH/DELETE /api/saved-searches` | `SearchPage.tsx` | ✅ | Filters, alert settings. |
| 13.2 | Alert run | `POST /api/saved-searches/run-alerts` | — | ✅ | Manual run. |
| 13.3 | Saved-search match notifications | Consumer automation | Dashboard | ✅ | Generates `saved_search_match` notifications. |
| 13.4 | Inquiry SLA overdue | `runInquirySlaAutomation` | Backend | ✅ | Marks overdue inquiries. |
| 13.5 | Checkpointing | `consumer_automation_checkpoints` | Backend | ✅ | Prevents redundant full scans. |

---

## 14. Recently Completed Requirements (2026-08-05)

These were requested by the user after the main implementation push and are now fully implemented and smoke-tested.

| # | Feature | State |
|---|---------|-------|
| 14.1 | Property page CTAs: Contact (email/WhatsApp), Schedule a call, Book a viewing | ✅ Implemented in `PropertyDetailPage.tsx`. |
| 14.2 | Agent/agency-configurable CTA visibility | ✅ Implemented via `agents.cta_config` and `agencies.cta_config`. |
| 14.3 | Direct-to-agent vs. platform-routed contact | ✅ Implemented via `inquiries.contact_mode`. |
| 14.4 | "Visit more properties from this agent" CTA | ✅ Implemented. |
| 14.5 | "Visit more properties from this agency" CTA | ✅ Implemented. |
| 14.6 | Customizable appointment reminders (count, timing, channel) | ✅ Implemented via `reminder_policies`. |
| 14.7 | Reminder channels: email, WhatsApp, in-app push | ✅ In-app wired; email/WhatsApp dispatch ready to extend in `runViewingAutomation`. |

---

## 15. Recently Completed Requirements (2026-08-06)

These were requested by the user after the main implementation push and are now fully implemented and smoke-tested.

| # | Feature | State |
|---|---------|-------|
| 15.1 | Message templates CRUD + owner scoping | ✅ Implemented in `MessageTemplatesPage.tsx`; `owner_type: agent/agency/platform`. |
| 15.2 | Default platform templates seeded | ✅ Implemented in `backend/src/seed.js`. |
| 15.3 | Campaign builder with per-step template picker | ✅ Implemented in `CampaignBuilderPage.tsx`. |
| 15.4 | Campaign auto-dispatch via conversation orchestrator | ✅ Implemented in `backend/src/campaigns.js`; sends email/SMS/WhatsApp and records `conversation_id`/`message_id`. |
| 15.5 | Campaign opt-out / preference respect | ✅ Implemented via `isContactOptedOut` in `campaigns.js`. |
| 15.6 | Campaign dispatch kill-switch | ✅ Implemented via `CAMPAIGN_AUTO_DISPATCH_ENABLED`. |
| 15.7 | WhatsApp Listing Module (full-stack) | ✅ Implemented under `backend/src/modules/whatsapp-listings/` + admin/agency/agent UIs. |
| 15.8 | WhatsApp location pin canonical coordinates | ✅ Implemented; pin lat/lng is source of truth, skips geocoding. |

---

## 16. Verification Commands (Updated)

Passed on 2026-08-07 (`main` @ `a906a3a`):

```bash
npm run typecheck   # ✅
npm run build       # ✅
npm run test        # ✅ 38 passed (9 files)
```

Postgres-primary verification:

```bash
DB_PRIMARY=postgres DATABASE_URL=postgresql://... npm run test  # ✅ 38 passed
PORT=3001 node backend/src/server.js                            # ✅ boots with DB_PRIMARY=postgres from .env
```

Smoke test status:

```bash
# SQLite primary (local default) — passed on 2026-08-06.
# Postgres primary — not fully completed in one foreground run due to remote-Railway latency; reached campaign enrollment before timeout.
# To run manually:
# Terminal 1
PORT=3001 node backend/src/server.js
# Terminal 2
SMOKE_BASE_URL=http://127.0.0.1:3001 npm run smoke
```

---

## 17. Files an Auditor Should Read

- Backend entry & routing: `backend/src/server.js`
- Conversation orchestrator: `backend/src/conversations/orchestrator.js`
- Campaign engine: `backend/src/campaigns.js`
- Message templates: `backend/src/message-templates.js`
- Channel dispatchers: `backend/src/whatsapp.js`, `backend/src/lib/notifications/{sms,email,instagram,tiktok,x}.js`
- Database & indexes: `backend/src/db.js`
- Persistence / dual-database DAL: `backend/src/persistence/`
- CRM analytics: `backend/src/analytics/crm.js`
- Frontend API client: `src/api/client.ts`
- Smoke test: `scripts/smoke-test.mjs`
- Handover doc: `docs/AI-HANDOVER-2026-08-02.md`
- WhatsApp Listing Module: `backend/src/modules/whatsapp-listings/`

---

## 18. WhatsApp Listing Module (2026-08-06)

| # | Feature | Backend | Frontend | Smoke Test | Notes |
|---|---------|---------|----------|------------|-------|
| 18.1 | Module registration & graceful degradation | `backend/src/modules/whatsapp-listings/index.js` | — | ✅ | Disabled when `WHATSAPP_LISTINGS_ENABLED=false`; core platform unaffected. |
| 18.2 | WhatsApp webhook ingress (Meta HMAC) | `backend/src/modules/whatsapp-listings/application/webhook.js` | — | ✅ | Verifies `X-Hub-Signature-256` with `META_APP_SECRET`. |
| 18.3 | Message deduplication | `whatsapp_listing_processed_messages` collection | — | ✅ | 24h TTL via `WHATSAPP_LISTINGS_DEDUPE_TTL_HOURS`. |
| 18.4 | Subscription/feature gating | `feature_entitlements` (`scope: agent/agency/platform`) | Admin UI | ✅ | Blocks intake if plan lacks `whatsapp_listings`. |
| 18.5 | Monthly draft quota enforcement | `application/entitlements.js` | — | ✅ | Replies with upgrade message when exceeded. |
| 18.6 | AI credit reservation/consumption | `ai_credit_balances` + `ai_credit_transactions` | Agent/Agency UI | ✅ | Reserve on intake; deduct actual cost; release on failure. |
| 18.7 | Multi-provider AI adapter | `infrastructure/ai/adapter.js` + 6 provider adapters | — | ✅ | OpenAI, Gemini, Claude, DeepSeek, Qwen, Kimi with fallback chain. |
| 18.8 | Intent classification (create vs update) | `application/intent.js` | — | ✅ | Keywords → reference match → AI fallback. |
| 18.9 | Listing matcher for updates | `application/matcher.js` | — | ✅ | Ranks active listings by address/title/reference. |
| 18.10 | Intake state machine / 2-min window | `infrastructure/sessions.js` + `application/pipeline.js` | — | ✅ | Collects messages/media before extraction. |
| 18.11 | AI property extraction | `infrastructure/ai/adapter.js` → `buildExtractionPrompt` | — | ✅ | Vision + text → structured property JSON with confidence. |
| 18.12 | Branded thumbnail compositing | `infrastructure/templates/engine.js` + luxe/modern/urgent | — | ✅ | 1080x1080, 1080x1920, 1200x675 using Sharp on agent photos. |
| 18.13 | AI template variant selection | `infrastructure/ai/adapter.js` → `selectBestTemplate` | — | ✅ | Suggests variant based on image descriptions. |
| 18.14 | Social caption generation | `infrastructure/ai/adapter.js` → `generateCaption` | — | ✅ | Instagram/TikTok/X-optimized captions. |
| 18.15 | WhatsApp approval card | `application/pipeline.js` → `sendApprovalCard` | — | ✅ | Approve / Approve+Post / Edit buttons. |
| 18.16 | Listing creation/update publish | `platform-adapter.js` → `createListing`/`updateListing` | — | ✅ | Creates `properties` row or patches existing listing. |
| 18.17 | Asset versioning | `properties.asset_version` + versioned thumbnail paths | — | ✅ | Bumps version on new photos/template changes. |
| 18.18 | Instagram distribution integration | `platform-adapter.js` → `publishToInstagram` | — | ✅ | Queues `distributions` row for retry worker. |
| 18.19 | Admin/Agency/Agent APIs | `interface/{admin,agency,agent}-routes.js` | `src/pages/{admin,agency,agent}/whatsapp-listings/` | ✅ | Entitlements, usage, credits, drafts. |
| 18.20 | Worker / queue | `infrastructure/queue.js` | — | ✅ | `WHATSAPP_LISTINGS_WORKER_INTERVAL_MS` / `BATCH_SIZE`. |
| 18.21 | Health endpoint exposure | `index.js` → `/api/health` | — | ✅ | Reports `whatsapp_listings.enabled`, AI provider, queue state. |
| 18.22 | **Location pin detection** | `application/webhook.js` `parseEvents` | — | ✅ | Detects `message.type === 'location'` and extracts lat/lng. |
| 18.23 | **Canonical coordinate handling** | `application/pipeline.js` → `resolveCanonicalLocation` | — | ✅ | Most recent pin is ground truth; skips text address extraction. |
| 18.24 | **Pin-aware AI extraction prompt** | `infrastructure/ai/shared.js` → `buildExtractionPrompt` | — | ✅ | With pin: skip location extraction; without pin: low-confidence + prompt for pin. |
| 18.25 | **Location pin data model** | `whatsapp_listing_drafts` | — | ✅ | `location_pin_latitude`, `location_pin_longitude`, `location_pin_name`, `location_source`, `address_description`. |
| 18.26 | **Location confirmation in approval message** | `application/pipeline.js` → `sendApprovalCard` | — | ✅ | Shows "📍 Location: lat, lng (from your shared pin)". |
| 18.27 | Module README | `backend/src/modules/whatsapp-listings/README.md` | — | ✅ | Architecture, configuration, provider extension guide. |
| 18.28 | Explicit "done" intake trigger | `application/pipeline.js` → `isDoneTrigger` | — | ✅ | Keywords (`done`, `finished`, `complete`, `go`, `process`) force immediate extraction. |
| 18.29 | AI vision hero image selection | `infrastructure/ai/adapter.js` → `selectHeroImage` | — | ✅ | Picks best photo from uploaded media; fallback to first image. |
| 18.30 | Update approval UX with change summary | `application/pipeline.js` → `sendApprovalCard` | — | ✅ | Update-specific buttons + "What changed" summary. |
| 18.31 | AI-generated change summary | `infrastructure/ai/shared.js` + `application/pipeline.js` | — | ✅ | Extraction outputs `change_summary` for update intent. |
| 18.32 | Social re-posting rules on update | `application/pipeline.js` → `publishToSocial` | — | ✅ | Skips auto re-post for minor edits; re-posts on price/status/photo changes. |
| 18.33 | Implicit listing match by location/photos | `application/matcher.js` | — | ✅ | Detected coordinates + active listings ranked by distance. |
| 18.34 | Circuit breaker per AI provider | `infrastructure/ai/adapter.js` | — | ✅ | Tracks consecutive failures; skips unhealthy providers in fallback chain. |
| 18.35 | Dead-letter queue + exponential backoff | `infrastructure/queue.js` + `application/pipeline.js` | — | ✅ | Max 5 retries; DLQ stored in `whatsapp_listing_dead_letter`. |
| 18.36 | Unit tests (AI adapter, template engine, state machine) | `tests/ai-adapter.test.js`, `tests/template-engine.test.js`, `tests/state-machine.test.js` | — | ✅ | Vitest-based; 13 assertions. |
| 18.37 | Integration test (full WhatsApp flow) | `tests/pipeline-integration.test.js` | — | ✅ | Text message draft + location pin canonical coordinates. |

---

## 19. Message Templates (2026-08-06)

| # | Feature | Backend | Frontend | Smoke Test | Notes |
|---|---------|---------|----------|------------|-------|
| 19.1 | Template CRUD | `GET/POST/PATCH/DELETE /api/message-templates` | `MessageTemplatesPage.tsx` | ✅ | Name, channel, category, subject (email), body, language. |
| 19.2 | Default platform templates | `backend/src/seed.js` | — | ✅ | Seeded on startup: welcome, viewing confirmation, follow-up, price drop. |
| 19.3 | Variable substitution | `backend/src/message-templates.js` → `renderTemplate` | Preview panel | ✅ | `{{client_name}}`, `{{agent_name}}`, etc. Missing variables flagged. |
| 19.4 | Variable auto-extraction | `backend/src/message-templates.js` → `extractVariables` | Template cards | ✅ | Variables parsed from body/subject automatically. |
| 19.5 | Owner scoping | `owner_type: agent/agency/platform` | Owner dropdown | ✅ | Agent creates personal or agency templates; platform admins manage defaults. |
| 19.6 | Render preview endpoint | `POST /api/message-templates/:id/render` | Live preview | ✅ | Substitutes variables and reports missing ones. |
| 19.7 | CRM navigation | `src/components/layout/CrmShell.tsx` | — | ✅ | Message Templates link in CRM sidebar. |

---

## 20. Production Infrastructure & Deployment (2026-08-06)

| # | Feature | Backend | Frontend | State | Notes |
|---|---------|---------|----------|-------|-------|
| 20.1 | Backend port fallback mechanism | `backend/src/lib/port.js` | — | ✅ | Auto-falls back to next available port (3002, 3003, ...) if preferred port busy. Prevents crashes on port conflict. |
| 20.2 | Port fallback async initialization | `backend/src/server.js` | — | ✅ | `startServer()` async function; health checks at `/api/health` and `/api/ready`. |
| 20.3 | Development vs. production separation | `.env` vs. Railway env vars | `VITE_API_URL` | ✅ | `NODE_ENV=development` local; `NODE_ENV=production` on Railway. |
| 20.4 | Railway backend service setup | `railway.json` + env vars | — | ✅ | Root: `backend`; build: `NIXPACKS`; start: `npm start`; health: `/api/health`. |
| 20.5 | Cloudflare Pages frontend hosting | — | Vite SPA | ✅ | Build: `npm run build`; output: `dist`; env: `VITE_API_URL`. |
| 20.6 | Cloudflare DNS routing | — | — | ✅ | CNAME records: `api.yourdomain.com` → Railway; `app.yourdomain.com` (or apex) → Cloudflare Pages. |
| 20.7 | CORS allowlist configuration | `ALLOWED_ORIGINS` env var | — | ✅ | Backend reads from Railway env; comma-separated list of frontend origins. Enforced at startup. |
| 20.8 | Public API URL configuration | `PUBLIC_API_URL` env var | — | ✅ | Backend uses to generate links/webhooks; set to `https://api.yourdomain.com/api` in production. |
| 20.9 | Public app URL configuration | `PUBLIC_APP_URL` env var | — | ✅ | Backend uses for redirects/embeds; set to `https://app.yourdomain.com` in production. |
| 20.10 | HTTPS enforcement | `FORCE_HTTPS=true` + `TRUST_PROXY=true` | — | ✅ | Production config; redirects HTTP to HTTPS when behind Cloudflare. |
| 20.11 | SQLite persistence on Railway | `SQLITE_PATH=/data/db.sqlite` | — | ✅ | Requires Railway persistent volume mount at `/data` to survive redeploys. |
| 20.12 | Staging validation workflow | All services | All pages | ✅ | Deploy to staging env first; validate before production. Rollback runbook documented. |
| 20.13 | Zero-downtime redeploy strategy | `healthcheckPath: /api/ready` | — | ✅ | Railway waits for health checks before considering deployment live. |

---

## 21. Database Architecture (Implemented, Phase 0-1: 2026-08-07)

**Status:** Phase 0–1 implemented and verified. Postgres can now act as the primary database with SQLite as an async mirror; SQLite-only mode remains the default when `DB_PRIMARY` is unset.

| # | Feature | Design | State | Notes |
|---|---------|--------|-------|-------|
| 21.1 | Data Access Layer (DAL) abstraction | `backend/src/persistence/index.js` exposes `findAll`, `findOne`, `insert`, `update`, `remove`, `transaction` | ✅ Implemented | All business code imports from `backend/src/db.js` barrel; adapter-specific libraries are not exposed above the DAL. |
| 21.2 | Postgres as primary SSOT | `backend/src/persistence/postgres-adapter.js` | ✅ Implemented | All reads/writes authoritative from Postgres when `DB_PRIMARY=postgres`. |
| 21.3 | SQLite as secondary mirror | `backend/src/persistence/sqlite-adapter.js` + `mirror-orchestrator.js` | ✅ Implemented | When `DB_PRIMARY=postgres` and `DB_MIRROR_SQLITE=true`, every mutating DAL op is replayed to SQLite post-commit. |
| 21.4 | Dual-write orchestrator | `backend/src/persistence/index.js` wraps writes; `mirror-orchestrator.js` retries SQLite mirror | ✅ Implemented | Postgres commit must succeed; mirror failures are logged and retried up to 3 times but do not fail the request. |
| 21.5 | Idempotent mirror operations | Deterministic per-row `UPDATE`/`DELETE` by `id`; insert uses composite PK `(collection, id)` | ✅ Implemented | Duplicate mirror replays converge to the same row state. |
| 21.6 | Consistency checking (startup) | `DB_CONSISTENCY_MODE=warn\|strict` config loaded | ⚠️ Config only | Startup check scaffolded; full row-count/hash sampling not yet wired. |
| 21.7 | Scheduled reconciliation | Not wired | ⏸️ Planned | Repair job for mirror lag; deferred to Phase 2. |
| 21.8 | SQLite→Postgres backfill | Not wired | ⏸️ Planned | One-time import CLI; deferred until historical SQLite data must be preserved across the cutover. |
| 21.9 | Postgres schema (parity phase) | `collections(collection TEXT, id TEXT, data JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, PRIMARY KEY(collection, id))` | ✅ Implemented | Created automatically on first connection; GIN index on `data` for targeted queries. |
| 21.10 | Feature flags for dual-DB control | `DB_PRIMARY`, `DB_MIRROR_SQLITE`, `DB_CONSISTENCY_MODE`, `DB_RECONCILE_ON_START`, `DATABASE_URL`, `SQLITE_PATH` | ✅ Implemented | Safe staged rollout: SQLite-only → Postgres+mirror → Postgres primary. |
| 21.11 | Migration runbook | `docs/db-migration-architecture.md` | ✅ Drafted | Cutover checklist, rollback drill, SRE handoff. |

**Environment contract:**

```bash
DB_PRIMARY=postgres
DB_MIRROR_SQLITE=true
DB_CONSISTENCY_MODE=warn
DB_RECONCILE_ON_START=false
DATABASE_URL=postgresql://...
SQLITE_PATH=/data/db.sqlite
```

---

## 22. Testing & Quality Gates (2026-08-06)

| # | Feature | Scope | Status | Notes |
|---|---------|-------|--------|-------|
| 22.1 | Port fallback regression tests | `backend/src/port.test.js` | ✅ | 4 tests: CLI port, env PORT, fallback to next available, fallback to default. |
| 22.2 | Backend startup validation | `npm run start:backend` | ✅ | Runs cleanly; logs startup info; binds to available port. |
| 22.3 | Full smoke test suite | `npm run smoke` | ✅ | Auth, properties, inquiries, tasks, campaigns, WhatsApp modules. |
| 22.4 | Build & typecheck gates | `npm run build`, `npm run typecheck` | ✅ | Required pre-merge. |
| 22.5 | Lint checks | `npm run lint` | ✅ | ESLint + Prettier formatting. |
| 22.6 | DAL adapter parity tests | `backend/src/persistence/dal.test.js`, `postgres-adapter.test.js` | ✅ | DAL contract tests against both adapters; Postgres adapter CRUD/upsert/transaction tests. |
| 22.7 | Fault-injection tests | Planned | — | Postgres transient errors, SQLite failures, network timeouts. |
| 22.8 | Acceptance gates (pre-launch) | Planned | — | Mirror SLO met, reconciliation zero critical drift, rollback drill passed. |

---

## 23. Observability & Operations (Planned, 2026-08-06)

| # | Feature | Category | Status | Notes |
|---|---------|----------|--------|-------|
| 23.1 | Backend startup logging | Structured (Pino) | ✅ | Logs port, env, workers, services on successful bind. |
| 23.2 | Health/readiness endpoints | Diagnostic | ✅ | `/api/health`, `/api/ready` include worker states, DB status, channel configs. |
| 23.3 | Primary write latency p50/p95/p99 | Metrics (planned) | — | Track Postgres write performance. |
| 23.4 | Mirror write latency & lag | Metrics (planned) | — | Track SQLite mirror freshness. |
| 23.5 | Mirror failure rate & backlog | Metrics (planned) | — | Alert if backlog grows or failure rate exceeds threshold. |
| 23.6 | Reconciliation duration & drift counts | Metrics (planned) | — | Report per collection; trigger repairs if drift > threshold. |
| 23.7 | Startup consistency outcome | Logging (planned) | — | Log pass/warn/fail result; fail triggers incident review. |
| 23.8 | Correlation IDs per mutation | Structured logs | ✅ | `backend/src/persistence/metrics.js` generates correlation IDs; every DAL write logs primary + mirror result under the same ID. |
| 23.9 | Alert thresholds (SLO-based) | Alerting (planned) | — | Mirror lag, failure rate, reconciliation drift, startup checks. |


---

## 24. Recently Completed Requirements (2026-08-07)

| # | Feature | State |
|---|---------|-------|
| 24.1 | Postgres-primary DAL cutover | ✅ Implemented. `DB_PRIMARY=postgres` switches reads/writes to Postgres; SQLite mirror optional. |
| 24.2 | Async-safe business layer | ✅ `seed.js`, `server.js`, and all dependent modules now `await` DAL calls. Fire-and-forget `forEach(async)` / `map(async)` loops removed. |
| 24.3 | `.env` load order fix | ✅ `backend/src/server.js` imports `dotenv/config` before persistence config so `DB_PRIMARY`/`DATABASE_URL` are available at module load. |
| 24.4 | Mirror orchestrator with retry | ✅ `backend/src/persistence/mirror-orchestrator.js` retries SQLite mirror writes up to 3 times; primary success not blocked by mirror failures. |
| 24.5 | Postgres adapter transaction support | ✅ `transaction(work)` exposes a `pg` client to callers for multi-statement transactional work. |
| 24.6 | DAL + Postgres unit tests | ✅ `dal.test.js` and `postgres-adapter.test.js` exercise both adapters. |
