/**
 * Metering aggregator: fin.usage_events → fin.metered_usage (+ sources).
 * Facts only (DL-007). APPEND_ONLY supersede-via-new-row (A §6.5 / B §0.2).
 * Composite FK on sources (DL-021 / M1). Does not write commercial.* .
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../db.js'
import { CATEGORY, finError } from '../errors.js'
import { FIN_METERING } from '../foundation/advisory-locks.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import { filterToSql, validateFilter } from './filter.js'
import { sha256Canonical } from './hash.js'

function iso(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function asUnits(value) {
  if (value == null) return 0n
  return BigInt(value)
}

function effectiveQuantity(event) {
  if (event.event_kind === 'CANCELLATION') return 0n
  return asUnits(event.quantity_units)
}

function epochMs(value) {
  if (!value) return NaN
  if (value instanceof Date) return value.getTime()
  return Date.parse(value)
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const at = epochMs(a.occurred_at) - epochMs(b.occurred_at)
    if (at !== 0) return at
    const id = String(a.id).localeCompare(String(b.id))
    if (id !== 0) return id
    return String(a.residency_key).localeCompare(String(b.residency_key))
  })
}

function durationSeconds(fromIso, toIso) {
  const from = epochMs(fromIso)
  const to = epochMs(toIso)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0n
  return BigInt(Math.max(0, Math.floor((to - from) / 1000)))
}

function pickWinner(events, compare) {
  let winner = null
  for (const event of events) {
    if (!winner || compare(event, winner) > 0) winner = event
  }
  return winner
}

export function aggregateEvents(events, aggregationType, { windowEnd } = {}) {
  const sorted = sortEvents(events)
  const contributions = new Map()
  let quantity = 0n

  const setAll = (fn) => {
    quantity = 0n
    contributions.clear()
    for (const event of sorted) {
      const units = fn(event)
      contributions.set(`${event.id}:${event.residency_key}`, units)
      quantity += units
    }
  }

  if (aggregationType === 'SUM') {
    setAll((event) => effectiveQuantity(event))
  } else if (aggregationType === 'COUNT') {
    setAll((event) => (event.event_kind === 'CANCELLATION' ? 0n : 1n))
  } else if (aggregationType === 'UNIQUE_COUNT') {
    const seen = new Set()
    setAll((event) => {
      if (event.event_kind === 'CANCELLATION') return 0n
      if (event.subject_id == null) return 0n
      const key = String(event.subject_id)
      if (seen.has(key)) return 0n
      seen.add(key)
      return 1n
    })
  } else if (aggregationType === 'MAX') {
    const winner = pickWinner(sorted, (a, b) => {
      const dq = effectiveQuantity(a) - effectiveQuantity(b)
      if (dq !== 0n) return dq > 0n ? 1 : -1
      const dt = epochMs(a.occurred_at) - epochMs(b.occurred_at)
      if (dt !== 0) return dt
      return String(a.id).localeCompare(String(b.id))
    })
    setAll((event) => (
      winner && event.id === winner.id && event.residency_key === winner.residency_key
        ? effectiveQuantity(event)
        : 0n
    ))
  } else if (aggregationType === 'LATEST') {
    const winner = pickWinner(sorted, (a, b) => {
      const dt = epochMs(a.occurred_at) - epochMs(b.occurred_at)
      if (dt !== 0) return dt
      return String(a.id).localeCompare(String(b.id))
    })
    setAll((event) => (
      winner && event.id === winner.id && event.residency_key === winner.residency_key
        ? effectiveQuantity(event)
        : 0n
    ))
  } else if (aggregationType === 'TIME_WEIGHTED') {
    // DL-066: integer seconds; last event weighted to windowEnd. Stage 5 owns
    // fractional / calendar-weight nits if rating needs a different grain.
    quantity = 0n
    for (let i = 0; i < sorted.length; i += 1) {
      const event = sorted[i]
      const next = sorted[i + 1]
      const end = next ? next.occurred_at : windowEnd
      const units = effectiveQuantity(event) * durationSeconds(event.occurred_at, end)
      contributions.set(`${event.id}:${event.residency_key}`, units)
      quantity += units
    }
  } else {
    throw finError('FIN_FILTER_INVALID', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'unknown_aggregation_type', aggregationType },
    })
  }

  return {
    quantityUnits: quantity,
    sources: sorted.map((event) => ({
      usageEventId: event.id,
      residencyKey: event.residency_key,
      contributionUnits: contributions.get(`${event.id}:${event.residency_key}`) ?? 0n,
    })),
  }
}

function lockKey(meterVersionId, holderId, periodKey) {
  return `${meterVersionId}:${holderId}:${periodKey}`
}

async function loadMeterVersion(client, meterVersionId) {
  const { rows } = await client.query(
    `SELECT id, meter_id, environment, version_n, aggregation_type,
            filter_definition, effective_from, effective_to
       FROM fin.meter_versions WHERE id = $1`,
    [meterVersionId],
  )
  return rows[0] || null
}

async function loadHolder(client, holderId) {
  const { rows } = await client.query(
    `SELECT id, environment, tenant_id FROM fin.holders WHERE id = $1`,
    [holderId],
  )
  return rows[0] || null
}

async function loadMatchingEvents(client, {
  environment, holderId, tenantId, windowStart, windowEnd, filterSql, filterParams,
  sourceEventId = null,
}) {
  const { rows } = await client.query(
    `WITH RECURSIVE matching AS (
       SELECT e.id, e.residency_key, e.environment, e.tenant_id, e.holder_id,
              e.event_type, e.event_kind, e.subject_id, e.quantity_units,
              e.dimensions, e.occurred_at, e.corrects_event_id, e.corrects_residency_key
         FROM fin.usage_events e
        WHERE e.environment = $1
          AND e.holder_id = $2
          AND e.tenant_id = $3
          AND e.occurred_at >= $4::timestamptz
          AND e.occurred_at < $5::timestamptz
          AND ($6::text IS NULL OR e.source_event_id = $6)
          AND (${filterSql})
       UNION
       SELECT c.id, c.residency_key, c.environment, c.tenant_id, c.holder_id,
              c.event_type, c.event_kind, c.subject_id, c.quantity_units,
              c.dimensions, c.occurred_at, c.corrects_event_id, c.corrects_residency_key
         FROM fin.usage_events c
         JOIN matching m
           ON c.corrects_event_id = m.id
          AND c.corrects_residency_key = m.residency_key
          AND c.environment = m.environment
     )
     SELECT m.*
       FROM matching m
      WHERE NOT EXISTS (
        SELECT 1 FROM fin.usage_events x
         WHERE x.corrects_event_id = m.id
           AND x.corrects_residency_key = m.residency_key
      )
      ORDER BY m.id, m.residency_key`,
    [environment, holderId, tenantId, windowStart, windowEnd, sourceEventId || null, ...filterParams],
  )
  return rows
}

function computationPayload({
  meterVersionId, holderId, periodKey, windowStart, windowEnd,
  events, aggregationType, filterDefinition, quantityUnits,
}) {
  const eventIds = [...events]
    .map((event) => ({ id: String(event.id), residency_key: String(event.residency_key) }))
    .sort((a, b) => {
      const id = a.id.localeCompare(b.id)
      return id !== 0 ? id : a.residency_key.localeCompare(b.residency_key)
    })
  return {
    meterVersionId: String(meterVersionId),
    holderId: String(holderId),
    periodKey: String(periodKey),
    windowStart: iso(windowStart),
    windowEnd: iso(windowEnd),
    eventIds,
    aggregation_type: aggregationType,
    filter_definition_snapshot: filterDefinition,
    quantity_units: quantityUnits.toString(),
  }
}

async function insertSources(client, meteredUsageId, sources) {
  if (!sources.length) return
  const values = []
  const params = []
  let i = 1
  for (const source of sources) {
    values.push(`($${i},$${i + 1},$${i + 2},$${i + 3})`)
    params.push(meteredUsageId, source.usageEventId, source.residencyKey, source.contributionUnits.toString())
    i += 4
  }
  await client.query(
    `INSERT INTO fin.metered_usage_sources (
       metered_usage_id, usage_event_id, residency_key, contribution_units
     ) VALUES ${values.join(',')}`,
    params,
  )
}

export async function meterPeriod(input) {
  const environment = input.environment
  const meterVersionId = input.meterVersionId
  const holderId = input.holderId
  const periodKey = input.periodKey
  const windowStart = iso(input.windowStart)
  const windowEnd = iso(input.windowEnd)
  const now = iso(input.now)
  const actorType = input.actorType || 'WORKER'
  const actorId = input.actorId || null
  const actorEmail = input.actorEmail || 'system@fin.local'
  const sourceEventId = input.sourceEventId || null
  const key = lockKey(meterVersionId, holderId, periodKey)

  return transaction(async (client) => {
    const locked = await client.query(
      'SELECT pg_try_advisory_lock($1, hashtext($2::text)) AS ok',
      [FIN_METERING, key],
    )
    if (!locked.rows[0].ok) {
      return { ok: false, error_code: 'METERING_LOCK_HELD' }
    }

    try {
      const version = await loadMeterVersion(client, meterVersionId)
      if (!version || epochMs(version.effective_from) > epochMs(now)) {
        throw finError('FIN_METER_VERSION_NOT_FOUND', { category: CATEGORY.PRECONDITION })
      }
      if (version.environment !== environment) {
        throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
      }

      const holder = await loadHolder(client, holderId)
      if (!holder || holder.environment !== environment) {
        throw finError('FIN_METER_VERSION_NOT_FOUND', {
          category: CATEGORY.PRECONDITION,
          details: { reason: 'holder_not_found' },
        })
      }
      const tenantId = holder.tenant_id
      const filterDefinition = validateFilter(version.filter_definition || {})
      const { where, params: filterParams } = filterToSql(filterDefinition, 'e', 7)

      const events = await loadMatchingEvents(client, {
        environment,
        holderId,
        tenantId,
        windowStart,
        windowEnd,
        filterSql: where,
        filterParams,
        sourceEventId,
      })

      const { quantityUnits, sources } = aggregateEvents(events, version.aggregation_type, {
        windowEnd,
      })
      const computationHash = sha256Canonical(computationPayload({
        meterVersionId,
        holderId,
        periodKey,
        windowStart,
        windowEnd,
        events,
        aggregationType: version.aggregation_type,
        filterDefinition,
        quantityUnits,
      }))

      const existing = await client.query(
        `SELECT id, computation_hash
           FROM fin.metered_usage
          WHERE meter_version_id = $1
            AND holder_id = $2
            AND period_key = $3
            AND environment = $4
            AND status = 'ACTIVE'
          FOR UPDATE`,
        [meterVersionId, holderId, periodKey, environment],
      )
      const current = existing.rows[0]
      if (current && current.computation_hash === computationHash) {
        return {
          ok: true,
          meteredUsageId: current.id,
          quantityUnits: Number(quantityUnits),
          computationHash,
          sourceCount: sources.length,
          deduped: true,
        }
      }

      let supersededId = null
      if (current) {
        const flipped = await client.query(
          `UPDATE fin.metered_usage
              SET status = 'SUPERSEDED'
            WHERE id = $1 AND status = 'ACTIVE'`,
          [current.id],
        )
        if (flipped.rowCount !== 1) {
          throw finError('OCC_VERSION_MISMATCH', {
            category: CATEGORY.CONFLICT,
            httpStatus: 412,
          })
        }
        supersededId = current.id
      }

      const meteredUsageId = randomUUID()
      await client.query(
        `INSERT INTO fin.metered_usage (
           id, environment, tenant_id, meter_version_id, holder_id, period_key,
           quantity_units, computation_hash, supersedes_id, status, metered_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10)`,
        [
          meteredUsageId, environment, tenantId, meterVersionId, holderId, periodKey,
          quantityUnits.toString(), computationHash, supersededId, now,
        ],
      )
      await insertSources(client, meteredUsageId, sources)

      await insertOutbox(client, {
        environment,
        topic: 'fin.metering.completed',
        dedupeKey: `metering:${meterVersionId}:${holderId}:${periodKey}:${computationHash}`,
        payload: {
          metered_usage_id: meteredUsageId,
          meter_version_id: meterVersionId,
          holder_id: holderId,
          period_key: periodKey,
          quantity_units: quantityUnits.toString(),
          computation_hash: computationHash,
          source_count: sources.length,
          superseded_id: supersededId,
        },
        now,
      })
      await insertAudit(client, {
        environment,
        actorType,
        actorId,
        actorEmail,
        action: 'METERED',
        targetType: 'METERED_USAGE',
        targetId: meteredUsageId,
        afterState: {
          quantityUnits: quantityUnits.toString(),
          computationHash,
          sourceCount: sources.length,
          ...(supersededId ? { supersededPreviousId: supersededId } : {}),
        },
        reasonCode: 'METERED',
        now,
      })

      return {
        ok: true,
        meteredUsageId,
        quantityUnits: Number(quantityUnits),
        computationHash,
        sourceCount: sources.length,
        ...(supersededId ? { superseded: supersededId } : {}),
      }
    } finally {
      await client.query(
        'SELECT pg_advisory_unlock($1, hashtext($2::text))',
        [FIN_METERING, key],
      )
    }
  })
}
