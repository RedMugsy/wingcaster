# Event Taxonomy

**Purpose:** Standardize event names, severities, and metadata shapes across the platform so that analytics, audit logs, and automation rules can rely on a stable vocabulary.

## Activity log events

Stored in `activity_log` collection.

### Auth & identity
| Event | Description | Required meta |
|-------|-------------|---------------|
| `password_reset_requested` | User requested password reset | `email`, `ip` |
| `password_reset_completed` | Password reset consumed | `ip` |
| `password_changed` | User changed password while authenticated | `ip` |
| `account_recovery_requested` | User submitted account recovery case | `case_id`, `preferred_channel` |
| `account_recovery_completed` | Recovery case completed | `case_id` |

### Listings
| Event | Description | Required meta |
|-------|-------------|---------------|
| `property_created` | New property listing created | `property_id`, `canonical_id` |
| `property_updated` | Property fields updated | `property_id`, `updated_fields` |
| `property_status_changed` | Listing status changed | `property_id`, `old_status`, `new_status` |
| `property_deleted` | Listing removed | `property_id` |

### Inquiries
| Event | Description | Required meta |
|-------|-------------|---------------|
| `inquiry_created` | New inquiry received | `inquiry_id`, `channel`, `source`, `agency_id` |
| `inquiry_updated` | Inquiry status/stage/priority changed | `inquiry_id`, `status`, `stage`, `priority` |
| `inquiry_sla_overdue` | Inquiry passed first-response SLA | `inquiry_id`, `due_at` |

### Viewings
| Event | Description | Required meta |
|-------|-------------|---------------|
| `viewing_scheduled` | Viewing created | `inquiry_id`, `viewing_id`, `scheduled_at`, `mode` |
| `viewing_updated` | Generic viewing patch | `inquiry_id`, `viewing_id`, `status` |
| `viewing_rescheduled` | Scheduled time changed | `inquiry_id`, `viewing_id`, `scheduled_at` |
| `viewing_cancelled` | Viewing cancelled | `inquiry_id`, `viewing_id`, `client_notified`, `reason` |
| `viewing_completed` | Viewing marked complete | `inquiry_id`, `viewing_id`, `outcome` |
| `viewing_no_show` | Viewing marked no-show | `inquiry_id`, `viewing_id` |
| `viewing_auto_no_show` | Worker auto-marked no-show | `inquiry_id`, `viewing_id`, `scheduled_at` |

### Distribution
| Event | Description | Required meta |
|-------|-------------|---------------|
| `distribution_published` | Distribution reached published state | `platform`, `distribution_id`, `status` |
| `distribution_queued_retry` | Distribution queued for retry | `platform`, `distribution_id` |
| `distribution_failed` | Distribution failed terminally | `platform`, `distribution_id`, `error` |
| `distribution_draft` | Distribution saved as draft | `platform`, `distribution_id` |
| `distribution_retry_published` | Retry worker published distribution | `platform`, `distribution_id` |
| `distribution_retry_failed` | Retry worker failed distribution | `platform`, `distribution_id`, `error` |
| `connection_created` | Social/messaging account connected | `platform`, `connection_id` |
| `connection_updated` | Connection settings updated | `platform`, `connection_id` |
| `connection_disconnected` | Connection removed | `platform`, `connection_id` |

### Automation
| Event | Description | Required meta |
|-------|-------------|---------------|
| `consumer_automation_run` | Consumer automation worker/manual run finished | `users_processed`, `searches_processed`, `total_matches`, `inquiry_overdue_marked`, `reminders_sent`, `no_shows_marked`, `source`, `requested_by` |
| `saved_search_alerts_run` | Manual saved-search alert run | `searches`, `total_matches`, `source` |

## Notification types

Stored in `consumer_notifications` collection.

| Type | Description | Default channel | Severity |
|------|-------------|-----------------|----------|
| `saved_search_match` | New listings matched a saved search | From search alert_channel | info |
| `inquiry_sla_overdue` | Inquiry first-response SLA breached | inapp | warning |
| `viewing_reminder` | Upcoming viewing reminder | inapp | info |
| `viewing_no_show` | Viewing auto-marked no-show | inapp | warning |

## Severities

- `info` — routine, no action required.
- `warning` — requires agent attention soon (SLA breach, no-show).
- `error` — automation/dispatcher failure, requires ops attention.
- `critical` — security/account incident.

## Metadata conventions

- Prefer camelCase keys.
- Always include the primary entity id (`*_id`).
- Include `source` for automated events.
- Include `requested_by` for manual/admin-triggered events.
- Timestamps should be ISO 8601 strings in `created_at` / `updated_at`.

## Adding new events

When adding a new event:
1. Add the row to this doc.
2. Use a past-tense, snake_case name.
3. Include the entity id in meta.
4. Choose the correct severity.
5. Add a smoke or unit test if the event drives automation or analytics.
