/**
 * DirectSpendPostpaid (C §5.7): reserveFacility + captureFacility in one tx.
 * No hold. DIRECT_SPEND (C §5.6) stays prepaid-only.
 */
import { CATEGORY, finError } from '../errors.js'
import { lockAndResolvePlan } from '../auth/authorize.js'
import { resolveHybridPlan } from './hybrid-resolver.js'
import { claim, envelope, finish, requireReason, withRetry } from './helpers.js'
import { captureFacility, reserveFacility } from './reservations.js'

export async function directSpendPostpaid(input) {
  const env = envelope(input)
  requireReason(env.reasonCode)
  if (!input.idempotencyKey) {
    throw finError('IDEMPOTENCY_KEY_REQUIRED', { category: CATEGORY.VALIDATION })
  }
  return withRetry(async (client) => {
    const claimed = await claim(client, env, input.idempotencyKey, {
      cmd: 'DirectSpendPostpaid',
      holderId: input.holderId,
      bookId: input.bookId,
      unitsRequested: String(input.unitsRequested),
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const { book } = await lockAndResolvePlan(client, {
      ...input,
      environment: env.environment,
      now: env.now,
    })
    const controls = input.controls || (await client.query(
      `SELECT * FROM fin.account_controls
        WHERE environment = $1
          AND (
            (subject_type = 'HOLDER' AND subject_id = $2)
            OR (subject_type = 'BILLING_ACCOUNT' AND subject_id = $3)
          )
        ORDER BY CASE subject_type WHEN 'HOLDER' THEN 0 ELSE 1 END
        LIMIT 1`,
      [env.environment, input.holderId, book.billing_account_id],
    )).rows[0] || { allow_postpaid_usage: true }

    const facility = input.facility || (await client.query(
      `SELECT * FROM fin.credit_facilities
        WHERE billing_account_id = $1 AND environment = $2
        ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, id ASC
        LIMIT 1`,
      [book.billing_account_id, env.environment],
    )).rows[0] || null

    const lots = (await client.query(
      `SELECT l.id, l.status, l.remaining_units, l.draw_priority, l.expires_at,
              l.issued_at, l.source_kind, l.contract_id
         FROM fin.lots l
        WHERE l.holder_id = $1 AND l.book_id = $2 AND l.environment = $3
          AND l.status = 'ACTIVE'`,
      [input.holderId, input.bookId, env.environment],
    )).rows

    const hybrid = resolveHybridPlan({
      lots,
      unitsRequested: input.unitsRequested,
      facility,
      controls,
      amountMinor: input.amountMinor,
      meterId: input.meterId,
      actionKey: input.actionKey,
      category: input.category,
      vendorId: input.vendorId,
      now: env.now,
    })
    if (!hybrid.covered || hybrid.facilityShortfallUnits <= 0n) {
      throw finError(hybrid.denialCode || 'INSUFFICIENT_ELIGIBLE_CREDITS', {
        category: CATEGORY.INSUFFICIENT,
      })
    }
    if (!facility) {
      throw finError('FACILITY_NOT_ACTIVE', { category: CATEGORY.INSUFFICIENT })
    }

    const reserved = await reserveFacility({
      ...input,
      facilityId: facility.id,
      reservedMinor: hybrid.facilityShortfallMinor,
      holdId: null,
      idempotencyKey: `FACRES:${input.idempotencyKey}`,
    })
    const captured = await captureFacility({
      ...input,
      reservationId: reserved.reservationId,
      holderId: input.holderId,
      bookId: book.id,
      units: hybrid.facilityShortfallUnits,
      idempotencyKey: `CAPFAC:${reserved.reservationId}`,
    })
    return finish(client, claimed, env, {
      ok: true,
      holdId: null,
      reservationId: reserved.reservationId,
      txId: captured.txId,
      lotId: captured.lotId,
      remainingUnits: captured.remainingUnits,
      facilityShortfallUnits: hybrid.facilityShortfallUnits.toString(),
    })
  })
}
