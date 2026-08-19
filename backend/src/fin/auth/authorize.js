/**
 * Stage 6 authorize engine. Resolves eligible lots, enforces usage_limits,
 * then calls Stage 1 authorizeHold (single-lot) or write.js (N-lot, DL-085).
 * Nested transaction() joins the caller (spendCredits) — A/B-1 one tx.
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
import { claimIdempotency, completeIdempotency } from '../idempotency/claim.js'
import { requestFingerprint } from '../idempotency/fingerprint.js'
import { lockAccounts, lockBooks, lockLots } from '../ledger/locks.js'
import { authorizeHold } from '../ledger/transactions.js'
import {
  insertAllocation, insertAudit, insertAuthAttempt, insertLedgerTx,
  insertOutbox, insertPostingPair, loadAccounts, loadBook,
} from '../ledger/write.js'
import { resolveDrawPlan } from './lot-resolver.js'

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function asUnits(value) {
  if (value == null || value === '') return 0n
  return BigInt(value)
}

function isoWeekKey(date) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7)
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function limitPeriodKey(periodKind, now) {
  const date = new Date(iso(now))
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  if (periodKind === 'DAY') return `${year}-${month}-${day}`
  if (periodKind === 'WEEK') return isoWeekKey(date)
  if (periodKind === 'ROLLING_30D') return `R30:${year}-${month}-${day}`
  if (periodKind === 'CONTRACT_TERM') return 'CONTRACT_TERM'
  return `${year}-${month}`
}

function serializeAllocations(allocations) {
  return allocations.map((row) => ({
    lotId: row.lotId,
    units: row.units.toString(),
  }))
}

function actorOf(input) {
  return {
    actorType: input.actorType || 'SYSTEM',
    actorId: input.actorId || null,
    actorEmail: input.actorEmail || 'system@fin.local',
  }
}

export async function loadActiveLotsForUpdate(client, {
  holderId, bookId, environment,
}) {
  const { rows } = await client.query(
    `SELECT l.id, l.status, l.remaining_units, l.draw_priority, l.expires_at, l.issued_at
       FROM fin.lots l
      WHERE l.holder_id = $1
        AND l.book_id = $2
        AND l.environment = $3
        AND l.status = 'ACTIVE'
      ORDER BY l.draw_priority ASC, l.expires_at ASC NULLS LAST, l.issued_at ASC, l.id ASC
      FOR UPDATE`,
    [holderId, bookId, environment],
  )
  if (!rows.length) return []
  const rules = await client.query(
    `SELECT lot_id, rule_kind, matcher
       FROM fin.lot_applicability_rules
      WHERE lot_id = ANY($1::uuid[])`,
    [rows.map((row) => row.id)],
  )
  const byLot = new Map()
  for (const rule of rules.rows) {
    const list = byLot.get(rule.lot_id) || []
    list.push(rule)
    byLot.set(rule.lot_id, list)
  }
  return rows.map((row) => ({ ...row, rules: byLot.get(row.id) || [] }))
}

export async function lockAndResolvePlan(client, input) {
  const environment = input.environment || 'LIVE'
  const now = iso(input.now)
  const book = await loadBook(client, input.bookId)
  if (!book || book.environment !== environment) {
    throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
  }
  const accounts = await loadAccounts(client, book.id)
  await lockBooks(client, [book.id])
  await lockAccounts(client, Object.values(accounts))
  const lots = await loadActiveLotsForUpdate(client, {
    holderId: input.holderId,
    bookId: book.id,
    environment,
  })
  const plan = resolveDrawPlan({
    lots,
    meterId: input.meterId,
    actionKey: input.actionKey,
    category: input.category,
    vendorId: input.vendorId,
    unitsRequested: input.unitsRequested,
    now,
  })
  if (plan.allocations.length) {
    await lockLots(client, plan.allocations.map((row) => row.lotId))
  }
  return { book, accounts, plan }
}

async function matchingLimits(client, { environment, tenantId, meterId, now }) {
  if (!meterId) return []
  const { rows } = await client.query(
    `SELECT id, period_kind, limit_units, breach_behavior
       FROM fin.usage_limits
      WHERE environment = $1 AND tenant_id = $2 AND meter_id = $3`,
    [environment, tenantId, meterId],
  )
  const matched = []
  for (const limit of rows) {
    const periodKey = limitPeriodKey(limit.period_kind, now)
    const counter = await client.query(
      `SELECT id, consumed_units FROM fin.limit_counters
        WHERE usage_limit_id = $1 AND period_key = $2`,
      [limit.id, periodKey],
    )
    matched.push({
      ...limit,
      periodKey,
      counterId: counter.rows[0]?.id || null,
      consumedUnits: asUnits(counter.rows[0]?.consumed_units ?? 0),
    })
  }
  return matched
}

async function bumpLimitCounters(client, { environment, limits, units }) {
  const delta = units.toString()
  for (const limit of limits) {
    if (limit.counterId) {
      await client.query(
        `UPDATE fin.limit_counters
            SET consumed_units = consumed_units + $2
          WHERE id = $1`,
        [limit.counterId, delta],
      )
    } else {
      await client.query(
        `INSERT INTO fin.limit_counters (
           id, usage_limit_id, environment, period_key, consumed_units
         ) VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), limit.id, environment, limit.periodKey, delta],
      )
    }
  }
}

async function writeDeniedAttempt(client, {
  environment, holderId, denialCode, ratedUsageId, now, actor, reasonCode,
}) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO fin.authorization_attempts (
       id, environment, holder_id, result, denial_code, hold_id, rated_usage_id, created_at
     ) VALUES ($1,$2,$3,'DENIED',$4,NULL,$5,$6)`,
    [id, environment, holderId, denialCode, ratedUsageId || null, now],
  )
  await insertAudit(client, {
    environment,
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    action: 'HOLD_DENIED',
    targetType: 'HOLDER',
    targetId: holderId,
    afterState: { denialCode },
    reasonCode,
    now,
  })
  return id
}

async function authorizeHoldPlan(client, {
  environment, book, accounts, plan, units, input, now, actor, claimed,
}) {
  const holdId = randomUUID()
  const txId = await insertLedgerTx(client, {
    environment,
    bookId: book.id,
    shape: 'HOLD',
    economicSourceType: 'HOLD',
    economicSourceId: holdId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    reasonCode: input.reasonCode,
    idempotencyKeyId: claimed.row.id,
    now,
  })
  await client.query(
    `INSERT INTO fin.holds (
       id, environment, tenant_id, holder_id, billing_account_id, book_id,
       subject_type, subject_id, units, status, authorize_tx_id, expires_at,
       created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',$10,$11,$12,$12)`,
    [
      holdId, environment, book.tenant_id, input.holderId,
      book.billing_account_id, book.id, input.subjectType || 'RATED_USAGE',
      input.subjectId || input.ratedUsageId || randomUUID(),
      units.toString(), txId, input.expiresAt || '2099-01-01T00:00:00.000Z', now,
    ],
  )
  for (const allocation of plan.allocations) {
    const take = Number(allocation.units)
    const posts = await insertPostingPair(client, {
      environment,
      transactionId: txId,
      bookId: book.id,
      accounts,
      debitType: 'AVAILABLE',
      creditType: 'HELD',
      units: take,
      debitLotId: allocation.lotId,
      now,
    })
    await insertAllocation(client, {
      environment,
      lotId: allocation.lotId,
      postingId: posts.debitId,
      units: -take,
      holdId,
      now,
    })
  }
  await insertAuthAttempt(client, {
    environment, holderId: input.holderId, result: 'AUTHORIZED', holdId, now,
  })
  await insertAudit(client, {
    environment,
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    action: 'HOLD_AUTHORIZED',
    targetType: 'HOLD',
    targetId: holdId,
    afterState: { txId, units: units.toString() },
    reasonCode: input.reasonCode,
    now,
  })
  await insertOutbox(client, {
    environment, topic: 'fin.hold.authorized', dedupeKey: `hold:${holdId}`,
    payload: { holdId, txId }, now,
  })
  await insertOutbox(client, {
    environment, topic: 'fin.ledger.posted', dedupeKey: `tx:${txId}`,
    payload: { txId }, now,
  })
  const attempt = await client.query(
    `SELECT id FROM fin.authorization_attempts WHERE hold_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [holdId],
  )
  return {
    holdId, txId, authorizationAttemptId: attempt.rows[0]?.id || null,
  }
}

export async function authorizeUsage(input) {
  const now = iso(input.now)
  const environment = input.environment || 'LIVE'
  const unitsRequested = asUnits(input.unitsRequested)
  const actor = actorOf(input)
  const key = input.idempotencyKey || `AUTH:HOLD:${input.subjectId || input.ratedUsageId || randomUUID()}`

  return transaction(async (client) => {
    if (!input.reasonCode) {
      throw finError('REASON_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
    }
    const claimed = await claimIdempotency(client, {
      environment,
      tenantId: input.tenantId || null,
      key,
      fingerprint: requestFingerprint({
        cmd: 'AuthorizeUsage',
        holderId: input.holderId,
        bookId: input.bookId,
        meterId: input.meterId || null,
        unitsRequested: unitsRequested.toString(),
        ratedUsageId: input.ratedUsageId || null,
      }),
      now,
      actorType: actor.actorType,
      actorId: actor.actorId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const { book, accounts, plan } = await lockAndResolvePlan(client, {
      ...input, environment, now,
    })

    const limits = await matchingLimits(client, {
      environment,
      tenantId: input.tenantId || book.tenant_id,
      meterId: input.meterId,
      now,
    })
    const blocked = limits.find((limit) => (
      limit.breach_behavior === 'BLOCK'
      && limit.consumedUnits + unitsRequested > asUnits(limit.limit_units)
    ))

    const finish = async (body) => {
      await completeIdempotency(client, { id: claimed.row.id, now, body })
      return body
    }

    if (blocked) {
      const authorizationAttemptId = await writeDeniedAttempt(client, {
        environment, holderId: input.holderId, denialCode: 'LIMIT_BLOCKED',
        ratedUsageId: input.ratedUsageId, now, actor, reasonCode: input.reasonCode,
      })
      return finish({
        ok: false,
        denialCode: 'LIMIT_BLOCKED',
        authorizationAttemptId,
        allocations: serializeAllocations(plan.allocations),
      })
    }

    if (!plan.covered) {
      const authorizationAttemptId = await writeDeniedAttempt(client, {
        environment, holderId: input.holderId,
        denialCode: 'INSUFFICIENT_ELIGIBLE_CREDITS',
        ratedUsageId: input.ratedUsageId, now, actor, reasonCode: input.reasonCode,
      })
      return finish({
        ok: false,
        denialCode: 'INSUFFICIENT_ELIGIBLE_CREDITS',
        authorizationAttemptId,
        allocations: serializeAllocations(plan.allocations),
      })
    }

    let held
    if (plan.allocations.length === 1) {
      held = await authorizeHold({
        environment,
        tenantId: input.tenantId,
        holderId: input.holderId,
        bookId: input.bookId,
        lotId: plan.allocations[0].lotId,
        units: Number(unitsRequested),
        subjectType: input.subjectType || 'RATED_USAGE',
        subjectId: input.subjectId || input.ratedUsageId,
        ratedUsageId: input.ratedUsageId,
        expiresAt: input.expiresAt,
        idempotencyKey: `${key}:hold`,
        now,
        ...actor,
        reasonCode: input.reasonCode,
      })
      const attempt = await client.query(
        `SELECT id FROM fin.authorization_attempts WHERE hold_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [held.holdId],
      )
      held = {
        holdId: held.holdId,
        txId: held.txId,
        authorizationAttemptId: attempt.rows[0]?.id || null,
      }
    } else {
      held = await authorizeHoldPlan(client, {
        environment, book, accounts, plan, units: unitsRequested,
        input, now, actor, claimed,
      })
    }

    await bumpLimitCounters(client, { environment, limits, units: unitsRequested })
    return finish({
      ok: true,
      holdId: held.holdId,
      txId: held.txId,
      allocations: serializeAllocations(plan.allocations),
      authorizationAttemptId: held.authorizationAttemptId,
    })
  })
}
