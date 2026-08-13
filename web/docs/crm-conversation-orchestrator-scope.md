# CRM + Conversation Orchestrator — Specification Scope

**Date:** 2026-08-03  
**Status:** Living scope document — ratified next tranche  
**Goal:** Move the platform from a CRM-lite to a full-fledged real-estate CRM with a unified, channel-agnostic Conversation Orchestrator.

---

## 1. North-star outcome

Every prospect, buyer, seller, and tenant interaction with the agency is captured in one place, regardless of channel:

- A single **Contact** record per person.
- A single **Conversation** thread per contact, spanning WhatsApp, SMS, Email, Instagram DM/comment, and (later) TikTok/X.
- A **Deal/Opportunity** pipeline with economics and stage history.
- A **Task** layer driving agent follow-up instead of bare timestamps.
- Full **activity and communication audit** for compliance and analytics.

---

## 2. CRM foundations

### 2.1 Contact database
Replace the current inquiry-only model with a unified contact layer.

- New collection: `contacts`
  - `id`, `email`, `phone` (normalized), `name`, `avatar_url`
  - `source`, `first_touch_channel`, `first_touch_at`
  - `assigned_agent_id`, `agency_id`
  - `tags` (array), `status` (`lead`, `prospect`, `client`, `archived`)
  - `last_activity_at`, `created_at`, `updated_at`
- On every inquiry, WhatsApp inbound, email inbound, or form submission, upsert `contacts` by email/phone.
- Backfill link: add `contact_id` to `inquiries`, `viewings`, and `conversation_messages`.
- Merge flow: UI to detect duplicates and merge two contact records, reconciling child records.

### 2.2 Deal / opportunity pipeline
- New collection: `opportunities`
  - `id`, `contact_id`, `property_id`, `agent_id`, `agency_id`
  - `stage`: `new`, `qualification`, `viewing`, `offer`, `negotiation`, `closed_won`, `closed_lost`
  - `deal_value`, `currency`, `probability`, `expected_close_date`
  - `lost_reason`, `closed_at`
  - `created_at`, `updated_at`
- Viewing outcome `interested` should create or advance an opportunity.
- Dashboard analytics: pipeline value, win rate, conversion by source, days-in-stage.

### 2.3 Task system
Replace `inquiries.next_follow_up_at` timestamp logic with first-class tasks.

- New collection: `tasks`
  - `id`, `contact_id`, `inquiry_id`, `opportunity_id`, `conversation_id`
  - `assigned_to`, `type` (`call`, `email`, `follow_up`, `viewing`, `meeting`)
  - `title`, `notes`, `due_at`, `completed_at`, `status`, `priority`
  - `created_by`, `created_at`, `updated_at`
- Viewing reschedule/cancel/complete/no-show should generate a `task` row.
- Agent dashboard widget: "My tasks" with overdue/upcoming filter.
- Tasks feed the existing `follow_ups_due` / `overdue_follow_ups` dashboard cards.

### 2.4 Activity and notes
- Allow agents to add manual notes, calls, and meetings to a contact/opportunity timeline.
- Store in `activity_log` with `type: 'agent_note'` or create `contact_notes` collection.
- Rich timeline UI combining system events, tasks, viewings, and manual notes.

### 2.5 Lead routing & assignment
- Round-robin or territory-based auto-assignment for new inquiries and conversations.
- Agent availability / out-of-office support.
- Reassignment audit in `activity_log`.

---

## 3. Conversation Orchestrator

### 3.1 Data model

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
  provider,            // whatsapp_cloud_api | twilio | sendgrid | ses | meta_graph_api | tiktok_api | x_api
  provider_message_id,
  content,
  content_type,        // text | image | video | document | template | reaction
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

### 3.2 Channel matrix

| Channel | Inbound | Outbound | Priority | Notes |
|---------|---------|----------|----------|-------|
| **WhatsApp** | ✅ Webhook `/api/webhooks/whatsapp` | ✅ Cloud API | P0 | Already integrated; extend to store outbound history. |
| **SMS** | ✅ Twilio webhook | ✅ Twilio Programmable SMS | P1 | Need Twilio account + phone number. |
| **Email** | ✅ Resend/SendGrid/SES inbound parse | ✅ Resend/SendGrid/SMTP/SES | P1 | Resend recommended for transactional/conversation mail; SendGrid reserved for marketing/distribution. |
| **Instagram DM** | ✅ Meta Messenger webhook | ✅ Meta Graph API | P1 | Shares Meta app with WhatsApp. 24h session window applies. |
| **Instagram comment** | ✅ Graph API webhook | ✅ Graph API comment reply | P1 | Public visibility — sensitive data must move to DM. |
| **TikTok comment** | ⚠️ Limited API access | ⚠️ Limited | P2 | Capture comments as leads; reply if API allows; redirect to DM. |
| **TikTok DM** | ❌ Not generally available | ❌ Not generally available | P3 | Defer until partner API access. |
| **X DM** | ✅ X API v2 | ✅ X API v2 | P3 | Expensive ($100+/mo minimum) and restricted; evaluate ROI. |
| **X mention** | ✅ X API v2 | ✅ X API v2 | P3 | Same cost/access constraints. |

### 3.3 Orchestrator engine

New module: `backend/src/conversations/orchestrator.js`

Core functions:

1. `ingestInboundMessage(payload)`
   - Normalize any provider payload into `conversation_messages`.
   - Look up or create `contact`.
   - Look up or create `conversation`.
   - If the message references a property, link it.

2. `sendOutboundMessage({ conversationId, content, channel, templateName, attachments })`
   - Route to correct dispatcher.
   - Persist message row with `status: 'sent'`.
   - Async update `delivered_at` / `read_at` via webhooks.

3. `assignConversation(conversationId, agentId | 'auto')`
   - Auto-assignment rules: load, territory, round-robin.
   - Log assignment in `activity_log`.

4. `runOrchestrationRules(conversationId)`
   - After-hours auto-reply.
   - First-response SLA timer and escalation.
   - Viewing reminder / no-show messages.
   - Spam/abuse detection hooks.

5. `closeConversation(conversationId, reason)`
   - Mark closed; suppress automated messages unless reopened by inbound message.

### 3.4 Webhook endpoints

- `POST /api/webhooks/whatsapp` — existing, refactor to use orchestrator.
- `POST /api/webhooks/sms` — Twilio.
- `POST /api/webhooks/email` — SendGrid/SES inbound parse.
- `POST /api/webhooks/instagram` — Meta Messenger / Graph API.
- `POST /api/webhooks/tiktok` — comments (optional).
- `POST /api/webhooks/x` — mentions/DMs (optional).

Meta webhooks (WhatsApp + Instagram) can share verification and signature checking.

### 3.5 Outbound dispatchers

| Channel | Dispatcher file |
|---------|-----------------|
| WhatsApp | Extend `backend/src/whatsapp.js` |
| SMS | New `backend/src/lib/notifications/sms.js` (Twilio) |
| Email | New `backend/src/lib/notifications/email.js` (Resend/SendGrid/SMTP/SES) |
| Instagram DM | New `backend/src/lib/notifications/instagram.js` (Meta Graph API) |
| Instagram comment | Same as above, different endpoint |

All dispatchers must return a `provider_message_id` and update `conversation_messages.status`.

### 3.6 Message templates

- Collection: `message_templates`
  - `id`, `name`, `channel`, `category`, `body`, `variables`, `language`, `approval_status`
- Variables: `{{client_name}}`, `{{property_title}}`, `{{agent_name}}`, `{{viewing_date}}`, etc.
- WhatsApp/Meta templates require provider approval before use.

---

## 4. API surface

### Contacts
- `GET /api/contacts`
- `GET /api/contacts/:id`
- `PATCH /api/contacts/:id`
- `POST /api/contacts/:id/merge`

### Opportunities
- `GET /api/opportunities`
- `GET /api/opportunities/:id`
- `POST /api/opportunities`
- `PATCH /api/opportunities/:id`

### Tasks
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/complete`

### Conversations
- `GET /api/conversations` — inbox (filter by status, assigned, channel, unread)
- `GET /api/conversations/:id` — thread
- `POST /api/conversations/:id/messages` — agent reply
- `POST /api/conversations/:id/assign`
- `PATCH /api/conversations/:id`
- `POST /api/conversations/:id/close`

### Templates
- `GET /api/message-templates`
- `POST /api/message-templates`
- `PATCH /api/message-templates/:id`

### CRM analytics
- `GET /api/analytics/crm`
- `GET /api/analytics/communications`

---

## 5. Frontend scope

### New pages
- `src/pages/InboxPage.tsx` — unified conversation inbox.
- `src/pages/ContactDetailPage.tsx` — contact profile, timeline, deals, tasks.
- `src/pages/ContactsPage.tsx` — contact list with search/filter.
- `src/pages/OpportunitiesPage.tsx` — kanban/list pipeline.
- `src/pages/TasksPage.tsx` — agent task list.

### Dashboard widgets
- Replace current inquiries-only list with "Conversations needing attention."
- Add "My tasks today" widget.
- Add pipeline value / win-rate cards.

### Shared components
- `ConversationThread` — message bubbles, channel badges, delivery status, template picker.
- `ContactCard` — merge suggestions, tags, assignment.
- `OpportunityBoard` — drag-and-drop stage board.
- `TaskList` — create/complete/snooze tasks.

---

## 6. Integration & operational requirements

### Provider accounts needed
- Meta Business Platform app (WhatsApp + Instagram).
- Twilio account + phone number for SMS.
- SendGrid / AWS SES for email.
- TikTok for Business app (for comments, if pursued).
- X Developer account (elevated access for DMs, if pursued).

### Compliance
- Opt-in capture for WhatsApp/SMS/email.
- Unsubscribe handling for email/SMS.
- Public-comment privacy guard (no PII in public replies).
- Retention and deletion policy hooks.

### Observability
- Metrics: messages sent/delivered/read/failed per channel, response-time SLA, conversation assignment time.
- Alerts: dispatcher failure rate, webhook signature failures, queue backlog.

---

## 7. Phasing recommendation

### Phase A — Core conversation layer (highest impact)
1. `contacts` collection + inquiry upsert.
2. Refactor WhatsApp inbound to create conversations/messages.
3. Store all outbound WhatsApp through orchestrator.
4. Build Inbox UI (WhatsApp-only).

### Phase B — Multi-channel expansion
5. SMS dispatcher + Twilio webhook.
6. Email dispatcher + inbound parse.
7. Instagram DM + comment capture.

### Phase C — CRM maturity
8. `opportunities` collection + pipeline UI.
9. `tasks` collection replacing `next_follow_up_at`.
10. Contact detail page + manual notes.

### Phase D — Scale & analytics
11. CRM analytics dashboard.
12. Automated sequences/drip campaigns.
13. TikTok/X integrations (if justified).

---

## 8. Exit criteria for "full-fledged CRM"

- [ ] Single contact record per person across all touchpoints.
- [ ] Unified inbox handling WhatsApp, SMS, and Email inbound/outbound.
- [ ] Conversation thread view with delivery/read status.
- [ ] Deal pipeline with stage/value/probability.
- [ ] Task system driving agent follow-ups.
- [ ] Automated first-response SLA and after-hours replies.
- [ ] Message templates for common real-estate scenarios.
- [ ] CRM analytics: conversion, response time, pipeline value, win rate.
- [ ] Smoke tests covering conversation ingestion, reply, and task generation.
- [ ] Typecheck and smoke passing.

---

## 9. Relationship to existing implementation plan

This document expands **Milestone 2 (Consumer journey excellence)** and **Milestone 3 (Agent CRM and listing operations)**. Once this scope is accepted, the implementation plan should be updated to mark:

- Milestone 2: partially delivered (inquiry/viewing foundations done; conversation orchestrator and advanced CRM in progress).
- Milestone 3: in progress with this document as the detailed spec.
