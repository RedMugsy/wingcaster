/**
 * insertAccountingEvent — same-tx writer. No own idempotency claim.
 * HARD_CLOSED → trigger raises ACCOUNTING_PERIOD_HARD_CLOSED (do not retry).
 */
import { randomUUID } from 'node:crypto'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
import {
  asMinor, mapAccountingPgError, requireEventKind, requireSourceType,
} from './helpers.js'

export const LAUNCH_POLICY_ID = 'a0000000-0000-4000-8000-000000000009'

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function loadActivePolicy(client, { environment, now }) {
  const { rows } = await client.query(
    `SELECT * FROM fin.accounting_policy_versions
      WHERE (environment = $1 OR environment = 'LIVE')
        AND effective_from <= $2::timestamptz
        AND (effective_to IS NULL OR effective_to > $2::timestamptz)
      ORDER BY CASE WHEN environment = $1 THEN 0 ELSE 1 END, effective_from DESC
      LIMIT 1`,
    [environment || 'LIVE', now],
  )
  if (!rows[0]) {
    throw finError('ACCOUNTING_POLICY_NOT_FOUND', { category: CATEGORY.PRECONDITION })
  }
  return rows[0]
}

export async function resolveAccountingPeriod(client, {
  environment, legalEntityId, eventAt,
}) {
  const { rows } = await client.query(
    `SELECT * FROM fin.accounting_periods
      WHERE environment = $1
        AND legal_entity_id = $2
        AND starts_at <= $3::timestamptz
        AND ends_at > $3::timestamptz
      ORDER BY starts_at DESC
      LIMIT 1`,
    [environment, legalEntityId, eventAt],
  )
  if (!rows[0]) {
    throw finError('ACCOUNTING_PERIOD_NOT_FOUND', { category: CATEGORY.PRECONDITION })
  }
  return rows[0]
}

export async function insertAccountingEvent(client, input) {
  const eventKind = input.eventKind || input.event_kind
  const sourceType = input.sourceType || input.source_type
  const sourceId = input.sourceId || input.source_id
  const amountMinor = asMinor(input.amountMinor ?? input.amount_minor)
  const currency = input.currency
  const tenantId = input.tenantId || input.tenant_id
  const now = iso(input.now || input.eventAt)
  const eventAt = iso(input.eventAt || input.event_at || now)

  if (!client) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'insertAccountingEvent_requires_client' },
    })
  }
  requireEventKind(eventKind)
  requireSourceType(sourceType)
  if (!sourceId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'sourceId' },
    })
  }
  if (!currency || String(currency).length !== 3) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'currency' },
    })
  }
  if (!tenantId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'tenantId' },
    })
  }
  if (amountMinor < 0n) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'amountMinor' },
    })
  }

  const actor = input.actor || {}
  const policy = input.policyRow || await loadActivePolicy(client, {
    environment: input.environment || 'LIVE',
    now: eventAt,
  })
  const period = input.periodRow || await resolveAccountingPeriod(client, {
    environment: input.environment || 'LIVE',
    legalEntityId: input.legalEntityId || input.legal_entity_id,
    eventAt,
  })

  const id = randomUUID()
  try {
    await client.query(
      `INSERT INTO fin.accounting_events (
         id, environment, tenant_id, billing_account_id, legal_entity_id,
         event_kind, event_at, amount_minor, currency,
         source_type, source_id, ledger_transaction_id,
         accounting_policy_version_id, accounting_period_id, memo,
         created_at, created_by_actor_type, created_by_actor_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
       )`,
      [
        id,
        input.environment || 'LIVE',
        tenantId,
        input.billingAccountId || input.billing_account_id,
        input.legalEntityId || input.legal_entity_id,
        eventKind,
        eventAt,
        amountMinor.toString(),
        currency,
        sourceType,
        sourceId,
        input.ledgerTransactionId || input.ledger_transaction_id || null,
        policy.id,
        period.id,
        input.memo || null,
        now,
        actor.type || actor.actorType || input.actorType || 'SYSTEM',
        actor.id || actor.actorId || input.actorId || null,
      ],
    )
  } catch (error) {
    throw mapAccountingPgError(error)
  }

  return {
    id,
    eventKind,
    amountMinor: amountMinor.toString(),
    accountingPeriodId: period.id,
    accountingPolicyVersionId: policy.id,
    flaggedSoftClosed: period.status === 'SOFT_CLOSED',
  }
}

export async function insertEvaluatedEvents(client, {
  evaluated, tenantId, billingAccountId, legalEntityId, environment,
  ledgerTransactionId, now, actor, currency,
}) {
  const inserted = []
  for (const ev of evaluated.events || []) {
    inserted.push(await insertAccountingEvent(client, {
      environment,
      tenantId,
      billingAccountId,
      legalEntityId,
      eventKind: ev.eventKind,
      amountMinor: ev.amountMinor,
      currency: ev.currency || currency,
      sourceType: ev.sourceType,
      sourceId: ev.sourceId,
      ledgerTransactionId,
      memo: ev.memo,
      now,
      actor,
    }))
  }
  return inserted
}
