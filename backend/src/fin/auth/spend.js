/**
 * A/B-1 closer: ingest + meter + rate + authorize/capture inside ONE transaction().
 * Parallel fin.* path; billing/events.js is untouched (Stage 13).
 */
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
import { insertOutbox, loadBook } from '../ledger/write.js'
import { directSpend } from '../ledger/transactions.js'
import { meterPeriod } from '../metering/pipeline.js'
import { periodKeyFromNow, periodWindow } from '../metering/worker.js'
import { rateMeteredUsage } from '../rating/engine.js'
import { ingestUsageEventWithClient } from '../usage/ingest.js'
import { authorizeUsage, lockAndResolvePlan } from './authorize.js'
import { captureUsage } from './capture.js'

const STRATEGIES = new Set(['AUTHORIZE_AND_CAPTURE', 'DIRECT_SPEND', 'AUTHORIZE_ONLY'])

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

async function resolveMeterVersionId(client, { meterId, environment, now }) {
  if (!meterId) {
    throw finError('FIN_METER_VERSION_NOT_FOUND', { category: CATEGORY.PRECONDITION })
  }
  const { rows } = await client.query(
    `SELECT id FROM fin.meter_versions
      WHERE meter_id = $1 AND environment = $2
        AND effective_from <= $3::timestamptz
        AND (effective_to IS NULL OR effective_to > $3::timestamptz)
      ORDER BY version_n DESC
      LIMIT 1`,
    [meterId, environment, now],
  )
  if (!rows[0]) {
    throw finError('FIN_METER_VERSION_NOT_FOUND', { category: CATEGORY.PRECONDITION })
  }
  return rows[0].id
}

export async function spendCredits(input) {
  const strategy = input.strategy || 'AUTHORIZE_AND_CAPTURE'
  if (!STRATEGIES.has(strategy)) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'unknown_spend_strategy', strategy },
    })
  }
  if (!input.reasonCode) {
    throw finError('REASON_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
  }

  const now = iso(input.now)
  const environment = input.environment || 'LIVE'
  const occurredAt = iso(input.occurredAt || now)
  const receivedAt = iso(input.receivedAt || now)
  const actorType = input.actorType || 'SYSTEM'
  const actorId = input.actorId || null
  const actorEmail = input.actorEmail || 'system@fin.local'
  const idempotencyKey = input.idempotencyKey
    || `SPEND:${input.sourceSystem}:${input.sourceEventId}`

  return transaction(async (client) => {
    const book = await loadBook(client, input.bookId)
    const ingested = await ingestUsageEventWithClient(client, {
      environment,
      tenantId: input.tenantId,
      holderId: input.holderId,
      billingAccountId: book?.billing_account_id || input.billingAccountId,
      sourceSystem: input.sourceSystem,
      sourceEventId: input.sourceEventId,
      eventType: input.eventType,
      quantityUnits: input.unitsRequested,
      dimensions: input.dimensions || {},
      occurredAt,
      receivedAt,
      subjectType: input.subjectType || null,
      subjectId: input.subjectId || null,
      now,
      actorType,
      actorId,
      actorEmail,
    })
    if (!ingested.ok) {
      return {
        ok: false,
        denialCode: ingested.error_code,
        usageEventId: null,
      }
    }

    const meterVersionId = input.meterVersionId || await resolveMeterVersionId(client, {
      meterId: input.meterId,
      environment,
      now,
    })
    const monthKey = periodKeyFromNow(occurredAt)
    const { windowStart, windowEnd } = periodWindow(monthKey)
    const metered = await meterPeriod({
      environment,
      meterVersionId,
      holderId: input.holderId,
      periodKey: `sync:${input.sourceEventId}`,
      windowStart,
      windowEnd,
      sourceEventId: input.sourceEventId,
      now,
      actorType,
      actorId,
      actorEmail,
    })
    if (!metered.ok) {
      throw finError(metered.error_code || 'FIN_METER_VERSION_NOT_FOUND', {
        category: CATEGORY.PRECONDITION,
      })
    }

    const rated = await rateMeteredUsage({
      environment,
      meteredUsageId: metered.meteredUsageId,
      now,
      actorType,
      actorId,
      actorEmail,
    })

    const authInput = {
      environment,
      tenantId: input.tenantId,
      holderId: input.holderId,
      bookId: input.bookId,
      meterId: input.meterId,
      actionKey: input.actionKey,
      category: input.category,
      vendorId: input.vendorId,
      unitsRequested: input.unitsRequested,
      subjectType: 'RATED_USAGE',
      subjectId: rated.ratedUsageId,
      ratedUsageId: rated.ratedUsageId,
      idempotencyKey,
      now,
      actorType,
      actorId,
      actorEmail,
      reasonCode: input.reasonCode,
      expiresAt: input.expiresAt,
    }

    let holdId = null
    let txId = null
    let denialCode = null
    let ok = true

    if (strategy === 'DIRECT_SPEND') {
      const { plan } = await lockAndResolvePlan(client, authInput)
      if (!plan.covered) {
        ok = false
        denialCode = 'INSUFFICIENT_ELIGIBLE_CREDITS'
      } else {
        const spent = await directSpend({
          environment,
          tenantId: input.tenantId,
          holderId: input.holderId,
          bookId: input.bookId,
          lotId: plan.allocations[0]?.lotId,
          units: Number(input.unitsRequested),
          ratedUsageId: rated.ratedUsageId,
          economicSourceId: rated.ratedUsageId,
          idempotencyKey: `SPEND:${rated.ratedUsageId}`,
          now,
          actorType,
          actorId,
          actorEmail,
          reasonCode: input.reasonCode,
        })
        txId = spent.txId
      }
    } else {
      const authorized = await authorizeUsage(authInput)
      ok = authorized.ok
      holdId = authorized.holdId || null
      txId = authorized.txId || null
      denialCode = authorized.denialCode || null
      if (ok && strategy === 'AUTHORIZE_AND_CAPTURE') {
        const captured = await captureUsage({
          holdId,
          idempotencyKey: `CAPTURE:${holdId}`,
          now,
          actorType,
          actorId,
          actorEmail,
          reasonCode: input.reasonCode,
        })
        txId = captured.txId
      }
    }

    await insertOutbox(client, {
      environment,
      topic: 'fin.spend.completed',
      dedupeKey: `spend:${idempotencyKey}:${strategy}`,
      payload: {
        ok,
        strategy,
        usage_event_id: ingested.id,
        rated_usage_id: rated.ratedUsageId,
        hold_id: holdId,
        tx_id: txId,
        denial_code: denialCode,
      },
      now,
    })

    return {
      ok,
      holdId,
      txId,
      usageEventId: ingested.id,
      ratedUsageId: rated.ratedUsageId,
      amountMinor: rated.amountMinor,
      denialCode,
    }
  })
}
