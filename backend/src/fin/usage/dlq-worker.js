/**
 * usage_events_dlq replay worker (audit A-2, spec §92).
 * Advisory class FIN_USAGE_DLQ = 1005. Skip the tick if the lock is held.
 */
import { FIN_USAGE_DLQ } from '../foundation/advisory-locks.js'
import { insertOutbox } from '../ledger/write.js'
import { ingestUsageEvent } from './ingest.js'

const MAX_ATTEMPTS = 5

function iso(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function runUsageDlqWorker(pool, {
  now = new Date().toISOString(),
  limit = 100,
} = {}) {
  const clock = iso(now)
  const lockClient = await pool.connect()
  try {
    const locked = await lockClient.query(
      'SELECT pg_try_advisory_lock($1, $2) AS ok',
      [FIN_USAGE_DLQ, 0],
    )
    if (!locked.rows[0].ok) {
      return { skipped: true, reason: 'USAGE_DLQ_LOCK_HELD' }
    }

    try {
      const due = await lockClient.query(
        `SELECT id, environment, source_system, source_event_id, residency_key,
                tenant_id, event_type, quantity_units, dimensions, occurred_at,
                received_at, attempts, error_code, event_kind, corrects_event_id,
                corrects_residency_key, subject_type, subject_id, holder_id,
                billing_account_id, ingestion_version
           FROM fin.usage_events_dlq
          WHERE next_retry_at <= $1::timestamptz
            AND dead_lettered_at IS NULL
          ORDER BY next_retry_at
          LIMIT $2`,
        [clock, limit],
      )

      const results = []
      for (const row of due.rows) {
        let ingestResult
        try {
          ingestResult = await ingestUsageEvent({
            environment: row.environment,
            tenantId: row.tenant_id,
            sourceSystem: row.source_system,
            sourceEventId: row.source_event_id,
            eventType: row.event_type,
            quantityUnits: row.quantity_units,
            dimensions: row.dimensions || {},
            occurredAt: row.occurred_at,
            receivedAt: row.received_at,
            subjectType: row.subject_type,
            subjectId: row.subject_id,
            residencyKey: row.residency_key,
            eventKind: row.event_kind || 'ORIGINAL',
            correctsEventId: row.corrects_event_id,
            correctsResidencyKey: row.corrects_residency_key,
            holderId: row.holder_id,
            billingAccountId: row.billing_account_id,
            ingestionVersion: row.ingestion_version ?? 1,
            replayFromDlqId: row.id,
            now: clock,
          })
        } catch (error) {
          ingestResult = { ok: false, error_code: error.code || 'DB_ERROR' }
        }

        if (ingestResult.ok) {
          await insertOutbox(lockClient, {
            environment: row.environment,
            topic: 'usage.dlq_replay',
            dedupeKey: `dlq:${row.id}:${row.attempts}`,
            payload: {
              dlq_id: row.id,
              usage_event_id: ingestResult.id,
              result: 'ingested',
            },
            now: clock,
          })
          await lockClient.query(
            `DELETE FROM fin.usage_events_dlq WHERE id = $1`,
            [row.id],
          )
          results.push({ id: row.id, result: 'ingested', usage_event_id: ingestResult.id })
          continue
        }

        const nextAttempts = Number(row.attempts) + 1
        const dead = nextAttempts >= MAX_ATTEMPTS
        await lockClient.query(
          `UPDATE fin.usage_events_dlq
              SET attempts = $2::integer,
                  last_attempt_at = $3::timestamptz,
                  next_retry_at = $3::timestamptz
                    + (interval '1 second' * (60 * power(2, $2::integer))),
                  error_code = COALESCE($4, error_code),
                  dead_lettered_at = CASE WHEN $5 THEN $3::timestamptz ELSE dead_lettered_at END,
                  updated_at = $3::timestamptz
            WHERE id = $1`,
          [row.id, nextAttempts, clock, ingestResult.error_code || null, dead],
        )
        if (dead) {
          await insertOutbox(lockClient, {
            environment: row.environment,
            topic: 'usage.dlq_replay',
            dedupeKey: `dlq:${row.id}:${nextAttempts}`,
            payload: {
              dlq_id: row.id,
              result: 'dead_lettered',
              error_code: ingestResult.error_code,
            },
            now: clock,
          })
        }
        results.push({
          id: row.id,
          result: dead ? 'dead_lettered' : 'retry',
          attempts: nextAttempts,
          error_code: ingestResult.error_code,
        })
      }

      return { skipped: false, processed: results.length, results }
    } finally {
      await lockClient.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [FIN_USAGE_DLQ, 0],
      )
    }
  } finally {
    lockClient.release()
  }
}
