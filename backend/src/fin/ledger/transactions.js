/**
 * Sole legal writer of fin.ledger_transactions + fin.ledger_postings (C §5).
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../db.js'
import { CATEGORY, finError } from '../errors.js'
import { requestFingerprint } from '../idempotency/fingerprint.js'
import { claimIdempotency, completeIdempotency } from '../idempotency/claim.js'
import { lockAccounts, lockBooks, lockHolds, lockLots } from './locks.js'
import {
  insertAllocation, insertAudit, insertAuthAttempt, insertLedgerTx, insertLot,
  insertOutbox, insertPostingPair, loadAccounts, loadBook,
} from './write.js'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function requireReason(reasonCode) {
  if (!reasonCode) {
    throw finError('REASON_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
  }
}

function requireKey(key) {
  if (!key) {
    throw finError('REASON_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
  }
}

function envelope(input) {
  return {
    now: input.now || new Date().toISOString(),
    environment: input.environment || 'LIVE',
    actorType: input.actorType || 'SYSTEM',
    actorId: input.actorId || null,
    actorEmail: input.actorEmail || 'system@fin.local',
    reasonCode: input.reasonCode,
    tenantId: input.tenantId || null,
    idempotencyKey: input.idempotencyKey,
  }
}

async function withRetry(work) {
  let last
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await transaction(work)
    } catch (error) {
      last = error
      if (error.code === '40P01' && attempt < 3) {
        await sleep(20 + Math.random() * 60)
        continue
      }
      throw error
    }
  }
  throw last
}

async function claim(client, env, key, fingerprintPayload) {
  requireReason(env.reasonCode)
  requireKey(key)
  return claimIdempotency(client, {
    environment: env.environment,
    tenantId: env.tenantId,
    key,
    fingerprint: requestFingerprint(fingerprintPayload),
    now: env.now,
    actorType: env.actorType,
    actorId: env.actorId,
  })
}

async function finish(client, claimResult, env, body) {
  await completeIdempotency(client, {
    id: claimResult.row.id,
    now: env.now,
    body,
  })
  return body
}

async function loadExistingTx(client, { shape, economicSourceType, economicSourceId, bookId }) {
  const { rows } = await client.query(
    `SELECT * FROM fin.ledger_transactions
      WHERE shape = $1 AND economic_source_type = $2 AND economic_source_id = $3
        AND ($4::uuid IS NULL OR book_id = $4)
      ORDER BY created_at ASC`,
    [shape, economicSourceType, economicSourceId, bookId || null],
  )
  return rows
}

async function postPair(client, ctx, {
  debitType, creditType, units, debitLotId = null, creditLotId = null,
}) {
  return insertPostingPair(client, {
    environment: ctx.environment,
    transactionId: ctx.txId,
    bookId: ctx.bookId,
    accounts: ctx.accounts,
    debitType,
    creditType,
    units,
    debitLotId,
    creditLotId,
    fxRateSnapshotId: ctx.fxRateSnapshotId || null,
    now: ctx.now,
  })
}

export async function fundPurchase(input) {
  const env = envelope(input)
  const purchaseIntentId = input.purchaseIntentId
  const paidUnits = Number(input.paidUnits)
  const bonusUnits = Number(input.bonusUnits || 0)
  const key = input.idempotencyKey || `FUND:${purchaseIntentId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'FundPurchase', purchaseIntentId, paidUnits, bonusUnits,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const book = await loadBook(client, input.bookId)
    if (!book) throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
    if (book.environment !== env.environment) {
      throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
    }
    const accounts = await loadAccounts(client, book.id)
    await lockBooks(client, [book.id])
    await lockAccounts(client, Object.values(accounts))

    const total = paidUnits + bonusUnits
    let txId
    try {
      txId = await insertLedgerTx(client, {
        environment: env.environment,
        bookId: book.id,
        shape: 'FUNDING',
        economicSourceType: 'PURCHASE_INTENT',
        economicSourceId: purchaseIntentId,
        actorType: env.actorType,
        actorId: env.actorId,
        reasonCode: env.reasonCode,
        idempotencyKeyId: claimed.row.id,
        now: env.now,
      })
    } catch (error) {
      if (error.code === '23505') {
        const [existing] = await loadExistingTx(client, {
          shape: 'FUNDING',
          economicSourceType: 'PURCHASE_INTENT',
          economicSourceId: purchaseIntentId,
        })
        const body = { command: 'FundPurchase', txId: existing.id, replayed: true }
        return finish(client, claimed, env, body)
      }
      throw error
    }

    const paidLotId = await insertLot(client, {
      environment: env.environment,
      tenantId: book.tenant_id,
      bookId: book.id,
      billingAccountId: book.billing_account_id,
      holderId: input.holderId,
      sourceKind: 'PURCHASE',
      grantedUnits: paidUnits,
      remainingUnits: 0,
      considerationMinor: input.considerationMinor || 0,
      currency: book.currency,
      purchaseIntentId,
      now: env.now,
    })
    const ctx = {
      environment: env.environment, txId, bookId: book.id, accounts, now: env.now,
    }
    const paidPost = await postPair(client, ctx, {
      debitType: 'ISSUANCE', creditType: 'AVAILABLE', units: paidUnits, creditLotId: paidLotId,
    })
    await insertAllocation(client, {
      environment: env.environment, lotId: paidLotId, postingId: paidPost.creditId,
      units: paidUnits, now: env.now,
    })

    let bonusLotId = null
    if (bonusUnits > 0) {
      bonusLotId = await insertLot(client, {
        environment: env.environment,
        tenantId: book.tenant_id,
        bookId: book.id,
        billingAccountId: book.billing_account_id,
        holderId: input.holderId,
        sourceKind: 'PROMOTIONAL_GRANT',
        grantedUnits: bonusUnits,
        remainingUnits: 0,
        considerationMinor: 0,
        currency: book.currency,
        purchaseIntentId,
        now: env.now,
      })
      const bonusPost = await postPair(client, ctx, {
        debitType: 'ISSUANCE', creditType: 'AVAILABLE', units: bonusUnits, creditLotId: bonusLotId,
      })
      await insertAllocation(client, {
        environment: env.environment, lotId: bonusLotId, postingId: bonusPost.creditId,
        units: bonusUnits, now: env.now,
      })
    }

    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'PURCHASE_FUNDED',
      targetType: 'LOT',
      targetId: paidLotId,
      afterState: { txId, paidUnits, bonusUnits, total },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.ledger.posted',
      dedupeKey: `tx:${txId}`,
      payload: { txId, shape: 'FUNDING' },
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.lot.issued',
      dedupeKey: `lot:${paidLotId}`,
      payload: { lotId: paidLotId },
      now: env.now,
    })
    if (bonusLotId) {
      await insertOutbox(client, {
        environment: env.environment,
        topic: 'fin.lot.issued',
        dedupeKey: `lot:${bonusLotId}`,
        payload: { lotId: bonusLotId },
        now: env.now,
      })
    }
    return finish(client, claimed, env, {
      command: 'FundPurchase',
      txId,
      lotIds: [paidLotId, bonusLotId].filter(Boolean),
      paidUnits,
      bonusUnits,
    })
  })
}

export async function authorizeHold(input) {
  const env = envelope(input)
  const units = Number(input.units)
  const subjectId = input.subjectId || input.ratedUsageId || randomUUID()
  const key = input.idempotencyKey || `AUTH:HOLD:${subjectId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'AuthorizeHold', subjectId, units })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const book = await loadBook(client, input.bookId)
    if (!book) throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
    const accounts = await loadAccounts(client, book.id)
    await lockBooks(client, [book.id])
    await lockAccounts(client, Object.values(accounts))
    if (input.lotId) await lockLots(client, [input.lotId])

    if (input.deny) {
      await insertAuthAttempt(client, {
        environment: env.environment,
        holderId: input.holderId,
        result: 'DENIED',
        denialCode: input.denialCode || 'INSUFFICIENT_ELIGIBLE_CREDITS',
        now: env.now,
      })
      await insertAudit(client, {
        environment: env.environment,
        actorType: env.actorType,
        actorId: env.actorId,
        actorEmail: env.actorEmail,
        action: 'HOLD_DENIED',
        targetType: 'HOLDER',
        targetId: input.holderId,
        reasonCode: env.reasonCode,
        now: env.now,
      })
      return finish(client, claimed, env, { command: 'AuthorizeHold', denied: true })
    }

    const holdId = randomUUID()
    const txId = await insertLedgerTx(client, {
      environment: env.environment,
      bookId: book.id,
      shape: 'HOLD',
      economicSourceType: 'HOLD',
      economicSourceId: holdId,
      actorType: env.actorType,
      actorId: env.actorId,
      reasonCode: env.reasonCode,
      idempotencyKeyId: claimed.row.id,
      now: env.now,
    })
    const posts = await insertPostingPair(client, {
      environment: env.environment,
      transactionId: txId,
      bookId: book.id,
      accounts,
      debitType: 'AVAILABLE',
      creditType: 'HELD',
      units,
      debitLotId: input.lotId || null,
      now: env.now,
    })
    if (input.lotId) {
      await insertAllocation(client, {
        environment: env.environment,
        lotId: input.lotId,
        postingId: posts.debitId,
        units: -units,
        holdId,
        now: env.now,
      })
    }
    await client.query(
      `INSERT INTO fin.holds (
         id, environment, tenant_id, holder_id, billing_account_id, book_id,
         subject_type, subject_id, units, status, authorize_tx_id, expires_at,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',$10,$11,$12,$12)`,
      [
        holdId, env.environment, book.tenant_id, input.holderId,
        book.billing_account_id, book.id, input.subjectType || 'RATED_USAGE',
        subjectId, units, txId, input.expiresAt || '2099-01-01T00:00:00.000Z', env.now,
      ],
    )
    await insertAuthAttempt(client, {
      environment: env.environment,
      holderId: input.holderId,
      result: 'AUTHORIZED',
      holdId,
      now: env.now,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'HOLD_AUTHORIZED',
      targetType: 'HOLD',
      targetId: holdId,
      afterState: { txId, units },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.hold.authorized',
      dedupeKey: `hold:${holdId}`,
      payload: { holdId, txId },
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.ledger.posted',
      dedupeKey: `tx:${txId}`,
      payload: { txId },
      now: env.now,
    })
    return finish(client, claimed, env, { command: 'AuthorizeHold', holdId, txId, units })
  })
}

async function releaseHold(input, { status, reasonCode, idempotencyKey, outboxTopic, auditAction, actorType }) {
  const env = envelope({ ...input, reasonCode: reasonCode || input.reasonCode, actorType: actorType || input.actorType })
  const holdId = input.holdId
  const key = input.idempotencyKey || idempotencyKey
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'releaseHold', holdId, status })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockHolds(client, [holdId])
    const hold = (await client.query(`SELECT * FROM fin.holds WHERE id = $1`, [holdId])).rows[0]
    if (!hold || hold.status !== 'OPEN') {
      throw finError('HOLD_NOT_OPEN', { category: CATEGORY.PRECONDITION, httpStatus: 409 })
    }
    const book = await loadBook(client, hold.book_id)
    const accounts = await loadAccounts(client, book.id)
    await lockBooks(client, [book.id])
    await lockAccounts(client, Object.values(accounts))

    const shape = status === 'CAPTURED' ? 'CAPTURE' : 'VOID'
    const txId = await insertLedgerTx(client, {
      environment: env.environment,
      bookId: book.id,
      shape,
      economicSourceType: 'HOLD',
      economicSourceId: holdId,
      actorType: env.actorType,
      actorId: env.actorId,
      reasonCode: env.reasonCode,
      idempotencyKeyId: claimed.row.id,
      now: env.now,
    })
    if (status === 'CAPTURED') {
      await insertPostingPair(client, {
        environment: env.environment, transactionId: txId, bookId: book.id,
        accounts, debitType: 'HELD', creditType: 'CONSUMED', units: Number(hold.units),
        now: env.now,
      })
      await client.query(
        `UPDATE fin.holds SET status = 'CAPTURED', capture_tx_id = $2, updated_at = $3
          WHERE id = $1 AND version = $4`,
        [holdId, txId, env.now, hold.version],
      )
    } else {
      const posts = await insertPostingPair(client, {
        environment: env.environment, transactionId: txId, bookId: book.id,
        accounts, debitType: 'HELD', creditType: 'AVAILABLE', units: Number(hold.units),
        now: env.now,
      })
      const allocs = await client.query(
        `SELECT lot_id, units FROM fin.lot_allocations WHERE hold_id = $1`,
        [holdId],
      )
      for (const alloc of allocs.rows) {
        await insertAllocation(client, {
          environment: env.environment,
          lotId: alloc.lot_id,
          postingId: posts.creditId,
          units: -Number(alloc.units),
          holdId,
          now: env.now,
        })
      }
      await client.query(
        `UPDATE fin.holds SET status = $2, release_tx_id = $3, updated_at = $4
          WHERE id = $1 AND version = $5`,
        [holdId, status, txId, env.now, hold.version],
      )
    }
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: auditAction,
      targetType: 'HOLD',
      targetId: holdId,
      afterState: { txId, status },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    const holdDedupe = status === 'CAPTURED'
      ? `hold:${holdId}:capture`
      : status === 'EXPIRED'
        ? `hold:${holdId}:expire`
        : `hold:${holdId}:void`
    await insertOutbox(client, {
      environment: env.environment,
      topic: outboxTopic,
      dedupeKey: holdDedupe,
      payload: { holdId, txId },
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.ledger.posted',
      dedupeKey: `tx:${txId}`,
      payload: { txId },
      now: env.now,
    })
    return finish(client, claimed, env, { command: input.commandName, holdId, txId, status })
  })
}

export function captureHold(input) {
  return releaseHold({ ...input, commandName: 'CaptureHold' }, {
    status: 'CAPTURED',
    idempotencyKey: input.idempotencyKey || `CAPTURE:${input.holdId}`,
    outboxTopic: 'fin.hold.captured',
    auditAction: 'HOLD_CAPTURED',
  })
}

export function voidHold(input) {
  return releaseHold({ ...input, commandName: 'VoidHold' }, {
    status: 'VOIDED',
    idempotencyKey: input.idempotencyKey || `VOID:${input.holdId}`,
    outboxTopic: 'fin.hold.voided',
    auditAction: 'HOLD_VOIDED',
  })
}

export function expireHold(input) {
  return releaseHold({
    ...input,
    commandName: 'ExpireHold',
    actorType: 'WORKER',
    reasonCode: input.reasonCode || 'HOLD_TTL',
  }, {
    status: 'EXPIRED',
    reasonCode: 'HOLD_TTL',
    actorType: 'WORKER',
    idempotencyKey: input.idempotencyKey || `EXPIRE_HOLD:${input.holdId}`,
    outboxTopic: 'fin.hold.expired',
    auditAction: 'HOLD_EXPIRED',
  })
}

async function spend(input, { command, sourceType, debitType, creditType, shape, audit }) {
  const env = envelope(input)
  const units = Number(input.units)
  const sourceId = input.ratedUsageId || input.economicSourceId || randomUUID()
  const key = input.idempotencyKey || `SPEND:${sourceId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: command, sourceId, units })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const book = await loadBook(client, input.bookId)
    const accounts = await loadAccounts(client, book.id)
    await lockBooks(client, [book.id])
    await lockAccounts(client, Object.values(accounts))
    if (input.lotId) await lockLots(client, [input.lotId])
    let txId
    try {
      txId = await insertLedgerTx(client, {
        environment: env.environment,
        bookId: book.id,
        shape,
        economicSourceType: sourceType,
        economicSourceId: sourceId,
        actorType: env.actorType,
        actorId: env.actorId,
        reasonCode: env.reasonCode,
        idempotencyKeyId: claimed.row.id,
        now: env.now,
      })
    } catch (error) {
      if (error.code === '23505') {
        const [existing] = await loadExistingTx(client, {
          shape, economicSourceType: sourceType, economicSourceId: sourceId,
        })
        return finish(client, claimed, env, { command, txId: existing.id, replayed: true })
      }
      throw error
    }
    const posts = await insertPostingPair(client, {
      environment: env.environment, transactionId: txId, bookId: book.id,
      accounts, debitType, creditType, units,
      debitLotId: input.lotId || null, now: env.now,
    })
    if (input.lotId) {
      await insertAllocation(client, {
        environment: env.environment, lotId: input.lotId, postingId: posts.debitId,
        units: -units, now: env.now,
      })
    }
    await insertAuthAttempt(client, {
      environment: env.environment,
      holderId: input.holderId,
      result: 'AUTHORIZED',
      now: env.now,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: audit,
      targetType: 'BOOK',
      targetId: book.id,
      afterState: { txId, units },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.ledger.posted',
      dedupeKey: `tx:${txId}`,
      payload: { txId },
      now: env.now,
    })
    return finish(client, claimed, env, { command, txId, units })
  })
}

export function directSpend(input) {
  return spend(input, {
    command: 'DirectSpend',
    sourceType: 'RATED_USAGE',
    debitType: 'AVAILABLE',
    creditType: 'CONSUMED',
    shape: 'DIRECT_SPEND',
    audit: 'DIRECT_SPEND',
  })
}

export function directSpendPostpaid(input) {
  return spend(input, {
    command: 'DirectSpendPostpaid',
    sourceType: 'RATED_USAGE',
    debitType: 'ISSUANCE',
    creditType: 'CONSUMED',
    shape: 'DIRECT_SPEND',
    audit: 'DIRECT_SPEND',
  })
}

export async function expireLot(input) {
  const env = envelope(input)
  const lotId = input.lotId
  const key = input.idempotencyKey || `EXPIRE_LOT:${lotId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'ExpireLot', lotId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockLots(client, [lotId])
    const lot = (await client.query(`SELECT * FROM fin.lots WHERE id = $1`, [lotId])).rows[0]
    const open = await client.query(
      `SELECT 1 FROM fin.holds h
         JOIN fin.lot_allocations a ON a.hold_id = h.id
        WHERE a.lot_id = $1 AND h.status = 'OPEN' LIMIT 1`,
      [lotId],
    )
    if (open.rowCount) throw finError('LOT_NOT_DRAWABLE', { category: CATEGORY.PRECONDITION })
    const remaining = Number(lot.remaining_units)
    const book = await loadBook(client, lot.book_id)
    const accounts = await loadAccounts(client, book.id)
    await lockBooks(client, [book.id])
    await lockAccounts(client, Object.values(accounts))
    const txId = await insertLedgerTx(client, {
      environment: env.environment,
      bookId: book.id,
      shape: 'EXPIRY',
      economicSourceType: 'LOT',
      economicSourceId: lotId,
      actorType: env.actorType,
      actorId: env.actorId,
      reasonCode: env.reasonCode,
      idempotencyKeyId: claimed.row.id,
      now: env.now,
    })
    const posts = await insertPostingPair(client, {
      environment: env.environment, transactionId: txId, bookId: book.id,
      accounts, debitType: 'AVAILABLE', creditType: 'EXPIRED', units: remaining,
      debitLotId: lotId, now: env.now,
    })
    await insertAllocation(client, {
      environment: env.environment, lotId, postingId: posts.debitId,
      units: -remaining, now: env.now,
    })
    const lotAfter = (await client.query(
      `SELECT version FROM fin.lots WHERE id = $1`,
      [lotId],
    )).rows[0]
    await client.query(
      `UPDATE fin.lots SET status = 'EXPIRED', updated_at = $2 WHERE id = $1 AND version = $3`,
      [lotId, env.now, lotAfter.version],
    )
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType, actorId: env.actorId, actorEmail: env.actorEmail,
      action: 'LOT_EXPIRED', targetType: 'LOT', targetId: lotId,
      afterState: { txId, remaining }, reasonCode: env.reasonCode, now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment, topic: 'fin.lot.expired',
      dedupeKey: `lot:${lotId}:expired`, payload: { lotId, txId }, now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment, topic: 'fin.ledger.posted',
      dedupeKey: `tx:${txId}`, payload: { txId }, now: env.now,
    })
    return finish(client, claimed, env, { command: 'ExpireLot', txId, lotId })
  })
}

export async function grantCredits(input) {
  const env = envelope(input)
  const units = Number(input.units)
  const approvalId = input.approvalRequestId
  const key = input.idempotencyKey || `GRANT:${approvalId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'GrantCredits', approvalId, units })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const approval = (await client.query(
      `SELECT * FROM fin.approval_requests WHERE id = $1 FOR UPDATE`,
      [approvalId],
    )).rows[0]
    if (!approval || !['APPROVED', 'EXECUTED'].includes(approval.status)) {
      throw finError('APPROVAL_FOUR_EYES_REQUIRED', { category: CATEGORY.APPROVAL, httpStatus: 409 })
    }
    const book = await loadBook(client, input.bookId)
    const accounts = await loadAccounts(client, book.id)
    await lockBooks(client, [book.id])
    await lockAccounts(client, Object.values(accounts))
    const txId = await insertLedgerTx(client, {
      environment: env.environment, bookId: book.id, shape: 'GRANT',
      economicSourceType: 'APPROVAL_REQUEST', economicSourceId: approvalId,
      actorType: env.actorType, actorId: env.actorId, reasonCode: env.reasonCode,
      idempotencyKeyId: claimed.row.id, now: env.now,
    })
    const lotId = await insertLot(client, {
      environment: env.environment, tenantId: book.tenant_id, bookId: book.id,
      billingAccountId: book.billing_account_id, holderId: input.holderId,
      sourceKind: input.sourceKind || 'PROMOTIONAL_GRANT',
      grantedUnits: units, remainingUnits: 0, considerationMinor: 0,
      currency: book.currency, now: env.now,
    })
    const posts = await insertPostingPair(client, {
      environment: env.environment, transactionId: txId, bookId: book.id,
      accounts, debitType: 'ISSUANCE', creditType: 'AVAILABLE', units,
      creditLotId: lotId, now: env.now,
    })
    await insertAllocation(client, {
      environment: env.environment, lotId, postingId: posts.creditId, units, now: env.now,
    })
    if (approval.status === 'APPROVED') {
      await client.query(
        `UPDATE fin.approval_requests SET status = 'EXECUTED', updated_at = $2
          WHERE id = $1 AND version = $3`,
        [approvalId, env.now, approval.version],
      )
    }
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType, actorId: env.actorId, actorEmail: env.actorEmail,
      action: 'CREDITS_GRANTED', targetType: 'LOT', targetId: lotId,
      afterState: { txId, units }, reasonCode: env.reasonCode,
      approvalRequestId: approvalId, now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment, topic: 'fin.ledger.posted',
      dedupeKey: `tx:${txId}`, payload: { txId }, now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment, topic: 'fin.lot.issued',
      dedupeKey: `lot:${lotId}`, payload: { lotId }, now: env.now,
    })
    return finish(client, claimed, env, { command: 'GrantCredits', txId, lotId, units })
  })
}

export async function transferCredits(input) {
  const env = envelope(input)
  const units = Number(input.units)
  const destUnits = Number(input.destUnits || units)
  const key = input.idempotencyKey || `XFER:${input.requestKey || randomUUID()}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'TransferCredits', sourceBookId: input.sourceBookId,
      destBookId: input.destBookId, units, destUnits,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    if (input.sourceBookId === input.destBookId) {
      const book = await loadBook(client, input.sourceBookId)
      const accounts = await loadAccounts(client, book.id)
      await lockBooks(client, [book.id])
      await lockAccounts(client, Object.values(accounts))
      const sourceId = input.transferIntentId || randomUUID()
      const txId = await insertLedgerTx(client, {
        environment: env.environment, bookId: book.id, shape: 'TRANSFER',
        economicSourceType: 'TRANSFER_INTENT', economicSourceId: sourceId,
        actorType: env.actorType, actorId: env.actorId, reasonCode: env.reasonCode,
        idempotencyKeyId: claimed.row.id, now: env.now,
      })
      await insertPostingPair(client, {
        environment: env.environment, transactionId: txId, bookId: book.id,
        accounts, debitType: 'AVAILABLE', creditType: 'AVAILABLE', units,
        debitLotId: input.sourceLotId || null,
        creditLotId: input.destLotId || null, now: env.now,
      })
      await insertAudit(client, {
        environment: env.environment,
        actorType: env.actorType, actorId: env.actorId, actorEmail: env.actorEmail,
        action: 'CREDITS_TRANSFERRED', targetType: 'BOOK', targetId: book.id,
        afterState: { txId, pairId: null }, reasonCode: env.reasonCode, now: env.now,
      })
      await insertOutbox(client, {
        environment: env.environment, topic: 'fin.transfer.posted',
        dedupeKey: `same-book:${sourceId}`, payload: { txIds: [txId] }, now: env.now,
      })
      await insertOutbox(client, {
        environment: env.environment, topic: 'fin.ledger.posted',
        dedupeKey: `tx:${txId}`, payload: { txId }, now: env.now,
      })
      return finish(client, claimed, env, { command: 'TransferCredits', pairId: null, txIds: [txId] })
    }

    const pairId = randomUUID()
    const sourceId = input.transferIntentId || randomUUID()
    const books = [input.sourceBookId, input.destBookId]
    await lockBooks(client, books)
    const sourceBook = await loadBook(client, input.sourceBookId)
    const destBook = await loadBook(client, input.destBookId)
    if (sourceBook.currency !== destBook.currency && !input.fxRateSnapshotId) {
      throw finError('FX_SNAPSHOT_REQUIRED', { category: CATEGORY.VALIDATION })
    }
    const sourceAccounts = await loadAccounts(client, sourceBook.id)
    const destAccounts = await loadAccounts(client, destBook.id)
    await lockAccounts(client, [...Object.values(sourceAccounts), ...Object.values(destAccounts)])
    const fx = input.fxRateSnapshotId || null
    const srcTx = await insertLedgerTx(client, {
      environment: env.environment, bookId: sourceBook.id, pairId, fxRateSnapshotId: fx,
      shape: 'TRANSFER', economicSourceType: 'TRANSFER_INTENT', economicSourceId: sourceId,
      actorType: env.actorType, actorId: env.actorId, reasonCode: env.reasonCode,
      idempotencyKeyId: claimed.row.id, now: env.now,
    })
    const destTx = await insertLedgerTx(client, {
      environment: env.environment, bookId: destBook.id, pairId, fxRateSnapshotId: fx,
      shape: 'TRANSFER', economicSourceType: 'TRANSFER_INTENT', economicSourceId: sourceId,
      actorType: env.actorType, actorId: env.actorId, reasonCode: env.reasonCode,
      idempotencyKeyId: claimed.row.id, now: env.now,
    })
    await insertPostingPair(client, {
      environment: env.environment, transactionId: srcTx, bookId: sourceBook.id,
      accounts: sourceAccounts, debitType: 'AVAILABLE', creditType: 'CLEARING',
      units, fxRateSnapshotId: fx, now: env.now,
    })
    await insertPostingPair(client, {
      environment: env.environment, transactionId: destTx, bookId: destBook.id,
      accounts: destAccounts, debitType: 'CLEARING', creditType: 'AVAILABLE',
      units: destUnits, fxRateSnapshotId: fx, now: env.now,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType, actorId: env.actorId, actorEmail: env.actorEmail,
      action: 'CREDITS_TRANSFERRED', targetType: 'BOOK', targetId: sourceBook.id,
      afterState: { pairId, txIds: [srcTx, destTx] }, reasonCode: env.reasonCode, now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment, topic: 'fin.transfer.posted',
      dedupeKey: `pair:${pairId}`, payload: { pairId, txIds: [srcTx, destTx] }, now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment, topic: 'fin.ledger.posted',
      dedupeKey: `tx:${srcTx}`, payload: { txId: srcTx }, now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment, topic: 'fin.ledger.posted',
      dedupeKey: `tx:${destTx}`, payload: { txId: destTx }, now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'TransferCredits', pairId, txIds: [srcTx, destTx],
    })
  })
}

async function adjust(input, {
  command, sourceType, sourceId, audit, outboxTopic, shape = 'ADJUSTMENT',
}) {
  const env = envelope(input)
  const units = Number(input.units)
  const direction = input.direction || 'increase'
  const key = input.idempotencyKey || `ADJ:${input.requestKey || randomUUID()}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: command, sourceId, units, direction })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const book = await loadBook(client, input.bookId)
    const accounts = await loadAccounts(client, book.id)
    await lockBooks(client, [book.id])
    await lockAccounts(client, Object.values(accounts))
    const txId = await insertLedgerTx(client, {
      environment: env.environment, bookId: book.id, shape,
      economicSourceType: sourceType, economicSourceId: sourceId,
      actorType: env.actorType, actorId: env.actorId, reasonCode: env.reasonCode,
      idempotencyKeyId: claimed.row.id, now: env.now,
    })
    const decreaseCredit = shape === 'REFUND' ? 'ISSUANCE' : 'ADJUSTMENT'
    const increaseDebit = shape === 'REFUND' ? 'ISSUANCE' : 'ADJUSTMENT'
    if (direction === 'decrease') {
      await insertPostingPair(client, {
        environment: env.environment, transactionId: txId, bookId: book.id,
        accounts, debitType: 'AVAILABLE', creditType: decreaseCredit, units, now: env.now,
      })
    } else {
      await insertPostingPair(client, {
        environment: env.environment, transactionId: txId, bookId: book.id,
        accounts, debitType: increaseDebit, creditType: 'AVAILABLE', units, now: env.now,
      })
    }
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType, actorId: env.actorId, actorEmail: env.actorEmail,
      action: audit, targetType: 'BOOK', targetId: book.id,
      afterState: { txId, units, direction }, reasonCode: env.reasonCode, now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment, topic: 'fin.ledger.posted',
      dedupeKey: `tx:${txId}`, payload: { txId }, now: env.now,
    })
    if (outboxTopic && outboxTopic !== 'fin.ledger.posted') {
      await insertOutbox(client, {
        environment: env.environment, topic: outboxTopic,
        dedupeKey: `${command}:${txId}`, payload: { txId }, now: env.now,
      })
    }
    return finish(client, claimed, env, { command, txId, units, direction })
  })
}

export function refundPurchase(input) {
  return adjust({
    ...input,
    direction: 'decrease',
    idempotencyKey: input.idempotencyKey || `REFUND:${input.purchaseIntentId}:${input.idemSuffix || '1'}`,
  }, {
    command: 'RefundPurchase',
    sourceType: 'REFUND',
    sourceId: input.refundId || randomUUID(),
    audit: 'PURCHASE_REFUNDED',
    shape: 'REFUND',
  })
}

export function manualAdjust(input) {
  if (input.reasonCode === 'FX_ROUNDING') {
    return Promise.reject(finError('REASON_CODE_REQUIRED', { category: CATEGORY.VALIDATION }))
  }
  return adjust(input, {
    command: 'ManualAdjust',
    sourceType: 'MANUAL',
    sourceId: input.adjustmentId || randomUUID(),
    audit: 'MANUAL_ADJUSTMENT',
  })
}

export function reconcileAdjust(input) {
  return adjust({ ...input, actorType: input.actorType || 'RECONCILIATION' }, {
    command: 'ReconcileAdjust',
    sourceType: 'RECONCILIATION',
    sourceId: input.resolutionId || randomUUID(),
    audit: 'MANUAL_ADJUSTMENT',
    outboxTopic: 'fin.reconciliation.resolution',
  })
}

export async function migrateLot(input) {
  const env = envelope(input)
  const lotId = input.lotId
  const key = input.idempotencyKey || `MIGRATE:${lotId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'MigrateLot', lotId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await lockLots(client, [lotId])
    const lot = (await client.query(`SELECT * FROM fin.lots WHERE id = $1`, [lotId])).rows[0]
    if (input.destBookId && input.destBookId !== lot.book_id) {
      throw finError('TRANSFER_CROSS_POSTING', { category: CATEGORY.CONSERVATION })
    }
    const units = Number(lot.remaining_units)
    const book = await loadBook(client, lot.book_id)
    const accounts = await loadAccounts(client, book.id)
    await lockBooks(client, [book.id])
    await lockAccounts(client, Object.values(accounts))
    const destLotId = await insertLot(client, {
      environment: env.environment, tenantId: lot.tenant_id, bookId: lot.book_id,
      billingAccountId: lot.billing_account_id, holderId: lot.holder_id,
      sourceKind: 'MIGRATION', grantedUnits: units, remainingUnits: 0,
      considerationMinor: 0, currency: lot.currency, now: env.now,
    })
    const txId = await insertLedgerTx(client, {
      environment: env.environment, bookId: book.id, shape: 'MIGRATE',
      economicSourceType: 'LOT', economicSourceId: lotId,
      actorType: env.actorType, actorId: env.actorId, reasonCode: env.reasonCode,
      idempotencyKeyId: claimed.row.id, now: env.now,
    })
    const out = await insertPostingPair(client, {
      environment: env.environment, transactionId: txId, bookId: book.id,
      accounts, debitType: 'AVAILABLE', creditType: 'AVAILABLE', units,
      debitLotId: lotId, creditLotId: destLotId, now: env.now,
    })
    await insertAllocation(client, {
      environment: env.environment, lotId, postingId: out.debitId, units: -units, now: env.now,
    })
    await insertAllocation(client, {
      environment: env.environment, lotId: destLotId, postingId: out.creditId, units, now: env.now,
    })
    const lotAfter = (await client.query(
      `SELECT version FROM fin.lots WHERE id = $1`,
      [lotId],
    )).rows[0]
    await client.query(
      `UPDATE fin.lots SET status = 'EXHAUSTED', updated_at = $2 WHERE id = $1 AND version = $3`,
      [lotId, env.now, lotAfter.version],
    )
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType, actorId: env.actorId, actorEmail: env.actorEmail,
      action: 'LOT_MIGRATED', targetType: 'LOT', targetId: destLotId,
      afterState: { txId, sourceLotId: lotId }, reasonCode: env.reasonCode, now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment, topic: 'fin.ledger.posted',
      dedupeKey: `tx:${txId}`, payload: { txId }, now: env.now,
    })
    return finish(client, claimed, env, { command: 'MigrateLot', txId, destLotId })
  })
}

export async function captureFacility(input) {
  return spend({
    ...input,
    ratedUsageId: undefined,
    economicSourceId: input.reservationId || randomUUID(),
    idempotencyKey: input.idempotencyKey || `CAPFAC:${input.reservationId || randomUUID()}`,
  }, {
    command: 'CaptureFacility',
    sourceType: 'FACILITY',
    debitType: 'ISSUANCE',
    creditType: 'CONSUMED',
    shape: 'CAPTURE',
    audit: 'FACILITY_CAPTURED',
  })
}

async function documentOnly(input, command, audit, topic) {
  const env = envelope(input)
  const key = input.idempotencyKey || `${command}:${input.subjectId || randomUUID()}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: command, subjectId: input.subjectId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType, actorId: env.actorId, actorEmail: env.actorEmail,
      action: audit, targetType: input.targetType || 'INVOICE',
      targetId: input.subjectId || randomUUID(),
      afterState: { ledgerTransactions: [] }, reasonCode: env.reasonCode, now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment, topic,
      dedupeKey: `${command}:${input.subjectId || key}`,
      payload: { command }, now: env.now,
    })
    return finish(client, claimed, env, { command, txIds: [] })
  })
}

export function writeOffInvoice(input) {
  return documentOnly(input, 'WriteOffInvoice', 'INVOICE_UNCOLLECTIBLE', 'fin.invoice.status')
}
export function issueCreditNote(input) {
  if (input.units && input.bookId) {
    return refundPurchase({
      ...input,
      purchaseIntentId: input.creditNoteId || input.subjectId,
      idempotencyKey: input.idempotencyKey || `CN:${input.creditNoteId || input.subjectId}`,
    })
  }
  return documentOnly(input, 'IssueCreditNote', 'CREDIT_NOTE_ISSUED', 'fin.credit_note.status')
}
export function issueDebitNote(input) {
  return documentOnly(input, 'IssueDebitNote', 'CREDIT_NOTE_ISSUED', 'fin.debit_note.status')
}
export function reversePayment(input) {
  return documentOnly(input, 'ReversePayment', 'PURCHASE_REFUNDED', 'fin.payment.status')
}

export const COMMANDS = {
  FundPurchase: fundPurchase,
  AuthorizeHold: authorizeHold,
  CaptureHold: captureHold,
  VoidHold: voidHold,
  ExpireHold: expireHold,
  DirectSpend: directSpend,
  DirectSpendPostpaid: directSpendPostpaid,
  ExpireLot: expireLot,
  GrantCredits: grantCredits,
  TransferCredits: transferCredits,
  RefundPurchase: refundPurchase,
  ManualAdjust: manualAdjust,
  ReconcileAdjust: reconcileAdjust,
  WriteOffInvoice: writeOffInvoice,
  MigrateLot: migrateLot,
  CaptureFacility: captureFacility,
  IssueCreditNote: issueCreditNote,
  IssueDebitNote: issueDebitNote,
  ReversePayment: reversePayment,
}
