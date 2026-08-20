/**
 * FUNDING tx for a PAID purchase intent (C §5.1 / DL-014 / DL-092).
 * One FUNDING tx, two lots (paid + bonus), four postings.
 * Does NOT call Stage 1 fundPurchase (different idempotency key shape).
 * Ambient client only — caller owns transaction(fn).
 */
import { CATEGORY, finError } from '../errors.js'
import { lockAccounts, lockBooks } from '../ledger/locks.js'
import {
  insertAudit, insertLedgerTx, insertLot, insertOutbox, insertPostingPair,
  loadAccounts, loadBook,
} from '../ledger/write.js'
import { asUnits, toSqlInt, unitsString } from './units.js'

export async function loadFundingTx(client, intentId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.ledger_transactions
      WHERE shape = 'FUNDING'
        AND economic_source_type = 'PURCHASE_INTENT'
        AND economic_source_id = $1
      ORDER BY created_at ASC`,
    [intentId],
  )
  return rows[0] || null
}

async function loadBookForAccount(client, billingAccountId, environment) {
  const { rows } = await client.query(
    `SELECT * FROM fin.ledger_books
      WHERE billing_account_id = $1
        AND environment = $2
        AND book_type = 'CUSTOMER'
      ORDER BY id ASC
      LIMIT 1`,
    [billingAccountId, environment],
  )
  return rows[0] || null
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ intentId: string, now: string, actorType: string, actorId: string|null,
 *           actorEmail?: string, reasonCode: string, idempotencyKeyId?: string }} args
 */
export async function fundPurchaseFromIntent(client, {
  intentId, now, actorType, actorId, actorEmail, reasonCode, idempotencyKeyId,
}) {
  const existing = await loadFundingTx(client, intentId)
  if (existing) {
    const lots = await client.query(
      `SELECT id FROM fin.lots WHERE purchase_intent_id = $1 ORDER BY source_kind ASC`,
      [intentId],
    )
    return {
      replayed: true,
      txId: existing.id,
      lotIds: lots.rows.map((r) => r.id),
    }
  }

  const locked = await client.query(
    `SELECT * FROM fin.purchase_intents WHERE id = $1 FOR UPDATE`,
    [intentId],
  )
  const intent = locked.rows[0]
  if (!intent) {
    throw finError('PURCHASE_INTENT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
  }
  if (intent.status !== 'PAID') {
    throw finError('PURCHASE_NOT_PENDING', {
      category: CATEGORY.PRECONDITION,
      details: { status: intent.status, expected: 'PAID' },
    })
  }

  const bookRow = await loadBookForAccount(client, intent.billing_account_id, intent.environment)
  if (!bookRow) throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
  const book = await loadBook(client, bookRow.id)
  if (!book || book.environment !== intent.environment) {
    throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
  }
  if (book.currency !== intent.currency) {
    throw finError('QUOTE_INVALID', {
      category: CATEGORY.VALIDATION,
      details: { book_currency: book.currency, intent_currency: intent.currency },
    })
  }

  const accounts = await loadAccounts(client, book.id)
  await lockBooks(client, [book.id])
  await lockAccounts(client, Object.values(accounts))

  const paidUnits = asUnits(intent.quoted_units)
  const bonusUnits = asUnits(intent.quoted_bonus_units)
  const consideration = asUnits(intent.quoted_minor)

  let txId
  try {
    txId = await insertLedgerTx(client, {
      environment: intent.environment,
      bookId: book.id,
      shape: 'FUNDING',
      economicSourceType: 'PURCHASE_INTENT',
      economicSourceId: intentId,
      actorType,
      actorId,
      reasonCode,
      idempotencyKeyId: idempotencyKeyId || null,
      now,
    })
  } catch (error) {
    if (error.code === '23505') {
      const replay = await loadFundingTx(client, intentId)
      const lots = await client.query(
        `SELECT id FROM fin.lots WHERE purchase_intent_id = $1 ORDER BY source_kind ASC`,
        [intentId],
      )
      return { replayed: true, txId: replay.id, lotIds: lots.rows.map((r) => r.id) }
    }
    throw error
  }

  const paidLotId = await insertLot(client, {
    environment: intent.environment,
    tenantId: intent.tenant_id,
    bookId: book.id,
    billingAccountId: intent.billing_account_id,
    holderId: intent.holder_id,
    sourceKind: 'PURCHASE',
    grantedUnits: toSqlInt(paidUnits),
    remainingUnits: toSqlInt(paidUnits),
    considerationMinor: toSqlInt(consideration),
    currency: intent.currency,
    purchaseIntentId: intentId,
    now,
  })
  await insertPostingPair(client, {
    environment: intent.environment,
    transactionId: txId,
    bookId: book.id,
    accounts,
    debitType: 'ISSUANCE',
    creditType: 'AVAILABLE',
    units: toSqlInt(paidUnits),
    creditLotId: paidLotId,
    now,
  })

  const lotIds = [paidLotId]
  if (bonusUnits > 0n) {
    const bonusLotId = await insertLot(client, {
      environment: intent.environment,
      tenantId: intent.tenant_id,
      bookId: book.id,
      billingAccountId: intent.billing_account_id,
      holderId: intent.holder_id,
      sourceKind: 'PROMOTIONAL_GRANT',
      grantedUnits: toSqlInt(bonusUnits),
      remainingUnits: toSqlInt(bonusUnits),
      considerationMinor: 0,
      currency: intent.currency,
      purchaseIntentId: intentId,
      now,
    })
    await insertPostingPair(client, {
      environment: intent.environment,
      transactionId: txId,
      bookId: book.id,
      accounts,
      debitType: 'ISSUANCE',
      creditType: 'AVAILABLE',
      units: toSqlInt(bonusUnits),
      creditLotId: bonusLotId,
      now,
    })
    lotIds.push(bonusLotId)
  }

  await insertAudit(client, {
    environment: intent.environment,
    actorType,
    actorId,
    actorEmail: actorEmail || 'system@fin.local',
    action: 'PURCHASE_FUNDED',
    targetType: 'PURCHASE_INTENT',
    targetId: intentId,
    afterState: {
      txId,
      paidUnits: unitsString(paidUnits),
      bonusUnits: unitsString(bonusUnits),
      lotIds,
    },
    reasonCode,
    now,
  })
  await insertOutbox(client, {
    environment: intent.environment,
    topic: 'fin.ledger.posted',
    dedupeKey: `tx:${txId}`,
    payload: { txId, shape: 'FUNDING', intentId },
    now,
  })
  for (const lotId of lotIds) {
    await insertOutbox(client, {
      environment: intent.environment,
      topic: 'fin.lot.issued',
      dedupeKey: `lot:${lotId}`,
      payload: { lotId, intentId },
      now,
    })
  }

  return { replayed: false, txId, lotIds }
}
