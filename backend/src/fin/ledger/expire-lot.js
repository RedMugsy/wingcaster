/**
 * Stage 9 wrapper around Stage 1 expireLot (C §5.8).
 * Does not edit transactions.js. Nested transaction() reuses the ambient
 * client (D-T11 ALS) so BREAKAGE_RECOGNIZED lands in the same tx.
 */
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
import { recordBreakageForLot } from '../accounting/breakage.js'
import { expireLot as stage1ExpireLot } from './transactions.js'

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function expireLot(input) {
  if (!input?.reasonCode) {
    throw finError('REASON_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
  }
  if (!input.lotId) {
    throw finError('REASON_CODE_REQUIRED', {
      category: CATEGORY.VALIDATION,
      details: { field: 'lotId' },
    })
  }
  const now = iso(input.now)
  return transaction(async (client) => {
    const expired = await stage1ExpireLot({ ...input, now })
    const { rows } = await client.query(
      `SELECT * FROM fin.lots WHERE id = $1`,
      [input.lotId],
    )
    const lot = rows[0]
    if (lot) {
      // remaining is 0 after the EXPIRY allocation. Breakage uses the
      // units that just moved: granted - remaining_after_draws (pre-expiry
      // remaining is reconstructible as -SUM(expiry allocation)).
      const pre = await client.query(
        `SELECT COALESCE(SUM(-a.units), 0)::bigint AS expired_units
           FROM fin.lot_allocations a
           JOIN fin.ledger_postings p ON p.id = a.posting_id
           JOIN fin.ledger_transactions t ON t.id = p.transaction_id
          WHERE a.lot_id = $1 AND t.shape = 'EXPIRY'`,
        [lot.id],
      )
      const remainingAtExpiry = pre.rows[0]?.expired_units ?? lot.remaining_units
      await recordBreakageForLot(client, {
        lot: { ...lot, remaining_units: remainingAtExpiry },
        expiryTxId: expired.txId,
        now,
        actor: {
          type: input.actorType || 'SYSTEM',
          id: input.actorId || null,
          email: input.actorEmail,
        },
      })
    }
    return expired
  })
}
