/**
 * After Stage 1 captureHold, capture the linked facility reservation
 * in the same ambient transaction (nested transaction() joins).
 */
import { captureFacilityForHold } from './reservations.js'

export async function captureHybridHold(input) {
  let reservationId = input.reservationId || null
  const client = input.client
  if (!reservationId && input.holdId && client) {
    const found = await client.query(
      `SELECT facility_reservation_id FROM fin.holds WHERE id = $1`,
      [input.holdId],
    )
    reservationId = found.rows[0]?.facility_reservation_id || null
  }
  if (!reservationId) return { skipped: true }
  return captureFacilityForHold({
    ...input,
    reservationId,
    allowHold: true,
  })
}
