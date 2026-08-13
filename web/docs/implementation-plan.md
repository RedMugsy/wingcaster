# Platform implementation plan (full-scale, go-live grade)

## North-star outcome
Build a **best-of-breed real-estate marketplace and agent platform** that is secure, compliant, operationally robust, and globally competitive across agent experience, consumer journey, trust/safety, and distribution.

## Delivery principles
- Security and compliance are release gates, not nice-to-haves.
- Every milestone must have API + UX + observability + test proof.
- No implied success states: UI state must reflect backend truth.
- Feature depth over MVP shortcuts in critical workflows.

## Milestone 1 — Identity, session security, and account recovery
Status: **completed (core implementation)**

### Scope
- Password reset request and secure tokenized reset completion.
- In-session password change with token-version session invalidation.
- Assisted account recovery case intake and secure completion path.
- Admin review actions for recovery approvals/rejections.

### Implemented
- `POST /api/auth/password/forgot`
- `POST /api/auth/password/reset`
- `POST /api/auth/password/change`
- `POST /api/auth/recovery/request`
- `POST /api/auth/recovery/complete`
- `GET /api/admin/account-recovery`
- `POST /api/admin/account-recovery/:caseId/approve`
- `POST /api/admin/account-recovery/:caseId/reject`
- Recovery token lifecycle helpers (issue/consume/revoke/use)
- Audit logging across recovery transitions
- Frontend recovery UX:
  - `/forgot-password`
  - `/reset-password`
  - `/account-recovery`
  - `/account-recovery/complete`

### Acceptance evidence
- `npm run typecheck` ✅
- `npm run smoke` ✅ (including forgot/reset/change + recovery request)
- Admin approval+completion flow is validated when admin credentials are supplied in smoke env (`SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD`).

---

## Milestone 2 — Consumer journey excellence
Status: **partially delivered**

### Delivered
- Saved search alerts with in-app delivery, deduplication, and notification preferences.
- Inquiry lifecycle: status/stage/priority workflow, SLA timers, overdue alerting.
- Viewing scheduler: schedule, reschedule, cancel, complete, no-show, outcome capture, and auto follow-ups.
- Viewing client-notification metadata and inquiry activity timeline.

### Remaining (see `docs/crm-conversation-orchestrator-scope.md`)
- Lead scoring and assignment rules.
- Conversation Orchestrator: unified inbox across WhatsApp, SMS, Email, Instagram, TikTok, X.
- Calendar slots and client self-booking.
- Property comparison, affordability calculator, and recommendation ranking.

### Exit criteria
- All customer conversations captured in a unified inbox regardless of channel.
- Measurable conversion lift on inquiry-to-viewing funnel.
- SLA breach tracking and alerting in agent dashboards.
- End-to-end tests for inquiry, booking, conversation, and reminder journeys.

---

## Milestone 3 — Agent CRM and listing operations
Status: **in progress**

### Scope
See full spec: `docs/crm-conversation-orchestrator-scope.md`.

High-level scope:
- Unified contact database with duplicate merge.
- Deal/opportunity pipeline with economics and stage history.
- Task system replacing bare follow-up timestamps.
- Unified lead inbox, pipeline board, and rich activity timeline.
- Team collaboration: notes, mentions, assignments, permissions.
- Listing lifecycle state machine: draft/review/live/paused/archived.
- Media QA checks, mandatory listing quality score, duplicate detection.

### Exit criteria
- Single contact record per person across all channels.
- Time-to-publish and lead response-time metrics visible per agent/agency.
- Pipeline value, win rate, and conversion analytics.
- Listing quality score integrated into publish gating.
- Regression tests for listing state transitions, permissions, and CRM workflows.

---

## Milestone 4 — Monetization and growth engine
Status: **planned**

### Scope
- Subscription plans (agent/agency tiers), usage entitlements, proration handling.
- Promotion credits, campaign budgets, spend caps, and ROI analytics.
- Billing primitives: invoices, payment history, failure retries, dunning.
- Referral/affiliate system with anti-fraud controls.

### Exit criteria
- Plan enforcement across API and UI with clear entitlement messaging.
- Revenue and spend dashboards with daily reconciliation checks.
- Billing error-handling and retry automation tested.

---

## Milestone 5 — Transactions, trust, and legal readiness
Status: **planned**

### Scope
- Offer workflow and negotiation trail.
- Document vault, e-signature integration points, legal clause templates.
- KYC/KYB onboarding paths and sanctions/PEP screening hooks.
- Dispute handling process and evidentiary audit export.

### Exit criteria
- Immutable transaction audit timeline per deal.
- Compliance checklist completion report per transaction.
- Legal and policy disclosures enforced by region/territory rules.

---

## Milestone 6 — Platform administration and governance
Status: **planned**

### Scope
- Admin console hardening: case queues, moderation tools, impersonation safeguards.
- Role/permission matrix (least privilege), approval workflows, dual control for sensitive actions.
- Data governance: retention policies, deletion workflows, privacy request handling.

### Exit criteria
- RBAC coverage tests for sensitive endpoints.
- Security-event audit completeness and exportability.
- Operational playbooks for moderation, incidents, and abuse response.

---

## Milestone 7 — Reliability, performance, and observability
Status: **in progress**

### Scope
- Structured tracing and metrics for critical APIs.
- SLOs for auth, search, listing publish, and inquiry response.
- Queue durability, retry dead-lettering, and replay tooling.
- Backup/restore drills and disaster recovery runbooks.

### Exit criteria
- Dashboards for latency, error rate, saturation, and queue health.
- Defined alert thresholds and on-call escalation matrix.
- Proven restore drill within target recovery window.

---

## Milestone 8 — Distribution and ecosystem integrations
Status: **in progress**

### Scope
- Hardened social/channel distribution adapters with explicit capability matrix.
- Retry orchestration with backoff, max attempts, and fatal/non-fatal classification.
- Provider-specific diagnostics and reconciliation logs.

### Exit criteria
- Channel-level success/failure attribution and trend analytics.
- Manual and scheduled retry controls with governance.
- Smoke and integration tests for queued/published/failure pathways.

---

## Program-level release gates (must all pass)
- Security: no critical auth/session/recovery vulnerabilities.
- Compliance: territory-specific disclosure and legal obligations enforced.
- Quality: typecheck/tests/smoke pass; no blocking runtime defects.
- Observability: production dashboards and alerting operational.
- Operations: documented incident, rollback, and recovery procedures.

## Current execution snapshot
- Core security/recovery milestone delivered and validated.
- Retry-worker and distribution hardening active with health exposure.
- Viewing scheduler depth + inquiry timeline delivered and smoke-tested.
- Next implementation wave: Conversation Orchestrator + full CRM (see `docs/crm-conversation-orchestrator-scope.md`).
