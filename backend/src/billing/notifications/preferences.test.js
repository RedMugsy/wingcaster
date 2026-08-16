import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import { ALL_EVENT_KINDS, EVENT_KINDS } from './events.js'
import { bulkSetPreferences, fullPreferenceMatrix, isEnabled, setPreference } from './preferences.js'

skipIfNoPostgres()('notification preferences', () => {
  it('isEnabled defaults to true when no row exists', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        expect(await isEnabled({ tenantId: randomUUID(), eventKind: EVENT_KINDS.SUB_RENEWED, channel: 'email' })).toBe(true)
      } finally {
        await closeDb()
      }
    })
  })

  it('setPreference: opt-out → isEnabled returns false; opt-back-in flips again', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = randomUUID()
        await setPreference({ tenantId, eventKind: EVENT_KINDS.SUB_RENEWED, channel: 'email', enabled: false })
        expect(await isEnabled({ tenantId, eventKind: EVENT_KINDS.SUB_RENEWED, channel: 'email' })).toBe(false)
        await setPreference({ tenantId, eventKind: EVENT_KINDS.SUB_RENEWED, channel: 'email', enabled: true })
        expect(await isEnabled({ tenantId, eventKind: EVENT_KINDS.SUB_RENEWED, channel: 'email' })).toBe(true)
      } finally {
        await closeDb()
      }
    })
  })

  it('setPreference: rejects invalid channel', async () => {
    await expect(setPreference({
      tenantId: 'x', eventKind: EVENT_KINDS.SUB_RENEWED, channel: 'bogus', enabled: true,
    })).rejects.toMatchObject({ code: 'INVALID_CHANNEL' })
  })

  it('fullPreferenceMatrix: covers every EVENT_KIND × requested channels, marks explicit rows', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = randomUUID()
        await setPreference({ tenantId, eventKind: EVENT_KINDS.SUB_PAST_DUE, channel: 'email', enabled: false })
        const matrix = await fullPreferenceMatrix(tenantId, { channels: ['email'] })
        expect(matrix).toHaveLength(ALL_EVENT_KINDS.length)
        const optedOut = matrix.find((row) => row.event_kind === EVENT_KINDS.SUB_PAST_DUE)
        expect(optedOut?.enabled).toBe(false)
        expect(optedOut?.explicit).toBe(true)
        const stillDefault = matrix.find((row) => row.event_kind === EVENT_KINDS.SUB_RENEWED)
        expect(stillDefault?.enabled).toBe(true)
        expect(stillDefault?.explicit).toBe(false)
      } finally {
        await closeDb()
      }
    })
  })

  it('bulkSetPreferences applies every update in one call', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = randomUUID()
        const rows = await bulkSetPreferences(tenantId, [
          { event_kind: EVENT_KINDS.SUB_TRIAL_ENDING, channel: 'email', enabled: false },
          { event_kind: EVENT_KINDS.SUB_RENEWED, channel: 'email', enabled: false },
        ])
        expect(rows).toHaveLength(2)
        expect(await isEnabled({ tenantId, eventKind: EVENT_KINDS.SUB_TRIAL_ENDING, channel: 'email' })).toBe(false)
        expect(await isEnabled({ tenantId, eventKind: EVENT_KINDS.SUB_RENEWED, channel: 'email' })).toBe(false)
      } finally {
        await closeDb()
      }
    })
  })
})
