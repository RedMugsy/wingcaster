/**
 * Hold TTL sweeper (D §5). Advisory class FIN_HOLD_EXPIRY = 1002.
 * Probe without holding; per hold lock book NOWAIT then expireHold.
 * 55P03 → skip (CAPTURE holds the book); next tick retries.
 */
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { FIN_HOLD_EXPIRY } from '../foundation/advisory-locks.js'
import { expireHold } from '../ledger/transactions.js'

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function runHoldExpiryTick({
  pool, now, limit = 100,
} = {}) {
  const clock = iso(now)
  const lockClient = await pool.connect()
  try {
    const locked = await lockClient.query(
      'SELECT pg_try_advisory_lock($1, $2) AS ok',
      [FIN_HOLD_EXPIRY, 0],
    )
    if (!locked.rows[0].ok) {
      return { skipped: true, processed: 0, results: [], reason: 'HOLD_EXPIRY_LOCK_HELD' }
    }

    try {
      const due = await lockClient.query(
        `SELECT id, book_id FROM fin.holds
          WHERE status = 'OPEN' AND expires_at <= $1::timestamptz
          ORDER BY book_id ASC, expires_at ASC, id ASC
          LIMIT $2`,
        [clock, limit],
      )

      const results = []
      let processed = 0
      for (const hold of due.rows) {
        try {
          const outcome = await transaction(async (client) => {
            await client.query('SAVEPOINT hold_expiry_book')
            try {
              await client.query(
                `SELECT id FROM fin.ledger_books WHERE id = $1 FOR UPDATE NOWAIT`,
                [hold.book_id],
              )
            } catch (error) {
              await client.query('ROLLBACK TO SAVEPOINT hold_expiry_book').catch(() => {})
              if (error.code === '55P03') {
                return { skipped: true, reason: '55P03', holdId: hold.id }
              }
              throw error
            }
            const lockedHold = await client.query(
              `SELECT id FROM fin.holds
                WHERE id = $1 AND status = 'OPEN' AND expires_at <= $2::timestamptz
                FOR UPDATE SKIP LOCKED`,
              [hold.id, clock],
            )
            if (!lockedHold.rowCount) {
              return { skipped: true, reason: 'skipped_locked', holdId: hold.id }
            }
            // Hold TTL: no accounting event. The hold never captured, so
            // nothing is recognized and BREAKAGE is a lot-expiry concern
            // (C §5.8 / expire-lot.js), not a hold-expiry concern.
            const expired = await expireHold({
              holdId: hold.id,
              now: clock,
              actorType: 'WORKER',
              reasonCode: 'HOLD_TTL',
            })
            return { skipped: false, holdId: hold.id, txId: expired.txId }
          })
          results.push(outcome)
          if (!outcome.skipped) processed += 1
        } catch (error) {
          if (error.code === '55P03') {
            results.push({ skipped: true, reason: '55P03', holdId: hold.id })
            continue
          }
          if (error.code === 'HOLD_NOT_OPEN' || error.code === 'HOLD_ALREADY_TERMINAL') {
            results.push({ skipped: true, reason: error.code, holdId: hold.id })
            continue
          }
          throw error
        }
      }

      return { skipped: false, processed, results }
    } finally {
      await lockClient.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [FIN_HOLD_EXPIRY, 0],
      )
    }
  } finally {
    lockClient.release()
  }
}
