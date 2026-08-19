/**
 * Facts-only usage ingest (audit A/B-1 + A-2). Parallel fin.* path; Stage 13 owns cutover.
 * Does not write fin.metered_usage (Stage 3) or commercial.* .
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../db.js'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'

const DLQ_ERROR_CODES = new Set([
  'PARTITION_MISSING', 'DB_ERROR', 'SCHEMA_INVALID', 'ENV_MISMATCH',
])

function iso(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export function classifyUsageError(error) {
  const code = error?.code
  const message = String(error?.message || '')
  if (
    code === '42P01'
    || /no partition of relation/i.test(message)
    || (code === '23514' && /partition/i.test(message))
  ) {
    return 'PARTITION_MISSING'
  }
  if (code === '23514' && /environment/i.test(message)) return 'ENV_MISMATCH'
  if (['23502', '23514', '22P02', '23503'].includes(code)) return 'SCHEMA_INVALID'
  return 'DB_ERROR'
}

function validateEventKind(eventKind, correctsEventId, correctsResidencyKey) {
  const isOriginal = eventKind === 'ORIGINAL'
  const hasCorrects = Boolean(correctsEventId) || Boolean(correctsResidencyKey)
  if (isOriginal && hasCorrects) {
    throw finError('EVENT_KIND_MISMATCH', { category: CATEGORY.VALIDATION })
  }
  if (!isOriginal && (!correctsEventId || !correctsResidencyKey)) {
    throw finError('EVENT_KIND_MISMATCH', { category: CATEGORY.VALIDATION })
  }
}

async function resolveResidencyKey(client, { residencyKey, tenantId }) {
  if (residencyKey) return residencyKey
  if (tenantId) {
    const { rows } = await client.query(
      `SELECT default_residency_key FROM fin.tenants WHERE id = $1`,
      [tenantId],
    )
    if (rows[0]?.default_residency_key) return rows[0].default_residency_key
  }
  return '__platform__'
}

async function loadTenant(client, tenantId) {
  if (!tenantId) return null
  const { rows } = await client.query(
    `SELECT environment, default_residency_key FROM fin.tenants WHERE id = $1`,
    [tenantId],
  )
  return rows[0] || null
}

function factsPayload(input, residencyKey) {
  return {
    environment: input.environment,
    tenant_id: input.tenantId || null,
    source_system: input.sourceSystem,
    source_event_id: input.sourceEventId,
    event_type: input.eventType,
    quantity_units: input.quantityUnits,
    dimensions: input.dimensions || {},
    occurred_at: input.occurredAt,
    received_at: input.receivedAt,
    subject_type: input.subjectType || null,
    subject_id: input.subjectId || null,
    residency_key: residencyKey,
    event_kind: input.eventKind || 'ORIGINAL',
    corrects_event_id: input.correctsEventId || null,
    corrects_residency_key: input.correctsResidencyKey || null,
    ingestion_version: input.ingestionVersion ?? 1,
  }
}

async function landDlq(client, {
  input, residencyKey, errorCode, errorMessage, now, actorType, actorId, actorEmail,
}) {
  const id = randomUUID()
  const code = DLQ_ERROR_CODES.has(errorCode) ? errorCode : 'DB_ERROR'
  await client.query(
    `INSERT INTO fin.usage_events_dlq (
       id, environment, residency_key, tenant_id, holder_id, billing_account_id,
       source_system, source_event_id, event_type, event_kind,
       corrects_event_id, corrects_residency_key, subject_type, subject_id,
       quantity_units, dimensions, occurred_at, received_at, ingestion_version,
       payload, error_code, error_message, attempts, last_attempt_at, next_retry_at,
       created_at, created_by_actor_type, created_by_actor_id,
       updated_at, updated_by_actor_type, updated_by_actor_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,
       $7,$8,$9,$10,
       $11,$12,$13,$14,
       $15,$16::jsonb,$17,$18,$19,
       $20::jsonb,$21,$22,1,$23, $23::timestamptz + interval '60 seconds',
       $23,$24,$25,
       $23,$24,$25
     )`,
    [
      id, input.environment, residencyKey, input.tenantId || null,
      input.holderId || null, input.billingAccountId || null,
      input.sourceSystem, input.sourceEventId, input.eventType || null,
      input.eventKind || 'ORIGINAL',
      input.correctsEventId || null, input.correctsResidencyKey || null,
      input.subjectType || null, input.subjectId || null,
      input.quantityUnits ?? null, JSON.stringify(input.dimensions || {}),
      input.occurredAt || null, input.receivedAt || now, input.ingestionVersion ?? 1,
      JSON.stringify(factsPayload(input, residencyKey)),
      code, String(errorMessage || code).slice(0, 2000), now,
      actorType, actorId,
    ],
  )
  await insertAudit(client, {
    environment: input.environment,
    actorType,
    actorId,
    actorEmail,
    action: 'USAGE_DLQ',
    targetType: 'USAGE_EVENTS_DLQ',
    targetId: id,
    afterState: { error_code: code, residency_key: residencyKey },
    reasonCode: code,
    now,
  })
  return { ok: false, dlq_id: id, error_code: code }
}

export async function ingestUsageEvent(input) {
  const environment = input.environment
  const eventKind = input.eventKind || 'ORIGINAL'
  const actorType = input.actorType || 'SYSTEM'
  const actorId = input.actorId || null
  const actorEmail = input.actorEmail || 'system@fin.local'
  const now = iso(input.receivedAt || input.now)
  const occurredAt = iso(input.occurredAt || now)
  const receivedAt = iso(input.receivedAt || now)
  const dimensions = input.dimensions || {}
  const ingestionVersion = input.ingestionVersion ?? 1
  const replayFromDlqId = input.replayFromDlqId || null

  const bound = {
    ...input,
    environment,
    eventKind,
    occurredAt,
    receivedAt,
    dimensions,
    ingestionVersion,
  }

  try {
    return await transaction(async (client) => {
      validateEventKind(eventKind, input.correctsEventId, input.correctsResidencyKey)

      const tenant = await loadTenant(client, input.tenantId)
      const residencyKey = await resolveResidencyKey(client, {
        residencyKey: input.residencyKey,
        tenantId: input.tenantId,
      })

      if (input.tenantId && tenant && tenant.environment !== environment) {
        if (replayFromDlqId) return { ok: false, error_code: 'ENV_MISMATCH' }
        return landDlq(client, {
          input: bound,
          residencyKey,
          errorCode: 'ENV_MISMATCH',
          errorMessage: `environment ${environment} does not match tenant`,
          now,
          actorType,
          actorId,
          actorEmail,
        })
      }

      const id = randomUUID()
      try {
        await client.query('SAVEPOINT usage_ingest')
        const inserted = await client.query(
          `INSERT INTO fin.usage_events (
             id, environment, residency_key, tenant_id, holder_id, billing_account_id,
             source_system, source_event_id, event_type, event_kind,
             corrects_event_id, corrects_residency_key, subject_type, subject_id,
             quantity_units, dimensions, occurred_at, received_at, ingestion_version,
             created_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,
             $7,$8,$9,$10,
             $11,$12,$13,$14,
             $15,$16::jsonb,$17,$18,$19,
             $20
           )
           ON CONFLICT (environment, source_system, source_event_id, residency_key)
           DO NOTHING
           RETURNING id`,
          [
            id, environment, residencyKey, input.tenantId || null,
            input.holderId || null, input.billingAccountId || null,
            input.sourceSystem, input.sourceEventId, input.eventType, eventKind,
            input.correctsEventId || null, input.correctsResidencyKey || null,
            input.subjectType || null, input.subjectId || null,
            input.quantityUnits, JSON.stringify(dimensions),
            occurredAt, receivedAt, ingestionVersion, now,
          ],
        )

        let eventId = inserted.rows[0]?.id
        let deduped = false
        if (!eventId) {
          const existing = await client.query(
            `SELECT id FROM fin.usage_events
              WHERE environment = $1 AND source_system = $2
                AND source_event_id = $3 AND residency_key = $4`,
            [environment, input.sourceSystem, input.sourceEventId, residencyKey],
          )
          eventId = existing.rows[0]?.id
          deduped = true
        }

        if (!eventId) {
          throw new Error('dedup lookup missed after ON CONFLICT DO NOTHING')
        }

        if (!deduped) {
          await insertOutbox(client, {
            environment,
            topic: 'fin.usage.received',
            dedupeKey: `usage:${residencyKey}:${eventId}`,
            payload: {
              id: eventId,
              residency_key: residencyKey,
              source_system: input.sourceSystem,
              source_event_id: input.sourceEventId,
              event_type: input.eventType,
            },
            now,
          })
        }

        await client.query('RELEASE SAVEPOINT usage_ingest')
        return { ok: true, id: eventId, deduped }
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT usage_ingest').catch(() => {})
        const errorCode = classifyUsageError(error)
        if (replayFromDlqId) {
          return { ok: false, error_code: errorCode }
        }
        return landDlq(client, {
          input: bound,
          residencyKey,
          errorCode,
          errorMessage: error.message,
          now,
          actorType,
          actorId,
          actorEmail,
        })
      }
    })
  } catch (error) {
    if (error?.name === 'FinError' || error?.code === 'EVENT_KIND_MISMATCH') throw error
    try {
      return await transaction(async (client) => landDlq(client, {
        input: bound,
        residencyKey: input.residencyKey || '__platform__',
        errorCode: classifyUsageError(error),
        errorMessage: error.message,
        now,
        actorType,
        actorId,
        actorEmail,
      }))
    } catch (dlqError) {
      error.dlqError = dlqError
      throw error
    }
  }
}
