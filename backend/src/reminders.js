/**
 * Reminder policies for appointments (viewings, calls, bookings, meetings).
 *
 * A policy is a template attached to an agent or agency. It defines a set of
 * reminder rules per appointment type. Each rule specifies how many minutes before
 * or after the event the reminder should fire, and on which channels.
 *
 * Collection: reminder_policies
 *   - id, name, owner_type ('agent' | 'agency'), owner_id
 *   - appointment_type ('viewing' | 'call' | 'booking' | 'meeting')
 *   - rules: [{ offset_minutes, channels: ['email'|'whatsapp'|'inapp'], message_template, active }]
 *   - is_default, created_at, updated_at
 *
 * The viewing automation picks the most specific policy available:
 *   1. Agent's policy for the appointment type
 *   2. Agency's policy for the appointment type
 *   3. Global default policy
 */

import { v4 as uuidv4 } from 'uuid'
import { findAll, findOne, insert, update, remove } from './db.js'

const VALID_CHANNELS = ['email', 'whatsapp', 'inapp']
const VALID_APPOINTMENT_TYPES = ['viewing', 'call', 'booking', 'meeting']
const VALID_OWNER_TYPES = ['agent', 'agency']

function nowIso() {
  return new Date().toISOString()
}

export async function createReminderPolicy({
  name,
  ownerType,
  ownerId,
  appointmentType,
  rules = [],
  isDefault = false,
}) {
  if (!name?.trim()) throw new Error('Reminder policy name is required')
  if (!VALID_OWNER_TYPES.includes(ownerType)) throw new Error(`Invalid owner_type: ${ownerType}`)
  if (!VALID_APPOINTMENT_TYPES.includes(appointmentType)) throw new Error(`Invalid appointment_type: ${appointmentType}`)
  if (!Array.isArray(rules) || rules.length === 0) throw new Error('At least one rule is required')

  const normalizedRules = rules.map((r, idx) => {
    const channels = Array.isArray(r.channels) ? r.channels : [r.channels].filter(Boolean)
    const invalidChannels = channels.filter((c) => !VALID_CHANNELS.includes(c))
    if (invalidChannels.length) throw new Error(`Invalid channels: ${invalidChannels.join(', ')}`)
    if (!channels.length) throw new Error(`Rule ${idx} requires at least one channel`)
    return {
      offset_minutes: Number(r.offset_minutes) || 0,
      channels,
      message_template: String(r.message_template || '').trim(),
      active: r.active !== false,
    }
  })

  const policy = {
    id: uuidv4(),
    name: name.trim(),
    owner_type: ownerType,
    owner_id: ownerId,
    appointment_type: appointmentType,
    rules: normalizedRules,
    is_default: Boolean(isDefault),
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  await insert('reminder_policies', policy)
  return policy
}

export async function getReminderPolicies({ ownerType, ownerId, appointmentType } = {}) {
  let rows = await findAll('reminder_policies')
  if (ownerType) rows = rows.filter((p) => p.owner_type === ownerType)
  if (ownerId) rows = rows.filter((p) => p.owner_id === ownerId)
  if (appointmentType) rows = rows.filter((p) => p.appointment_type === appointmentType)
  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return rows
}

export async function getReminderPolicyById(id) {
  return await findOne('reminder_policies', (p) => p.id === id)
}

export async function updateReminderPolicy(id, patch) {
  const policy = await findOne('reminder_policies', (p) => p.id === id)
  if (!policy) return null
  const allowed = ['name', 'appointment_type', 'rules', 'is_default']
  const next = { ...policy, updated_at: nowIso() }
  for (const key of allowed) {
    if (patch[key] !== undefined) next[key] = patch[key]
  }
  if (!VALID_APPOINTMENT_TYPES.includes(next.appointment_type)) {
    throw new Error(`Invalid appointment_type: ${next.appointment_type}`)
  }
  if (next.rules) {
    next.rules = next.rules.map((r, idx) => {
      const channels = Array.isArray(r.channels) ? r.channels : [r.channels].filter(Boolean)
      const invalidChannels = channels.filter((c) => !VALID_CHANNELS.includes(c))
      if (invalidChannels.length) throw new Error(`Invalid channels: ${invalidChannels.join(', ')}`)
      if (!channels.length) throw new Error(`Rule ${idx} requires at least one channel`)
      return {
        offset_minutes: Number(r.offset_minutes) || 0,
        channels,
        message_template: String(r.message_template || '').trim(),
        active: r.active !== false,
      }
    })
  }
  await update('reminder_policies', (p) => p.id === id, () => next)
  return await findOne('reminder_policies', (p) => p.id === id)
}

export async function deleteReminderPolicy(id) {
  return await remove('reminder_policies', (p) => p.id === id)
}

function getDefaultPolicy(appointmentType) {
  const defaults = {
    viewing: {
      name: 'Default Viewing Reminders',
      appointment_type: 'viewing',
      rules: [
        { offset_minutes: 120, channels: ['inapp'], message_template: 'Upcoming viewing in {{minutes}} minutes.', active: true },
      ],
    },
    call: {
      name: 'Default Call Reminders',
      appointment_type: 'call',
      rules: [
        { offset_minutes: 15, channels: ['inapp'], message_template: 'Upcoming call in {{minutes}} minutes.', active: true },
      ],
    },
    booking: {
      name: 'Default Booking Reminders',
      appointment_type: 'booking',
      rules: [
        { offset_minutes: 60, channels: ['inapp'], message_template: 'Upcoming booking in {{minutes}} minutes.', active: true },
      ],
    },
    meeting: {
      name: 'Default Meeting Reminders',
      appointment_type: 'meeting',
      rules: [
        { offset_minutes: 60, channels: ['inapp'], message_template: 'Upcoming meeting in {{minutes}} minutes.', active: true },
      ],
    },
  }
  return defaults[appointmentType] || defaults.viewing
}

export async function resolveReminderPolicy({ appointmentType, agentId, agencyId }) {
  let rows = await getReminderPolicies({ appointmentType })
  if (agentId) {
    const agentPolicy = rows.find((p) => p.owner_type === 'agent' && p.owner_id === agentId)
    if (agentPolicy) return agentPolicy
  }
  if (agencyId) {
    const agencyPolicy = rows.find((p) => p.owner_type === 'agency' && p.owner_id === agencyId)
    if (agencyPolicy) return agencyPolicy
  }
  return getDefaultPolicy(appointmentType)
}

/**
 * Evaluate a policy for a viewing at a given reference time.
 * Returns reminders that should be sent (not yet sent) based on the
 * `viewing.reminders_sent` array.
 */
export function evaluateReminderPolicy({ policy, scheduledAt, referenceTime, remindersSent = [] }) {
  const sentKeys = new Set((remindersSent || []).map((r) => `${r.offset_minutes}:${r.channels.join(',')}`))
  const nowMs = referenceTime.getTime()
  const scheduledMs = new Date(scheduledAt).getTime()
  if (Number.isNaN(scheduledMs)) return []

  const due = []
  for (const rule of policy.rules || []) {
    if (!rule.active) continue
    const fireAtMs = scheduledMs - rule.offset_minutes * 60 * 1000
    const key = `${rule.offset_minutes}:${rule.channels.join(',')}`
    if (fireAtMs <= nowMs && !sentKeys.has(key)) {
      due.push({ ...rule, fire_at: new Date(fireAtMs).toISOString(), key })
    }
  }
  return due
}

export async function markReminderSent(viewing, reminder) {
  const latest = await findOne('viewings', (v) => v.id === viewing.id)
  const sent = Array.isArray(latest?.reminders_sent) ? latest.reminders_sent : []
  const updated = [...sent, { offset_minutes: reminder.offset_minutes, channels: reminder.channels, sent_at: nowIso() }]
  await update('viewings', (v) => v.id === viewing.id, (v) => ({ ...v, reminders_sent: updated, updated_at: nowIso() }))
  return await findOne('viewings', (v) => v.id === viewing.id)
}
