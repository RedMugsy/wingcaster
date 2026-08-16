/**
 * Delivery-log writer for commercial.notification_deliveries.
 *
 * One row per (event, channel). Status transitions once:
 *   pending -> sent | failed | skipped
 *
 * Nothing else mutates delivery rows. Retries create new rows for
 * the same event_id (attempts increments on the same row instead —
 * simpler; can be split into per-attempt rows later if needed).
 */

import { randomUUID } from 'crypto'
import { findAll, findOne, insert, query } from '../../db.js'

const COLLECTION = 'notification_deliveries'

const VALID_STATUS = new Set(['pending', 'sent', 'failed', 'skipped'])

export async function insertPendingDelivery({ eventId, channel, destination, metadata = {} }) {
  const row = {
    id: randomUUID(),
    event_id: eventId,
    channel,
    destination: destination || null,
    status: 'pending',
    attempts: 0,
    metadata,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  await insert(COLLECTION, row)
  return row
}

export async function markSent(deliveryId, { provider = null, providerMessageId = null } = {}) {
  const now = new Date().toISOString()
  await query(
    `UPDATE commercial.notification_deliveries
        SET status = 'sent',
            attempts = attempts + 1,
            attempted_at = $2::timestamptz,
            succeeded_at = $2::timestamptz,
            provider = $3,
            provider_message_id = $4,
            updated_at = $2::timestamptz
      WHERE id = $1`,
    [deliveryId, now, provider, providerMessageId],
  )
  return findOne(COLLECTION, (d) => d.id === deliveryId)
}

export async function markFailed(deliveryId, { errorCode = null, errorMessage = null, provider = null } = {}) {
  const now = new Date().toISOString()
  await query(
    `UPDATE commercial.notification_deliveries
        SET status = 'failed',
            attempts = attempts + 1,
            attempted_at = $2::timestamptz,
            failed_at = $2::timestamptz,
            provider = $3,
            error_code = $4,
            error_message = $5,
            updated_at = $2::timestamptz
      WHERE id = $1`,
    [deliveryId, now, provider, errorCode, errorMessage ? String(errorMessage).slice(0, 2000) : null],
  )
  return findOne(COLLECTION, (d) => d.id === deliveryId)
}

export async function markSkipped(deliveryId, { reason }) {
  const now = new Date().toISOString()
  await query(
    `UPDATE commercial.notification_deliveries
        SET status = 'skipped',
            skip_reason = $2,
            updated_at = $3::timestamptz
      WHERE id = $1`,
    [deliveryId, reason || null, now],
  )
  return findOne(COLLECTION, (d) => d.id === deliveryId)
}

export async function listDeliveries({ eventId, status, channel, limit = 200 } = {}) {
  const rows = await findAll(COLLECTION, (d) => {
    if (eventId && d.event_id !== eventId) return false
    if (status && d.status !== status) return false
    if (channel && d.channel !== channel) return false
    return true
  })
  return rows
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
}

export async function getDelivery(id) {
  return findOne(COLLECTION, (d) => d.id === id)
}

// Exported for test guards.
export { VALID_STATUS }
