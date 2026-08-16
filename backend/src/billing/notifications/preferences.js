/**
 * Per-tenant notification preferences — opt-OUT model.
 *
 * A missing row means the tenant is opted IN (default is to notify).
 * Insert a row with enabled=false to opt out. Insert with enabled=true
 * to explicitly opt back in (useful for future policy where new event
 * kinds default to off).
 *
 * Preferences are per (tenant_id, event_kind, channel). Callers who
 * want to know "is tenant X opted in to event Y over channel Z" call
 * isEnabled(). Callers listing prefs for a UI call listPreferences().
 */

import { randomUUID } from 'crypto'
import { findAll, findOne, insert, query } from '../../db.js'
import { ALL_EVENT_KINDS } from './events.js'

const COLLECTION = 'notification_preferences'
const VALID_CHANNELS = new Set(['email', 'sms', 'whatsapp', 'in_app'])

export async function isEnabled({ tenantId, eventKind, channel }) {
  if (!tenantId || !eventKind || !channel) return true
  const row = await findOne(COLLECTION, (p) =>
    p.tenant_id === tenantId && p.event_kind === eventKind && p.channel === channel,
  )
  if (!row) return true
  return row.enabled !== false
}

export async function listPreferences(tenantId) {
  return findAll(COLLECTION, (p) => p.tenant_id === tenantId)
}

/**
 * Build a full opt-in/out matrix for a tenant across every known event
 * kind and channel (for the tenant preferences page). Rows that don't
 * exist default to enabled=true.
 */
export async function fullPreferenceMatrix(tenantId, { channels = ['email'] } = {}) {
  const existing = await listPreferences(tenantId)
  const byKey = new Map()
  for (const row of existing) {
    byKey.set(`${row.event_kind}|${row.channel}`, row)
  }
  const matrix = []
  for (const eventKind of ALL_EVENT_KINDS) {
    for (const channel of channels) {
      const key = `${eventKind}|${channel}`
      const row = byKey.get(key)
      matrix.push({
        event_kind: eventKind,
        channel,
        enabled: row ? row.enabled !== false : true,
        explicit: Boolean(row),
        pref_id: row?.id || null,
        updated_at: row?.updated_at || null,
      })
    }
  }
  return matrix
}

export async function setPreference({ tenantId, eventKind, channel, enabled, actorId = null }) {
  if (!tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'MISSING_FIELD' })
  if (!eventKind) throw Object.assign(new Error('eventKind is required'), { code: 'MISSING_FIELD' })
  if (!VALID_CHANNELS.has(channel)) {
    throw Object.assign(new Error(`channel must be one of: ${[...VALID_CHANNELS].join(', ')}`), { code: 'INVALID_CHANNEL' })
  }
  const now = new Date().toISOString()
  const existing = await findOne(COLLECTION, (p) =>
    p.tenant_id === tenantId && p.event_kind === eventKind && p.channel === channel,
  )
  if (existing) {
    await query(
      `UPDATE commercial.notification_preferences
          SET enabled = $2, updated_by = $3, updated_at = $4::timestamptz
        WHERE id = $1`,
      [existing.id, Boolean(enabled), actorId, now],
    )
    return findOne(COLLECTION, (p) => p.id === existing.id)
  }
  const row = {
    id: randomUUID(),
    tenant_id: tenantId,
    event_kind: eventKind,
    channel,
    enabled: Boolean(enabled),
    updated_by: actorId,
    created_at: now,
    updated_at: now,
  }
  await insert(COLLECTION, row)
  return row
}

/**
 * Bulk-set: takes an array of {event_kind, channel, enabled} and
 * applies them all. Used by the tenant preferences page's "Save"
 * button.
 */
export async function bulkSetPreferences(tenantId, updates, { actorId = null } = {}) {
  const results = []
  for (const update of updates || []) {
    const row = await setPreference({
      tenantId,
      eventKind: update.event_kind,
      channel: update.channel,
      enabled: update.enabled,
      actorId,
    })
    results.push(row)
  }
  return results
}
