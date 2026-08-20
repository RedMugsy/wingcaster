/**
 * Facility-reservation TTL sweeper. Mirrors Stage 6 expiry-worker.
 * Advisory class FIN_FACILITY_RESERVATION_EXPIRY = 1017.
 * Per reservation: SAVEPOINT + facility FOR UPDATE NOWAIT; 55P03 → skip.
 */
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { FIN_FACILITY_RESERVATION_EXPIRY } from '../foundation/advisory-locks.js'
import { expireFacilityReservation } from './reservations.js'

function iso(value) {
  if (!value) return BusinessClock.now()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function runFacilityReservationExpiryTick({
  pool, now, limit = 100,
} = {}) {
  const clock = iso(now)
  const lockClient = await pool.connect()
  try {
    const locked = await lockClient.query(
      'SELECT pg_try_advisory_lock($1, $2) AS ok',
      [FIN_FACILITY_RESERVATION_EXPIRY, 0],
    )
    if (!locked.rows[0].ok) {
      return {
        skipped: true, processed: 0, results: [],
        reason: 'FACILITY_RESERVATION_EXPIRY_LOCK_HELD',
      }
    }

    try {
      const due = await lockClient.query(
        `SELECT id, facility_id FROM fin.facility_reservations
          WHERE status = 'OPEN' AND expires_at <= $1::timestamptz
          ORDER BY facility_id ASC, expires_at ASC, id ASC
          LIMIT $2`,
        [clock, limit],
      )

      const results = []
      let processed = 0
      for (const row of due.rows) {
        try {
          const outcome = await transaction(async (client) => {
            await client.query('SAVEPOINT facility_res_expiry')
            try {
              await client.query(
                `SELECT id FROM fin.credit_facilities WHERE id = $1 FOR UPDATE NOWAIT`,
                [row.facility_id],
              )
            } catch (error) {
              await client.query('ROLLBACK TO SAVEPOINT facility_res_expiry').catch(() => {})
              if (error.code === '55P03') {
                return { skipped: true, reason: '55P03', reservationId: row.id }
              }
              throw error
            }
            const lockedRow = await client.query(
              `SELECT id FROM fin.facility_reservations
                WHERE id = $1 AND status = 'OPEN' AND expires_at <= $2::timestamptz
                FOR UPDATE SKIP LOCKED`,
              [row.id, clock],
            )
            if (!lockedRow.rowCount) {
              return { skipped: true, reason: 'skipped_locked', reservationId: row.id }
            }
            await expireFacilityReservation({
              reservationId: row.id,
              now: clock,
              actorType: 'WORKER',
              reasonCode: 'FACILITY_RES_TTL',
            })
            return { skipped: false, reservationId: row.id }
          })
          results.push(outcome)
          if (!outcome.skipped) processed += 1
        } catch (error) {
          if (error.code === '55P03') {
            results.push({ skipped: true, reason: '55P03', reservationId: row.id })
            continue
          }
          if (error.code === 'FACILITY_RES_NOT_OPEN') {
            results.push({ skipped: true, reason: error.code, reservationId: row.id })
            continue
          }
          throw error
        }
      }
      return { skipped: false, processed, results }
    } finally {
      await lockClient.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [FIN_FACILITY_RESERVATION_EXPIRY, 0],
      )
    }
  } finally {
    lockClient.release()
  }
}
