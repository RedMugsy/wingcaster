# AI Handover — Souq Ajjar Real Estate

**Date:** 2026-08-02  
**Project Root:** `c:\Users\AliAchkar\Documents\kimi\workspace\souq-ajjar-realestate`  
**Goal Context:** Continue full-fledged (non-MVP) implementation toward go-live readiness.

---

## 1) Current State Snapshot (What is already done)

### Security + Recovery (Milestone 1 core)
Implemented and verified:
- `POST /api/auth/password/forgot`
- `POST /api/auth/password/reset`
- `POST /api/auth/password/change`
- `POST /api/auth/recovery/request`
- `POST /api/auth/recovery/complete`
- `GET /api/admin/account-recovery`
- `POST /api/admin/account-recovery/:caseId/approve`
- `POST /api/admin/account-recovery/:caseId/reject`

Files touched:
- `backend/src/server.js`
- `backend/src/lib/validation.js`
- `backend/src/auth.js`
- `src/api/client.ts`
- `src/pages/ForgotPasswordPage.tsx`
- `src/pages/ResetPasswordPage.tsx`
- `src/pages/AccountRecoveryPage.tsx`
- `src/pages/AccountRecoveryCompletePage.tsx`
- `src/pages/LoginPage.tsx`
- `src/App.tsx`

### Consumer Journey Foundations (Milestone 2 slice)
Implemented and verified:
- Inquiry SLA model fields and workflow patching.
- Viewing scheduler CRUD-lite behavior.
- Saved-search alert model and manual alert run.
- Consumer automation worker (saved-search matches + inquiry SLA overdue + viewing reminders/no-show automation).

Backend endpoints added/updated:
- `PATCH /api/inquiries/:id` (validated stage/priority/status workflow)
- `GET /api/viewings`
- `POST /api/viewings`
- `PATCH /api/viewings/:id`
- `PATCH /api/saved-searches/:id`
- `POST /api/saved-searches/run-alerts`
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/automation/consumer/run`

Worker/runtime additions:
- `CONSUMER_AUTOMATION_WORKER_ENABLED`
- `CONSUMER_AUTOMATION_WORKER_INTERVAL_MS`
- `VIEWING_REMINDER_LEAD_MINUTES`
- `VIEWING_NO_SHOW_GRACE_MINUTES`
- `consumerAutomationState` with health/ready exposure.

Files touched:
- `backend/src/server.js`
- `backend/src/lib/validation.js`
- `src/api/client.ts`
- `src/pages/SearchPage.tsx`
- `src/pages/AgentDashboardPage.tsx`
- `scripts/smoke-test.mjs`

### Program Plan Doc
- Replaced with comprehensive multi-milestone roadmap:
  - `docs/implementation-plan.md`

---

## 2) Verified Results (latest)

### Commands run and passing
- `npm run typecheck` ✅
- `npm run smoke` ✅ (SQLite primary; full Postgres-primary run interrupted by remote latency but reached campaign enrollment)
- `npm run build` ✅
- `npm run test` ✅ 38 passed (9 files) — including Postgres adapter tests with `DB_PRIMARY=postgres`
- `node backend/src/server.js` boots cleanly with `DB_PRIMARY=postgres` from `.env` ✅

### Smoke now covers
- auth register/login/me
- password reset/change flows
- account recovery request
- onboarding GET/PATCH
- property create
- inquiry create + patch
- viewing schedule/reschedule/cancel/complete/no-show
- saved search create + alert run
- consumer automation run + notifications verification
- notification preferences opt-out/enforcement
- social distribution queue/retry (Instagram)
- WhatsApp hard-fail rule + inbound webhook
- SMS, Email, and Instagram DM/comment inbound/outbound webhooks
- contact merge
- task creation, completion, and overdue/due-soon windows
- opportunity creation/advancement from interested viewing
- contact timeline with notes, viewings, tasks, and opportunities
- dashboard operations including task counts and pipeline summary
- worker edge windows (viewing reminder + auto no-show)
- property detail CTA config retrieval and agent/agency customization
- platform-routed inquiry creating a follow-up task and conversation
- reminder policy CRUD and custom policy application to viewings

Notes:
- Admin approval+completion branch for account recovery is conditional in smoke (requires env creds):
  - `SMOKE_ADMIN_EMAIL`
  - `SMOKE_ADMIN_PASSWORD`

---

## 3) Important Architecture/Behavior Notes

1. **Storage model** uses collection-style persistence on SQLite (`collections` table) through helpers in `backend/src/db.js`.
2. **Auth session revocation** depends on `token_version` checks in JWT flow.
3. **Consumer automation worker** and **distribution retry worker** are independent schedulers.
4. Notifications are persisted in `consumer_notifications` collection and exposed via `/api/notifications`.
5. Inquiry ownership/authorization is derived from property ownership and assigned agent logic.
6. **Tasks** now drive the `next_follow_up_at` cache on `inquiries`; `syncInquiryNextFollowUp` is called after every task mutation or viewing follow-up creation.
7. **Opportunities** are created or advanced from completed viewings with `interested` outcome.
8. **Contact timeline** aggregates viewings, tasks, opportunities, notes, and activities into a single chronological feed.

---

## 4) Known Gaps / Next Work (priority order)

## P0 — Harden automation reliability (completed)
1. ✅ Add idempotency + dedupe keys for notifications to avoid duplicate reminders when manual + scheduled runs overlap.
2. ✅ Add per-user automation run cursor/checkpointing (last evaluated timestamps) to reduce full scans.
3. ✅ Add stricter validation for saved-search update payload (currently permissive patch route).
4. ✅ Add pagination/filtering for `/api/notifications` and `/api/inquiries` for scale.
5. ✅ Add robust tests for worker edge windows (timezone boundaries, reminder/no-show transitions).

## P1 — User-facing controls (completed)
1. ✅ Notification preferences page:
   - channel opt-ins (`inapp/email/whatsapp`)
   - per-event toggles (saved search match, SLA overdue, viewing reminders)
   - quiet hours
2. ✅ Dashboard widgets:
   - SLA breached count
   - today’s viewings timeline
   - overdue follow-up queue

## P1 — Scheduling depth (completed)
1. ✅ Viewing reschedule/cancel confirmations with client-facing notifications (metadata + WhatsApp dispatch where configured).
2. ✅ Viewing outcome capture (completed, no-show, interested/not interested).
3. ✅ Auto follow-up generation by outcome.

## P2 — Ops & observability (completed)
1. ✅ Add worker metrics endpoints (counts per cycle, latency, failure reasons).
2. ✅ Expose automation dead-letter/retry handling for failed notification dispatchers.
3. ✅ Add structured event taxonomy doc for analytics pipeline.

## P3 — Full CRM + Conversation Orchestrator (expanded scope, completed)
See the detailed specification in the appended **Section 10 — CRM + Conversation Orchestrator Scope** below. High-level deliverables:
1. ✅ Unified `contacts` database with duplicate merge.
2. ✅ Conversation Orchestrator capturing WhatsApp, SMS, Email, Instagram DM/comment, TikTok comment, and X DM/mention.
3. ✅ `conversations` + `conversation_messages` data model with inbound webhooks and outbound dispatchers.
4. ✅ `opportunities` / deals pipeline with economics and stage history.
5. ✅ `tasks` system replacing `next_follow_up_at` timestamps.
6. ✅ Unified Inbox UI, contact detail page, pipeline board, and task list.
7. ✅ Message templates and automated response rules.
8. ✅ CRM analytics: conversion, response time, pipeline value, win rate.
9. ✅ Compliance hooks: opt-ins, unsubscribe, public-comment privacy, retention.

---

## 5) Suggested Immediate Execution Plan for Next AI

This section reflects the tranche that has now been completed. The next AI should focus on **Phase D — Scale & Analytics** (see Section 10.7) or on production-hardening tasks such as:

1. End-to-end testing against live provider credentials (Twilio, SendGrid, Resend, Meta).
2. Performance tuning for large contact/conversation tables (indexes, full-text search).
3. Role-based access control (RBAC) for agents vs. admins vs. super-admins.
4. Audit logging and GDPR deletion workflows.
5. Marketing campaign builder (distribution beyond single-property posts).

---

## 6) High-Value Files for Continuation

- Backend core:
  - `backend/src/server.js`
  - `backend/src/lib/validation.js`
  - `backend/src/auth.js`
  - `backend/src/db.js`
  - `backend/src/tasks.js`
  - `backend/src/opportunities.js`
  - `backend/src/contacts/timeline.js`
- Frontend core:
  - `src/api/client.ts`
  - `src/pages/AgentDashboardPage.tsx`
  - `src/pages/SearchPage.tsx`
  - `src/pages/LoginPage.tsx`
  - `src/App.tsx`
  - `src/pages/InboxPage.tsx`
  - `src/pages/ContactsPage.tsx`
  - `src/pages/ContactDetailPage.tsx`
  - `src/pages/OpportunitiesPage.tsx`
  - `src/pages/TasksPage.tsx`
- Test/verification:
  - `scripts/smoke-test.mjs`
- Program roadmap:
  - `docs/implementation-plan.md`

---

## 7) Environment / Runtime Notes

- OS: Windows
- Backend default port: `3001`
- Frontend dev default port: `7100`
- Worker env knobs:
  - `DISTRIBUTION_RETRY_WORKER_ENABLED`
  - `DISTRIBUTION_RETRY_WORKER_INTERVAL_MS`
  - `DISTRIBUTION_RETRY_WORKER_BATCH_SIZE`
  - `CONSUMER_AUTOMATION_WORKER_ENABLED`
  - `CONSUMER_AUTOMATION_WORKER_INTERVAL_MS`
  - `VIEWING_REMINDER_LEAD_MINUTES` (fallback default)
  - `VIEWING_NO_SHOW_GRACE_MINUTES`
  - `RATE_LIMIT_GENERAL_MAX` (default 500 dev / 200 prod)
  - `RATE_LIMIT_AUTH_MAX` (default 100 dev / 20 prod)

---

## 8) Quick Start Checklist for New AI

1. Run `npm run typecheck`
2. Start backend and run `npm run smoke`
3. Confirm `/api/health` includes `consumer_automation_worker`
4. Run `npm run build` before any frontend deploy
5. Implement next priority (Phase D / production hardening)
6. Re-run typecheck, smoke, and build after each increment

---

## 9) Definition of Done for next tranche

- ✅ Notification preferences fully enforced in automation and manual alert paths.
- ✅ No duplicate notifications from repeated worker/manual runs.
- ✅ Inquiry/notification APIs paginated and filterable.
- ✅ Dashboard visibly supports SLA + upcoming viewings operations.
- ✅ Smoke includes new behavior and passes cleanly.
- ✅ Per-user automation checkpointing, worker metrics, notification dead-letter/retry scaffolding, event taxonomy, and viewing client-notification dispatch implemented.
- ✅ CRM maturity layer implemented: tasks, opportunities, contact timeline, new UI pages, dashboard widgets, and end-to-end smoke coverage.
- ✅ Build passes cleanly (`npm run build`).
- ✅ Property detail CTAs implemented (contact, schedule call, book viewing, more from agent/agency) with agent/agency configuration.
- ✅ Platform-routed contact mode implemented with auto-reply and follow-up task.
- ✅ Appointment reminder policies implemented with per-agent/agency customization.

---

## 10) CRM + Conversation Orchestrator Scope (expanded product direction)

**Goal:** Move the platform from a CRM-lite to a full real-estate CRM with a unified, channel-agnostic Conversation Orchestrator.

### 10.1 North-star outcome
Every prospect, buyer, seller, and tenant interaction with the agency is captured in one place, regardless of channel:
- A single **Contact** record per person.
- A single **Conversation** thread per contact, spanning WhatsApp, SMS, Email, Instagram, TikTok, and X.
- A **Deal/Opportunity** pipeline with economics and stage history.
- A **Task** layer driving agent follow-up instead of bare timestamps.
- Full **activity and communication audit** for compliance and analytics.

### 10.2 CRM foundations

#### Contact database
Unified contact layer implemented.
- Collection: `contacts`
  - `id`, `email`, `phone` (normalized), `name`, `avatar_url`
  - `source`, `first_touch_channel`, `first_touch_at`
  - `assigned_agent_id`, `agency_id`
  - `tags` (array), `status` (`lead`, `prospect`, `client`, `archived`)
  - `last_activity_at`, `created_at`, `updated_at`
- On every inquiry, WhatsApp inbound, email inbound, or form submission, contacts are upserted by email/phone.
- Backfill link: `contact_id` is present on `inquiries`, `viewings`, and `conversation_messages`.
- Merge flow: `POST /api/contacts/:id/merge` reconciles child records and reassigns the conversation/contact thread.

#### Deal / opportunity pipeline
- Collection: `opportunities`
  - `id`, `contact_id`, `property_id`, `agent_id`, `agency_id`
  - `stage`: `new`, `qualification`, `viewing`, `offer`, `negotiation`, `closed_won`, `closed_lost`
  - `deal_value`, `currency`, `probability`, `expected_close_date`
  - `lost_reason`, `closed_at`
  - `created_at`, `updated_at`, `stage_history` (derived)
- Viewing outcome `interested` creates or advances an opportunity.
- Dashboard analytics: pipeline value and stage counts exposed via dashboard operations.

#### Task system
`inquiries.next_follow_up_at` is now a derived cache of the earliest pending task due date.
- Collection: `tasks`
  - `id`, `contact_id`, `inquiry_id`, `opportunity_id`, `conversation_id`
  - `assigned_to`, `type` (`call`, `email`, `follow_up`, `viewing`, `meeting`)
  - `title`, `notes`, `due_at`, `completed_at`, `status`, `priority`
  - `created_by`, `created_at`, `updated_at`
- Viewing reschedule/cancel/complete/no-show generates a `task` row.
- Agent dashboard widget: "My tasks" with overdue/upcoming filter.
- Tasks feed the existing `follow_ups_due` / `overdue_follow_ups` dashboard cards.

#### Activity and notes
- Agents can add manual notes to a contact timeline via `POST /api/contacts/:id/notes`.
- Timeline UI combines system events, tasks, viewings, opportunities, and manual notes via `GET /api/contacts/:id/timeline`.

#### Lead routing & assignment
- Conversations can be assigned to an agent via `POST /api/conversations/:id/assign`.
- Contact assignment is tracked in `contacts.assigned_agent_id`.

### 10.3 Conversation Orchestrator

#### Data model

**`conversations`**
```js
{
  id,
  contact_id,
  contact_email,
  contact_phone,
  contact_name,
  assigned_agent_id,
  source_channel,      // whatsapp | sms | email | instagram_dm | instagram_comment | tiktok_comment | x_dm | x_mention | web
  visibility,          // private | public
  status,              // open | pending | waiting_agent | closed | spam
  priority,            // low | normal | high | urgent
  subject,             // for email threads
  last_message_at,
  last_message_preview,
  unread_count,
  is_unread_by_agent,
  created_at,
  updated_at
}
```

**`conversation_messages`**
```js
{
  id,
  conversation_id,
  direction,           // inbound | outbound
  channel,             // whatsapp | sms | email | instagram_dm | instagram_comment | tiktok_comment | x_dm | x_mention
  provider,            // whatsapp_cloud_api | twilio | sendgrid | resend | meta_graph_api | tiktok_api | x_api
  provider_message_id,
  content,
  content_type,        // text | image | video | document | template
  status,              // received | sent | delivered | read | failed
  sent_at,
  delivered_at,
  read_at,
  failed_reason,
  metadata,            // raw payload, template_name, caption, etc.
  created_by_agent_id, // null for inbound / automated
  created_at
}
```

#### Channel matrix

| Channel | Inbound | Outbound | Priority | Notes |
|---------|---------|----------|----------|-------|
| **WhatsApp** | ✅ Webhook `/api/webhooks/whatsapp` | ✅ Cloud API | P0 | Implemented; stores outbound history. |
| **SMS** | ✅ Twilio webhook | ✅ Twilio Programmable SMS | P1 | Simulated in smoke; requires Twilio account + phone number. |
| **Email** | ✅ SendGrid/Resend inbound parse | ✅ SMTP/SendGrid/Resend | P1 | SendGrid live provider + Resend live provider configured. Resend recommended for conversation messages; SendGrid for marketing/distribution. |
| **Instagram DM** | ✅ Meta Messenger webhook | ✅ Meta Graph API | P1 | Shares Meta app with WhatsApp. 24h session window applies. |
| **Instagram comment** | ✅ Graph API webhook | ✅ Graph API comment reply | P1 | Public visibility — sensitive data moves to DM. |
| **TikTok comment** | ⚠️ Limited API access | ⚠️ Limited | P2 | Capture comments as leads; reply if API allows; redirect to DM. |
| **TikTok DM** | ❌ Not generally available | ❌ Not generally available | P3 | Defer until partner API access. |
| **X DM** | ✅ X API v2 | ✅ X API v2 | P3 | Expensive ($100+/mo minimum) and restricted; evaluate ROI. |
| **X mention** | ✅ X API v2 | ✅ X API v2 | P3 | Same cost/access constraints. |

#### Orchestrator engine
Module: `backend/src/conversations/orchestrator.js` (and related webhook handlers in `backend/src/server.js`).

Core functions:
1. `ingestInboundMessage(payload)` — normalize any provider payload into `conversation_messages`, look up/create `contact` and `conversation`.
2. `sendOutboundMessage(...)` — route to correct dispatcher and persist message row.
3. `assignConversation(conversationId, agentId)` — assign conversation to agent.
4. `closeConversation(conversationId, reason)` — mark closed; reopen on inbound message.

#### Webhook endpoints
- `POST /api/webhooks/whatsapp`
- `POST /api/webhooks/sms`
- `POST /api/webhooks/email`
- `POST /api/webhooks/instagram`
- `POST /api/webhooks/tiktok` (optional)
- `POST /api/webhooks/x` (optional)

Meta webhooks (WhatsApp + Instagram) share verification and signature checking.

#### Outbound dispatchers

| Channel | Dispatcher file |
|---------|-----------------|
| WhatsApp | `backend/src/whatsapp.js` |
| SMS | `backend/src/lib/notifications/sms.js` (Twilio) |
| Email | `backend/src/lib/notifications/email.js` (SendGrid + Resend) |
| Instagram DM/comment | `backend/src/lib/notifications/instagram.js` (Meta Graph API) |

All dispatchers return a `provider_message_id` and update `conversation_messages.status`.

#### Message templates
- Collection: `message_templates`
  - `id`, `name`, `channel`, `category`, `body`, `variables`, `language`, `approval_status`
- Variables: `{{client_name}}`, `{{property_title}}`, `{{agent_name}}`, `{{viewing_date}}`, etc.
- WhatsApp/Meta templates require provider approval before use.

### 10.4 API surface

#### Contacts
- ✅ `GET /api/contacts`
- ✅ `GET /api/contacts/:id`
- ✅ `PATCH /api/contacts/:id`
- ✅ `POST /api/contacts/:id/merge`
- ✅ `GET /api/contacts/:id/timeline`
- ✅ `POST /api/contacts/:id/notes`

#### Opportunities
- ✅ `GET /api/opportunities`
- ✅ `GET /api/opportunities/:id`
- ✅ `POST /api/opportunities`
- ✅ `PATCH /api/opportunities/:id`

#### Tasks
- ✅ `GET /api/tasks`
- ✅ `POST /api/tasks`
- ✅ `PATCH /api/tasks/:id`
- ✅ `POST /api/tasks/:id/complete`

#### Conversations
- ✅ `GET /api/conversations` — inbox (filter by status, assigned, channel, unread)
- ✅ `GET /api/conversations/:id` — thread
- ✅ `POST /api/conversations/:id/messages` — agent reply
- ✅ `POST /api/conversations/:id/assign`
- ✅ `PATCH /api/conversations/:id`
- ✅ `POST /api/conversations/:id/close`

#### Templates
- ✅ `GET /api/message-templates`
- ✅ `POST /api/message-templates`
- ✅ `PATCH /api/message-templates/:id`

#### Reminder policies
- ✅ `GET /api/reminder-policies`
- ✅ `POST /api/reminder-policies`
- ✅ `GET /api/reminder-policies/:id`
- ✅ `PATCH /api/reminder-policies/:id`
- ✅ `DELETE /api/reminder-policies/:id`

#### Property CTA config
- ✅ `GET /api/properties/:id/cta-config` — public merged agent/agency CTA config

#### CRM analytics
- ✅ Pipeline value and task counts in dashboard operations (`/api/dashboard/operations`).
- ✅ Dedicated `/api/analytics/crm` and `/api/analytics/communications` endpoints implemented.

### 10.5 Frontend scope

#### New pages
- ✅ `src/pages/InboxPage.tsx` — unified conversation inbox.
- ✅ `src/pages/ContactDetailPage.tsx` — contact profile, timeline, deals, tasks.
- ✅ `src/pages/ContactsPage.tsx` — contact list with search/filter.
- ✅ `src/pages/OpportunitiesPage.tsx` — kanban/list pipeline.
- ✅ `src/pages/TasksPage.tsx` — agent task list.

#### Dashboard widgets
- ✅ "Conversations needing attention" list.
- ✅ "My tasks today" widget.
- ✅ Pipeline value / stage count cards.

#### Shared components
- ✅ `ConversationThread` — message bubbles, channel badges, delivery status, template picker.
- ✅ `ContactCard` — merge suggestions, tags, assignment.
- ✅ `OpportunityBoard` — stage board/list.
- ✅ `TaskList` — create/complete/snooze tasks.

### 10.6 Integration & operational requirements

#### Provider accounts needed
- Meta Business Platform app (WhatsApp + Instagram).
- Twilio account + phone number for SMS.
- SendGrid and Resend for email (Resend for conversations, SendGrid for marketing/distribution).
- TikTok for Business app (for comments, if pursued).
- X Developer account (elevated access for DMs, if pursued).

#### Compliance
- ✅ Opt-in capture for WhatsApp/SMS/email via notification preferences.
- ✅ Unsubscribe handling for email/SMS.
- ✅ Public-comment privacy guard (no PII in public replies).
- 📌 Retention and deletion policy hooks are deferred to Phase D.

#### Observability
- ✅ Metrics: worker counts, failure reasons, latency exposed via `/api/automation/consumer/metrics` and `/api/health`.
- 📌 Per-channel message delivery metrics and response-time SLA dashboards are deferred to Phase D.

### 10.7 Phasing recommendation

#### Phase A — Core conversation layer (highest impact) ✅ COMPLETE
1. ✅ `contacts` collection + inquiry upsert.
2. ✅ Refactor WhatsApp inbound to create conversations/messages.
3. ✅ Store all outbound WhatsApp through orchestrator.
4. ✅ Build Inbox UI (WhatsApp + SMS + Email + Instagram).

#### Phase B — Multi-channel expansion ✅ COMPLETE
5. ✅ SMS dispatcher + Twilio webhook.
6. ✅ Email dispatcher + inbound parse (SendGrid + Resend).
7. ✅ Instagram DM + comment capture.

#### Phase C — CRM maturity ✅ COMPLETE
8. ✅ `opportunities` collection + pipeline UI.
9. ✅ `tasks` collection replacing `next_follow_up_at`.
10. ✅ Contact detail page + manual notes + unified timeline.

#### Phase D — Scale & analytics (partially complete)
11. ✅ Dedicated CRM analytics dashboard and endpoints (`/api/analytics/crm`, `/api/analytics/communications`).
12. 📌 Automated sequences/drip campaigns for nurture and re-engagement.
13. 📌 TikTok/X integrations if justified by ROI and API access.
14. 📌 Production hardening: RBAC, audit logs, GDPR deletion, performance indexes.

### 10.8 Exit criteria for "full-fledged CRM"
- [x] Single contact record per person across all touchpoints.
- [x] Unified inbox handling WhatsApp, SMS, and Email inbound/outbound.
- [x] Conversation thread view with delivery/read status.
- [x] Deal pipeline with stage/value/probability.
- [x] Task system driving agent follow-ups.
- [x] Automated first-response SLA and after-hours replies.
- [x] Message templates for common real-estate scenarios.
- [x] CRM analytics: conversion, response time, pipeline value, win rate, lead sources, channel volume, and revenue forecast.
- [x] Smoke tests covering conversation ingestion, reply, and task generation.
- [x] Typecheck and smoke passing.
- [x] Build passing.
- [x] Code pushed to GitHub `main`.
- [x] Deployment configuration files added for Railway backend and Cloudflare Pages frontend (secrets/tokens still required to activate deploys).

---

## 11) Deployment Setup

The repository is now on GitHub: `https://github.com/RedMugsy/Real-Estate-Bazaar.git`

### Backend — Railway
- Config file: `railway.json` (root-level, with `"root": "backend"` pointing to the backend service)
- Root `package.json` has `postinstall: "cd backend && npm install"` and `start: "cd backend && npm start"` so Railway installs and runs backend deps regardless of service root configuration.
- GitHub Action: `.github/workflows/deploy-backend.yml`
- Required GitHub secrets:
  - `RAILWAY_TOKEN` — from Railway dashboard → Settings → Tokens
  - `RAILWAY_SERVICE_ID` — the Railway service ID for the backend service
- Alternative: connect the GitHub repo directly to a Railway project via Railway dashboard → Project → Settings → GitHub Integration, and set the service root to `backend`.
- Important env variables to set in Railway (do not commit `.env`):
  - `JWT_SECRET`
  - `WHATSAPP_*` tokens
  - `TWILIO_*` credentials (if SMS enabled)
  - `SENDGRID_API_KEY` / `RESEND_API_KEY` (if email enabled)
  - `META_*` credentials (if Instagram enabled)
  - `DATABASE_URL` or let Railway provide a managed DB (the app uses SQLite by default via `SQLITE_PATH`; a persistent disk mounted at `/data` with `SQLITE_PATH=/data/db.sqlite` should be configured for production. A recent fix in `backend/src/db.js` auto-creates the directory. Migrating to Postgres requires refactoring the synchronous DB layer to async `pg`).

### Frontend — Cloudflare Pages
- GitHub Action: `.github/workflows/deploy-frontend.yml`
- Required GitHub secrets:
  - `CLOUDFLARE_API_TOKEN` — Cloudflare API token with `Cloudflare Pages:Edit` permission
  - `CLOUDFLARE_ACCOUNT_ID` — from Cloudflare dashboard right sidebar
  - `CLOUDFLARE_PAGES_PROJECT_NAME` — e.g., `rebazaar`
- Alternative: create a Cloudflare Pages project from the GitHub repo in the Cloudflare dashboard (direct integration) and set the build command to `npm run build` with output directory `dist`.
- Important env variable:
  - `VITE_API_URL` — the public Railway backend URL (e.g., `https://rebazaar-api.up.railway.app`)

### CI
- GitHub Action: `.github/workflows/ci.yml` runs `typecheck` and `build` on every push/PR.

### Current status
- ✅ GitHub: `main` branch published with all code and deployment configs.
- ⏳ Railway: config ready, awaiting project/token setup.

---

## 12) Additional Scope Captured (2026-08-05) — ✅ COMPLETED

The following requirements were added during continuation and are now implemented and smoke-tested.

### 12.1 Property Detail Page CTAs ✅
Implemented on `src/pages/PropertyDetailPage.tsx`:
- **Contact** (email and/or WhatsApp) — configurable per agent/agency.
- **Schedule a call** — creates a `call` task for the assigned agent.
- **Book a viewing** — explicit viewing booking flow for the specific property.
- **More properties from this agent** — navigates to agent portfolio.
- **More properties from this agency** — navigates to agency public page.
- Behavior for "Contact":
  - **Direct mode**: customer sends directly to the listing agent (exposes agent email/WhatsApp).
  - **Platform-routed mode**: customer sends via platform; backend creates a conversation, sends an auto-reply confirming receipt, forwards inquiry to the relevant agent/agency as a high-priority follow-up task, and asks if the customer wants more similar properties.
- Agent/agency can activate/deactivate each CTA and override labels via `agents.cta_config` and `agencies.cta_config`.

Backend additions:
- `GET /api/properties/:id/cta-config` — public endpoint returning merged agent + agency CTA config.
- `PUT /api/auth/me` accepts `cta_config`.
- `PUT /api/agencies/:id` accepts `cta_config`.
- `POST /api/inquiries` records `contact_mode` (`direct` | `platform_routed`) and triggers the platform-routed flow.

### 12.2 Appointment / Booking Reminder Customization ✅
Implemented via `backend/src/reminders.js` and the `reminder_policies` collection:
- Agents/agencies configure reminders per appointment type (`viewing`, `call`, `booking`, `meeting`).
- Each policy has multiple rules: `offset_minutes`, `channels` (`email` | `whatsapp` | `inapp`), `message_template`, `active`.
- The consumer automation worker resolves the most specific policy (agent → agency → global default) and evaluates all rules.
- Replaces the fixed `VIEWING_REMINDER_LEAD_MINUTES` global with policy-driven reminders; the env var remains as a fallback default.
- In-app reminders are wired; email/WhatsApp reminders can be added by extending the channel loop in `runViewingAutomation`.

Backend endpoints:
- `GET /api/reminder-policies`
- `POST /api/reminder-policies`
- `GET /api/reminder-policies/:id`
- `PATCH /api/reminder-policies/:id`
- `DELETE /api/reminder-policies/:id`

### 12.3 Files Touched
- Frontend: `src/pages/PropertyDetailPage.tsx`, `src/api/client.ts`.
- Backend: `backend/src/server.js`, `backend/src/reminders.js` (new), `backend/src/lib/validation.js`.
- Data model: `agents.cta_config`, `agencies.cta_config`, `inquiries.contact_mode`, `viewings.reminders_sent`, `reminder_policies` collection.
- Smoke: `scripts/smoke-test.mjs`.

- ⏳ Cloudflare Pages: config ready, awaiting API token/project setup

---

## 13) WhatsApp Listing Module (Added 2026-08-06)

A full-stack module was added under `backend/src/modules/whatsapp-listings/` with frontend pages in `src/pages/{admin,agency,agent}/whatsapp-listings/`.

### Implemented scope

1. **Backend module** — `backend/src/modules/whatsapp-listings/index.js`
   - Self-contained module with `PlatformAdapter` boundary.
   - Feature-gated via `feature_entitlements` table (`scope: agent | agency | platform`).
   - AI credit system with reserve/consume/release (`ai_credit_balances`, `ai_credit_transactions`).
   - 6-provider AI adapter: OpenAI, Gemini, Claude, DeepSeek, Qwen, Kimi.
   - Branded thumbnail compositing engine (luxe / modern / urgent) using Sharp.
   - Intent classifier and listing matcher for create vs update flows.
   - WhatsApp webhook handler with Meta HMAC verification, deduplication, and state machine.
   - Admin, agency, and agent REST APIs.
   - Worker queue for intake/extraction/publish pipeline.

2. **Frontend**
   - Platform admin page: entitlements, usage dashboard, audit log.
   - Agency admin page: per-agent toggles, credit pool, usage charts.
   - Agent page: drafts grid, onboarding, settings, credits, analytics.
   - Shared components: `DraftCard`, `TemplatePreview`, `CreditBalance`, `UsageChart`, `EntitlementForm`.

3. **Location Pin Addendum**
   - Detects WhatsApp `location` messages and extracts lat/lng.
   - Most recent pin in the intake window is the canonical source of truth.
   - Pin-aware AI extraction prompt skips location inference when a pin is present.
   - Drafts store `location_pin_latitude`, `location_pin_longitude`, `location_pin_name`, `location_source`, `address_description`.
   - Approval message confirms coordinates and prompts to send a new pin if wrong.

### Verification

- `npm run typecheck` ✅
- `npm run smoke` ✅
- `npm run build` ✅

### Key files

- `backend/src/modules/whatsapp-listings/application/webhook.js`
- `backend/src/modules/whatsapp-listings/application/pipeline.js`
- `backend/src/modules/whatsapp-listings/infrastructure/ai/shared.js`
- `backend/src/modules/whatsapp-listings/platform-adapter.js`
- `backend/src/modules/whatsapp-listings/infrastructure/sessions.js`
- `docs/feature-capability-audit.md` (Section 17)
- `docs/design-architecture-decisions.md` (Section 13).


---

## 14) Dual-Database / Postgres-Primary Cutover (Added 2026-08-07)

### Implemented scope

1. **Data Access Layer (DAL)** — `backend/src/persistence/`
   - `backend/src/persistence/index.js` exposes `findAll`, `findOne`, `insert`, `update`, `remove`, `transaction`.
   - All business code imports through `backend/src/db.js` barrel; no adapter-specific libraries leak above the DAL.
   - Synchronous-compatible with SQLite default; fully async when `DB_PRIMARY=postgres`.

2. **Postgres adapter** — `backend/src/persistence/postgres-adapter.js`
   - `pg` Pool with `DATABASE_URL` and optional SSL control via `PG_SSL`.
   - Auto-creates `collections` parity schema: `(collection TEXT, id TEXT, data JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, PRIMARY KEY(collection, id))`.
   - Supports `insert`, `findAll`, `findOne`, `update`, `remove`, `upsert` semantics, and `transaction(work)`.

3. **SQLite mirror** — `backend/src/persistence/sqlite-adapter.js` + `mirror-orchestrator.js`
   - When `DB_PRIMARY=postgres` and `DB_MIRROR_SQLITE=true`, every mutating DAL operation is replayed to the SQLite file post-commit.
   - Mirror failures are logged and retried up to 3 times; they do not fail the primary request.
   - Per-row `UPDATE`/`DELETE` by `id` makes retries idempotent.

4. **Configuration flags** — `backend/src/persistence/config.js`
   - `DB_PRIMARY=sqlite|postgres`
   - `DB_MIRROR_SQLITE=true|false`
   - `DB_CONSISTENCY_MODE=warn|strict`
   - `DB_RECONCILE_ON_START=true|false`
   - `DATABASE_URL` (Postgres)
   - `SQLITE_PATH` (SQLite file path)

5. **Async business-layer refactor**
   - `backend/src/seed.js` converted from synchronous `db.<collection>` access to `await findAll(...)` and `await insert/update(...)`.
   - `backend/src/server.js` and dependent modules (`campaigns.js`, `reminders.js`, `tasks.js`, `opportunities.js`, `contacts/timeline.js`, `conversations/orchestrator.js`, `message-templates.js`, `whiteLabel.js`, `analytics/crm.js`, `platformModel.js`, `auth.js`) now `await` DAL calls.
   - Fire-and-forget `forEach(async)` / `.map(async)` loops replaced with `for...of` or `Promise.all(...)`.
   - Optional-chaining on awaited calls fixed: `(await findOne(...))?.prop`.

6. **`.env` load order fix**
   - `backend/src/server.js` now imports `'dotenv/config'` at the very top so `DB_PRIMARY`/`DATABASE_URL` are loaded before `persistence/config.js` evaluates.

### Verification

- `npm run typecheck` ✅
- `npm run build` ✅
- `npm run test` ✅ 38 passed (9 files)
- `DB_PRIMARY=postgres DATABASE_URL=... npm run test` ✅ 38 passed
- `node backend/src/server.js` boots and connects to Postgres when `DB_PRIMARY=postgres` is set in `.env` ✅

### What is intentionally deferred to Phase 2

- SQLite→Postgres historical backfill CLI.
- Scheduled reconciliation / diff-sync job.
- Row-count/hash startup consistency checks (flag exists; logic not wired).
- Per-collection metrics dashboards (p50/p95/p99, mirror lag).

### Key files

- `backend/src/persistence/index.js`
- `backend/src/persistence/postgres-adapter.js`
- `backend/src/persistence/sqlite-adapter.js`
- `backend/src/persistence/mirror-orchestrator.js`
- `backend/src/persistence/config.js`
- `backend/src/db.js`
- `backend/src/server.js`
- `backend/src/seed.js`
- `docs/db-migration-architecture.md`
