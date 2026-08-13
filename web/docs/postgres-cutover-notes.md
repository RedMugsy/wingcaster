# Postgres-Only Cutover Notes

This repository has been cut over to a Postgres-only runtime. SQLite primary and mirror modes are not part of the supported runtime path.

## Runtime contract

- `DATABASE_URL` is required for any Postgres-backed runtime or test that touches persistence.
- `PG_SSL` controls whether the Postgres pool uses SSL.
- `JWT_SECRET` must be set in production.
- `NODE_ENV` controls development vs production behavior.
- `PORT` controls the backend listener port.
- `ALLOWED_ORIGINS` can be used to explicitly scope CORS.

Worker toggles and operational knobs that remain supported:

- `DISTRIBUTION_RETRY_WORKER_ENABLED`
- `DISTRIBUTION_RETRY_WORKER_INTERVAL_MS`
- `DISTRIBUTION_RETRY_WORKER_BATCH_SIZE`
- `DISTRIBUTION_RETRY_MAX_ATTEMPTS`
- `DISTRIBUTION_RETRY_BASE_DELAY_MS`
- `CONSUMER_AUTOMATION_WORKER_ENABLED`
- `CONSUMER_AUTOMATION_WORKER_INTERVAL_MS`
- `NOTIFICATION_RETRY_WORKER_ENABLED`
- `NOTIFICATION_RETRY_WORKER_INTERVAL_MS`
- `NOTIFICATION_RETRY_WORKER_BATCH_SIZE`
- `CAMPAIGN_SCHEDULER_ENABLED`
- `CAMPAIGN_SCHEDULER_INTERVAL_MS`
- `CAMPAIGN_SCHEDULER_BATCH_SIZE`
- `RATE_LIMIT_GENERAL_MAX`
- `RATE_LIMIT_AUTH_MAX`

## Migration order

Apply migrations in ascending order from `backend/src/persistence/migrations/`.

Relevant cutover-era entries:

- `017_auth_tables.sql` — creates auth recovery tables.
- `018_drop_auth_user_fks.sql` — removes legacy `users(id)` foreign keys from agent-first auth/notification tables.
- `019_audit_activity_updated_at.sql` — adds `updated_at` to audit/activity tables.
- `020_opportunity_stage_history_timestamps.sql` — backfills timestamps for opportunity stage history.
- `021_drop_consumer_automation_user_fk.sql` — removes the legacy `consumer_automation_checkpoints.user_id` FK.
- `022_drop_consumer_notifications_user_fk.sql` — removes the legacy `consumer_notifications.user_id` FK.

## Verification sequence

Run these gates in order:

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. `npm run smoke`

All four should pass before considering the cutover complete.

## Operational notes

- The persistence layer is intentionally lazy about configuration validation so non-DB startup paths can initialize cleanly.
- The WhatsApp Listings module remains isolated under its own schema/prefix so it can be extracted later without changing the core DAL contract.
- The runtime currently uses agent-first identity semantics in places where older tables still expose `user_id`; the corresponding FKs have been dropped where needed.

## Cleanup guidance

- Remove temporary diagnostics after investigation.
- Rotate any credentials shared during debugging before production use.
- Prefer idempotent migrations over manual schema edits for future cutover work.