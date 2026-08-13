/**
 * Thin data-access helpers for the module.
 *
 * All module collections use the core platform's SQLite JSON-document store.
 * Foreign keys to platform entities are nullable and use ON DELETE SET NULL
 * semantics where possible.
 */

import { insert, findOne, findAll, update, remove } from '../../../db.js'

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
