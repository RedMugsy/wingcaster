/**
 * Thin data-access helpers for the module.
 *
 * All module collections use the core platform's SQLite JSON-document store.
 * Foreign keys to platform entities are nullable and use ON DELETE SET NULL
 * semantics where possible.
 */

import { randomUUID } from 'crypto'
import { insert, findOne, findAll, update, remove, query } from '../../../db.js'

export const Collections = {
  PROCESSED_MESSAGES: 'whatsapp_listing_processed_messages',
  SESSIONS: 'whatsapp_listing_sessions',
  DRAFTS: 'whatsapp_listing_drafts',
  AI_USAGE_LOGS: 'whatsapp_listing_ai_usage_logs',
  AUDIT_LOGS: 'whatsapp_listing_audit_logs',
  DEAD_LETTERS: 'whatsapp_listing_dead_letters',
  FEATURE_ENTITLEMENTS: 'feature_entitlements',
  AI_CREDIT_BALANCES: 'ai_credit_balances',
  AI_CREDIT_TRANSACTIONS: 'ai_credit_transactions',
}

export async function insertModule(collection, item) {
  return await insert(collection, item)
}

export async function findOneModule(collection, filter) {
  return await findOne(collection, filter)
}

export async function findAllModule(collection, filter) {
  return await findAll(collection, filter)
}

export async function updateModule(collection, filter, updater) {
  return await update(collection, filter, updater)
}

export async function removeModule(collection, filter) {
  return await remove(collection, filter)
}

export async function countModule(collection, filter) {
  const items = await findAll(collection, filter)
  return items.length
}

/**
 * Atomically claim a WhatsApp message_id as "being processed" using the
 * UNIQUE (message_id) constraint on wa_listings.processed_messages. Two
 * concurrent deliveries of the same message will race here and exactly one
 * will win the INSERT — the other gets ON CONFLICT DO NOTHING and receives
 * `{ claimed: false }`, which the webhook handler treats as a dedup.
 *
 * Callers that FAIL to run the downstream pipeline must call
 * `releaseProcessedMessage(messageId)` to remove the claim so the provider's
 * retry can succeed. Callers that SUCCEED leave the row in place — the
 * message is now permanently processed.
 */
export async function claimProcessedMessage(messageId, fromNumber) {
  if (!messageId) throw new Error('messageId is required')
  const id = randomUUID()
  const result = await query(
    `INSERT INTO wa_listings.processed_messages (id, message_id, from_number, processed_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (message_id) DO NOTHING
       RETURNING id`,
    [id, messageId, fromNumber || null],
  )
  const won = Array.isArray(result?.rows) ? result.rows.length > 0 : (result?.rowCount ?? 0) > 0
  return won ? { claimed: true, id } : { claimed: false }
}

/**
 * Roll back a claim so a provider retry can re-attempt this message. Used
 * when the downstream pipeline throws — we must not leave a stray "processed"
 * row that would silently dedup the retry.
 */
export async function releaseProcessedMessage(messageId) {
  if (!messageId) return
  await query(
    `DELETE FROM wa_listings.processed_messages WHERE message_id = $1`,
    [messageId],
  )
}
