import { describe, expect, it, vi } from 'vitest'
import {
  buildDefaultNotificationPrefs,
  ensureDefaultNotificationPreferences,
  normalizeNotificationPrefs,
  serializeNotificationPrefs,
} from './notification-preferences.js'

describe('notification preference defaults', () => {
  it('stores canonical user ownership and typed event toggles', () => {
    const prefs = buildDefaultNotificationPrefs('user-1', {
      id: 'pref-1',
      now: '2026-08-09T00:00:00.000Z',
    })

    expect(prefs).toMatchObject({
      id: 'pref-1',
      user_id: 'user-1',
      event_toggles: {
        saved_search_match: true,
        inquiry_sla_overdue: true,
        viewing_reminder: true,
        viewing_no_show: true,
      },
    })
    expect(prefs).not.toHaveProperty('agent_id')
    expect(prefs).not.toHaveProperty('events')
  })

  it('does not add rows on repeated startup seeding', async () => {
    const preferences = []
    const insertPreference = vi.fn(async (prefs) => preferences.push(prefs))
    const agents = [
      { id: 'agent-1', user_id: 'user-1' },
      { id: 'agent-2', user_id: 'user-2' },
    ]
    let sequence = 0
    const createId = () => `pref-${++sequence}`
    const now = () => '2026-08-09T00:00:00.000Z'

    const firstInsertCount = await ensureDefaultNotificationPreferences({
      agents,
      preferences,
      createId,
      insertPreference,
      now,
    })
    const secondInsertCount = await ensureDefaultNotificationPreferences({
      agents,
      preferences,
      createId,
      insertPreference,
      now,
    })

    expect(firstInsertCount).toBe(2)
    expect(secondInsertCount).toBe(0)
    expect(preferences).toHaveLength(2)
    expect(insertPreference).toHaveBeenCalledTimes(2)
  })

  it('treats a concurrent unique-key winner as successful idempotency', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: '23505' })
    const inserted = await ensureDefaultNotificationPreferences({
      agents: [{ id: 'user-1', user_id: 'user-1' }],
      preferences: [],
      createId: () => 'pref-1',
      insertPreference: vi.fn().mockRejectedValue(duplicate),
      now: () => '2026-08-09T00:00:00.000Z',
    })

    expect(inserted).toBe(0)
  })

  it('preserves customized events while keeping the legacy API shape', () => {
    const stored = normalizeNotificationPrefs({
      id: 'pref-1',
      user_id: 'user-1',
      events: { viewing_reminder: false },
      event_toggles: null,
    })
    const response = serializeNotificationPrefs(stored)

    expect(stored.event_toggles.viewing_reminder).toBe(false)
    expect(response.events.viewing_reminder).toBe(false)
    expect(response).not.toHaveProperty('event_toggles')
  })
})
