/**
 * Facts-only vendor usage ingest (Stage 2 mirror). No downstream rating hooks.
 * Dedupe on (vendor_id, source_event_id) WHERE source_event_id IS NOT NULL.
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../db.js'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import {
  asMinor, claim, envelope, finish, iso, lockVendor, nextKey, periodKeyFrom, withRetry,
} from './helpers.js'

function requireVendorId(vendorId) {
  if (!vendorId) throw finError('FIN_VENDOR_NOT_FOUND', { category: CATEGORY.VALIDATION })
}

function requireProductCode(code) {
  if (!code) throw finError('FIN_VENDOR_PRODUCT_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
}

function requireQuantity(quantityUnits) {
  if (quantityUnits == null || quantityUnits === '') {
    throw finError('FIN_VENDOR_QUANTITY_REQUIRED', { category: CATEGORY.VALIDATION })
  }
}

export async function ingestVendorUsageEventWithClient(client, input) {
  const env = envelope(input)
  const vendorId = input.vendorId ?? input.vendor_id
  const productCode = input.vendorProductCode ?? input.vendor_product_code
  const quantityUnits = asMinor(input.quantityUnits ?? input.quantity_units)
  requireVendorId(vendorId)
  requireProductCode(productCode)
  requireQuantity(input.quantityUnits ?? input.quantity_units)

  const occurredAt = iso(input.occurredAt ?? input.occurred_at ?? env.now)
  const receivedAt = iso(input.receivedAt ?? input.received_at ?? env.now)
  const sourceEventId = input.sourceEventId ?? input.source_event_id ?? null
  const dimensions = input.dimensions || {}
  const id = randomUUID()

  const inserted = await client.query(
    `INSERT INTO fin.vendor_usage_events (
       id, vendor_id, vendor_product_code, environment, tenant_id, holder_id,
       source_event_id, quantity_units, occurred_at, received_at, dimensions, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
     ON CONFLICT (vendor_id, source_event_id) WHERE source_event_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [
      id, vendorId, productCode, env.environment,
      input.tenantId ?? input.tenant_id ?? null,
      input.holderId ?? input.holder_id ?? null,
      sourceEventId, quantityUnits.toString(), occurredAt, receivedAt,
      JSON.stringify(dimensions), receivedAt,
    ],
  )

  let eventId = inserted.rows[0]?.id
  let deduped = false
  if (!eventId) {
    const existing = await client.query(
      `SELECT id FROM fin.vendor_usage_events
        WHERE vendor_id = $1 AND source_event_id = $2`,
      [vendorId, sourceEventId],
    )
    eventId = existing.rows[0]?.id
    deduped = true
  }
  if (!eventId) {
    throw new Error('vendor usage dedup lookup missed after ON CONFLICT DO NOTHING')
  }

  if (!deduped) {
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.usage.received',
      dedupeKey: `vusage:${vendorId}:${eventId}`,
      payload: {
        id: eventId,
        vendor_id: vendorId,
        vendor_product_code: productCode,
        source_event_id: sourceEventId,
      },
      now: receivedAt,
    })
  }

  return { ok: true, id: eventId, deduped }
}

export async function ingestVendorUsageEvent(input) {
  return transaction(async (client) => ingestVendorUsageEventWithClient(client, input))
}

export async function upsertReportedUsage(input) {
  const vendorId = input.vendorId ?? input.vendor_id
  const productCode = input.vendorProductCode ?? input.vendor_product_code
  const periodKey = input.reportingPeriodKey ?? input.reporting_period_key
    ?? periodKeyFrom(input.occurredAt || input.now)
  const quantityUnits = asMinor(input.quantityUnits ?? input.quantity_units)
  const currency = input.currency
  requireVendorId(vendorId)
  requireProductCode(productCode)
  requireQuantity(input.quantityUnits ?? input.quantity_units)
  if (!currency || String(currency).length !== 3) {
    throw finError('FIN_VENDOR_CURRENCY_INVALID', { category: CATEGORY.VALIDATION })
  }
  const env = envelope(input)
  const key = env.idempotencyKey || nextKey(`VENDOR_REPORTED:${vendorId}:${productCode}:${periodKey}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'UpsertReportedUsage', vendorId, productCode, periodKey,
      quantityUnits: quantityUnits.toString(),
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const vendor = await lockVendor(client, vendorId)
    if (!vendor) throw finError('FIN_VENDOR_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })

    const existing = (await client.query(
      `SELECT * FROM fin.vendor_reported_usage
        WHERE vendor_id = $1 AND vendor_product_code = $2 AND reporting_period_key = $3
        FOR UPDATE`,
      [vendorId, productCode, periodKey],
    )).rows[0]

    let id
    if (existing) {
      id = existing.id
      await client.query(
        `UPDATE fin.vendor_reported_usage
            SET quantity_units = $2, currency = $3, updated_at = $4,
                updated_by_actor_type = $5, updated_by_actor_id = $6
          WHERE id = $1`,
        [id, quantityUnits.toString(), currency, env.now, env.actorType, env.actorId],
      )
    } else {
      id = randomUUID()
      await client.query(
        `INSERT INTO fin.vendor_reported_usage (
           id, vendor_id, vendor_product_code, environment, reporting_period_key,
           quantity_units, currency,
           created_at, created_by_actor_type, created_by_actor_id,
           updated_at, updated_by_actor_type, updated_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$8,$9,$10)`,
        [
          id, vendorId, productCode, vendor.environment, periodKey,
          quantityUnits.toString(), currency,
          env.now, env.actorType, env.actorId,
        ],
      )
    }
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'VENDOR_REPORTED_USAGE_UPSERTED',
      targetType: 'VENDOR_REPORTED_USAGE',
      targetId: id,
      afterState: { vendorId, productCode, periodKey, quantityUnits: quantityUnits.toString() },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.reported_usage',
      dedupeKey: `vrep:${id}:v${existing ? Number(existing.version) + 1 : 1}`,
      payload: { id, vendorId, productCode, periodKey },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'UpsertReportedUsage',
      id,
      vendorId,
      reportingPeriodKey: periodKey,
    })
  })
}
