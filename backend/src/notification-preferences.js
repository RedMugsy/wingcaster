export const DEFAULT_NOTIFICATION_CHANNELS = Object.freeze({
  inapp: true,
  email: true,
  whatsapp: true,
})

export const DEFAULT_NOTIFICATION_EVENTS = Object.freeze({
  saved_search_match: true,
  inquiry_sla_overdue: true,
  viewing_reminder: true,
  viewing_no_show: true,
})

export const DEFAULT_NOTIFICATION_QUIET_HOURS = Object.freeze({
  enabled: false,
  start: '22:00',
  end: '08:00',
  timezone: 'UTC',
})

export function buildDefaultNotificationPrefs(userId, { id, now = new Date().toISOString() } = {}) {
  if (!userId) throw new Error('A canonical user id is required for notification preferences')
  if (!id) throw new Error('A preference id is required')

  return {
    id,
    user_id: userId,
    channels: { ...DEFAULT_NOTIFICATION_CHANNELS },
    event_toggles: { ...DEFAULT_NOTIFICATION_EVENTS },
    quiet_hours: { ...DEFAULT_NOTIFICATION_QUIET_HOURS },
    created_at: now,
    updated_at: now,
  }
}

export function normalizeNotificationPrefs(prefs) {
  return {
    ...prefs,
    channels: { ...DEFAULT_NOTIFICATION_CHANNELS, ...(prefs?.channels || {}) },
    event_toggles: {
      ...DEFAULT_NOTIFICATION_EVENTS,
      ...(prefs?.events || {}),
      ...(prefs?.event_toggles || {}),
    },
    quiet_hours: { ...DEFAULT_NOTIFICATION_QUIET_HOURS, ...(prefs?.quiet_hours || {}) },
  }
}

export function serializeNotificationPrefs(prefs) {
  const normalized = normalizeNotificationPrefs(prefs)
  const { event_toggles, events: _legacyEvents, ...rest } = normalized
  return { ...rest, events: event_toggles }
}

export function missingPreferenceUsers(agents, preferences) {
  const existing = new Set(
    (preferences || [])
      .map((prefs) => prefs.user_id)
      .filter(Boolean),
  )

  return (agents || [])
    .map((agent) => agent.user_id || agent.id)
    .filter((userId) => userId && !existing.has(userId))
}

export async function ensureDefaultNotificationPreferences({
  agents,
  preferences,
  createId,
  insertPreference,
  now = () => new Date().toISOString(),
}) {
  let inserted = 0
  for (const userId of missingPreferenceUsers(agents, preferences)) {
    const prefs = buildDefaultNotificationPrefs(userId, { id: createId(), now: now() })
    try {
      await insertPreference(prefs)
      inserted += 1
    } catch (err) {
      // Another startup process may have inserted the same logical user row
      // after our initial read. The unique user_id index is the final arbiter.
      if (err?.code !== '23505') throw err
    }
  }
  return inserted
}
