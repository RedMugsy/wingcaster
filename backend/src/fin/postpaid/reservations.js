/**
 * Facility reservations (B §12). reserve / capture / release / expire.
 * Capture mints a FACILITY_DRAW lot with remaining_units = 0 (R052 / DL-105).
 */
import { CATEGORY, finError } from '../errors.js'
import { lockAccounts, lockBooks } from '../ledger/locks.js'
import {
  insertAllocation, insertAudit, insertLedgerTx, insertLot, insertOutbox,
  insertPostingPair, loadAccounts, loadBook,
} from '../ledger/write.js'
import { toSqlInt } from '../funding/units.js'
import {
  asMinor, claim, envelope, finish, lockFacility, randomUUID, requireReason, withRetry,
} from './helpers.js'

async function loadReservation(client, reservationId) {
  const { rows } = await client.query(
    `SELECT * FROM fin.facility_reservations WHERE id = $1`,
    [reservationId],
  )
  return rows[0] || null
}

async function reservationOutbox(client, env, row, to) {
  await insertOutbox(client, {
    environment: env.environment,
    topic: 'fin.facility.reservation',
    dedupeKey: `facres:${row.id}:${to}`,
    payload: { reservation_id: row.id, facility_id: row.facility_id, status: to },
    now: env.now,
  })
  await insertAudit(client, {
    environment: env.environment,
    actorType: env.actorType,
    actorId: env.actorId,
    actorEmail: env.actorEmail,
    action: `FACILITY_RESERVATION_${to}`,
    targetType: 'FACILITY_RESERVATION',
    targetId: row.id,
    afterState: { status: to, reserved_minor: row.reserved_minor },
    reasonCode: env.reasonCode,
    now: env.now,
  })
}

export async function reserveFacility(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const reservedMinor = asMinor(input.reservedMinor ?? input.unitsMinor)
  if (reservedMinor <= 0n) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { reason: 'reserved_minor_must_be_positive' },
    })
  }
  const facilityId = input.facilityId
  const key = env.idempotencyKey
    || `FACRES:${input.holdId || input.commandUuid || randomUUID()}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'ReserveFacility',
      facilityId,
      reservedMinor: reservedMinor.toString(),
      holdId: input.holdId || null,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    await lockFacility(client, facilityId)
    const { rows } = await client.query(
      `SELECT * FROM fin.credit_facilities WHERE id = $1 FOR UPDATE`,
      [facilityId],
    )
    const facility = rows[0]
    if (!facility || facility.status !== 'ACTIVE') {
      throw finError('FACILITY_NOT_ACTIVE', { category: CATEGORY.INSUFFICIENT })
    }
    if (facility.environment !== env.environment) {
      throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
    }
    const open = await client.query(
      `SELECT COALESCE(SUM(reserved_minor), 0)::text AS used
         FROM fin.facility_reservations
        WHERE facility_id = $1 AND status = 'OPEN'`,
      [facilityId],
    )
    const used = asMinor(open.rows[0].used)
    const limit = asMinor(facility.limit_minor)
    if (used + reservedMinor > limit) {
      throw finError('FACILITY_LIMIT_EXCEEDED', { category: CATEGORY.INSUFFICIENT })
    }

    const id = randomUUID()
    const expiresAt = input.expiresAt
      || new Date(Date.parse(env.now) + 15 * 60 * 1000).toISOString()
    await client.query(
      `INSERT INTO fin.facility_reservations (
         id, facility_id, environment, tenant_id, hold_id,
         reserved_minor, currency, status, expires_at, reason_code,
         created_at, created_by_actor_type, created_by_actor_id,
         updated_at, updated_by_actor_type, updated_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9,$10,$11,$12,$10,$11,$12)`,
      [
        id, facilityId, env.environment, facility.tenant_id, input.holdId || null,
        reservedMinor.toString(), facility.currency, expiresAt, env.reasonCode,
        env.now, env.actorType, env.actorId,
      ],
    )
    const row = await loadReservation(client, id)
    await reservationOutbox(client, env, row, 'OPEN')
    if (input.holdId) {
      await client.query(
        `UPDATE fin.holds
            SET facility_reservation_id = $2, updated_at = $3
          WHERE id = $1`,
        [input.holdId, id, env.now],
      )
    }
    return finish(client, claimed, env, {
      reservationId: id,
      facilityId,
      status: 'OPEN',
      reservedMinor: reservedMinor.toString(),
    })
  })
}

async function flipReservation(input, to, timestampColumn) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const reservationId = input.reservationId
  const key = env.idempotencyKey || `${to}:${reservationId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: to, reservationId })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const locked = await client.query(
      `SELECT * FROM fin.facility_reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    )
    const reservation = locked.rows[0]
    if (!reservation) {
      throw finError('FACILITY_RES_NOT_OPEN', { category: CATEGORY.PRECONDITION })
    }
    if (reservation.status === to) {
      return finish(client, claimed, env, { reservationId, status: to, replayed: true })
    }
    if (reservation.status !== 'OPEN') {
      throw finError('FACILITY_RES_NOT_OPEN', {
        category: CATEGORY.PRECONDITION,
        details: { status: reservation.status },
      })
    }
    await lockFacility(client, reservation.facility_id)
    await client.query(
      `UPDATE fin.facility_reservations
          SET status = $2, ${timestampColumn} = $3, reason_code = $4,
              updated_at = $3, updated_by_actor_type = $5, updated_by_actor_id = $6
        WHERE id = $1`,
      [reservationId, to, env.now, env.reasonCode, env.actorType, env.actorId],
    )
    const next = await loadReservation(client, reservationId)
    await reservationOutbox(client, env, next, to)
    return finish(client, claimed, env, { reservationId, status: to })
  })
}

export function releaseFacility(input) {
  const env = envelope(input)
  return flipReservation({ ...input, reasonCode: env.reasonCode }, 'RELEASED', 'released_at')
}

export function expireFacilityReservation(input) {
  return flipReservation(
    {
      ...input,
      reasonCode: input.reasonCode || 'FACILITY_RES_TTL',
      actorType: input.actorType || 'WORKER',
    },
    'EXPIRED',
    'expired_at',
  )
}

async function mintFacilityDraw(client, env, {
  reservation, book, accounts, units, claimed, holderId,
}) {
  const txId = await insertLedgerTx(client, {
    environment: env.environment,
    bookId: book.id,
    shape: 'CAPTURE',
    economicSourceType: 'FACILITY',
    economicSourceId: reservation.id,
    actorType: env.actorType,
    actorId: env.actorId,
    reasonCode: env.reasonCode,
    idempotencyKeyId: claimed.row.id,
    now: env.now,
  })
  const lotId = await insertLot(client, {
    environment: env.environment,
    tenantId: reservation.facility_tenant_id || reservation.tenant_id,
    bookId: book.id,
    billingAccountId: reservation.billing_account_id,
    holderId,
    sourceKind: 'FACILITY_DRAW',
    grantedUnits: units,
    remainingUnits: units,
    considerationMinor: toSqlInt(reservation.reserved_minor),
    currency: reservation.currency,
    drawPriority: 1000,
    now: env.now,
  })
  // Issue into AVAILABLE without stamping lot_id (CAPTURE is not excluded
  // from R009 the way FUNDING/GRANT are). Consume via AVAILABLE→CONSUMED
  // with the draw allocation on the AVAILABLE debit so allocation.units
  // equals posting.amount_units (F §16 R009 / DL-054 / DirectSpend shape).
  // Net postings remain ISSUANCE −u / CONSUMED +u (C §5.16).
  await insertPostingPair(client, {
    environment: env.environment,
    transactionId: txId,
    bookId: book.id,
    accounts,
    debitType: 'ISSUANCE',
    creditType: 'AVAILABLE',
    units,
    now: env.now,
  })
  const consume = await insertPostingPair(client, {
    environment: env.environment,
    transactionId: txId,
    bookId: book.id,
    accounts,
    debitType: 'AVAILABLE',
    creditType: 'CONSUMED',
    units,
    debitLotId: lotId,
    now: env.now,
  })
  await insertAllocation(client, {
    environment: env.environment,
    lotId,
    postingId: consume.debitId,
    units: -units,
    now: env.now,
  })
  await client.query(
    `UPDATE fin.lots SET status = 'EXHAUSTED', updated_at = $2 WHERE id = $1`,
    [lotId, env.now],
  )
  await insertOutbox(client, {
    environment: env.environment,
    topic: 'fin.ledger.posted',
    dedupeKey: `tx:${txId}`,
    payload: { txId },
    now: env.now,
  })
  return { txId, lotId }
}

/**
 * Capture an OPEN reservation (C §5.16). hold_id set → FACILITY_USE_CAPTURE_HOLD
 * unless allowHold (hybrid CaptureHold add-on).
 */
export async function captureFacility(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  const reservationId = input.reservationId
  const key = env.idempotencyKey || `CAPFAC:${reservationId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, { cmd: 'CaptureFacility', reservationId })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const locked = await client.query(
      `SELECT r.*, f.billing_account_id, f.status AS facility_status,
              f.tenant_id AS facility_tenant_id, f.currency AS facility_currency
         FROM fin.facility_reservations r
         JOIN fin.credit_facilities f ON f.id = r.facility_id
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [reservationId],
    )
    const reservation = locked.rows[0]
    if (!reservation) {
      throw finError('FACILITY_RES_NOT_OPEN', { category: CATEGORY.PRECONDITION })
    }
    if (reservation.hold_id && !input.allowHold) {
      throw finError('FACILITY_USE_CAPTURE_HOLD', { category: CATEGORY.PRECONDITION })
    }
    if (reservation.status === 'CAPTURED') {
      return finish(client, claimed, env, {
        reservationId, status: 'CAPTURED', replayed: true,
      })
    }
    if (reservation.status !== 'OPEN') {
      throw finError('FACILITY_RES_NOT_OPEN', {
        category: CATEGORY.PRECONDITION,
        details: { status: reservation.status },
      })
    }
    if (!['ACTIVE', 'PAUSED'].includes(reservation.facility_status)) {
      throw finError('FACILITY_NOT_ACTIVE', { category: CATEGORY.INSUFFICIENT })
    }

    await lockFacility(client, reservation.facility_id)
    const bookRow = input.bookId
      ? await loadBook(client, input.bookId)
      : (await client.query(
        `SELECT * FROM fin.ledger_books
          WHERE billing_account_id = $1 AND environment = $2
          ORDER BY id ASC LIMIT 1`,
        [reservation.billing_account_id, reservation.environment],
      )).rows[0]
    if (!bookRow) throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
    const book = bookRow.tenant_environment != null ? bookRow : await loadBook(client, bookRow.id)
    const accounts = await loadAccounts(client, book.id)
    await lockBooks(client, [book.id])
    await lockAccounts(client, Object.values(accounts))

    const units = toSqlInt(input.units || reservation.reserved_minor)
    const minted = await mintFacilityDraw(client, env, {
      reservation, book, accounts, units, claimed, holderId: input.holderId,
    })
    await client.query(
      `UPDATE fin.facility_reservations
          SET status = 'CAPTURED', captured_at = $2, reason_code = $3,
              updated_at = $2, updated_by_actor_type = $4, updated_by_actor_id = $5
        WHERE id = $1`,
      [reservationId, env.now, env.reasonCode, env.actorType, env.actorId],
    )
    const next = await loadReservation(client, reservationId)
    await reservationOutbox(client, env, next, 'CAPTURED')
    return finish(client, claimed, env, {
      reservationId,
      status: 'CAPTURED',
      txId: minted.txId,
      lotId: minted.lotId,
      remainingUnits: '0',
    })
  })
}

export function captureFacilityForHold(input) {
  return captureFacility({ ...input, allowHold: true })
}
