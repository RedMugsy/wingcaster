import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { closeDb, configure, query } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import { EVENT_KINDS } from './events.js'
import { setPreference } from './preferences.js'

// Mock the underlying email transport so tests never try real SMTP.
vi.mock('../../lib/notifications/email.js', () => ({
  isEmailEnabled: () => true,
  sendEmail: vi.fn(async ({ to, subject }) => ({
    ok: true,
    provider: 'test-mock',
    provider_message_id: `mock-${to}-${subject.slice(0, 8)}`,
  })),
}))

// Import AFTER the mock is registered.
const { dispatch } = await import('./dispatcher.js')
const emailMod = await import('../../lib/notifications/email.js')

async function seedTenant(email = null) {
  const id = randomUUID()
  await query(
    `INSERT INTO users (id, name, email, password_hash, role, verified, verified_at, token_version)
     VALUES ($1, $2, $3, 'x', 'agent', true, CURRENT_TIMESTAMP, 0)`,
    [id, 'Test Tenant', email || `test-${id}@example.com`],
  )
  return id
}

skipIfNoPostgres()('dispatcher.dispatch', () => {
  it('happy path: writes event, delivers via email, marks delivery sent', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = await seedTenant()
        emailMod.sendEmail.mockClear()

        const result = await dispatch({
          eventKind: EVENT_KINDS.SUB_RENEWED,
          tenantId,
          context: {
            tenant: { name: 'Test' },
            plan: { name: 'Pro', price_display: 'USD 99.00', cadence: 'month' },
            next_renewal_short: 'Sep 16, 2026',
          },
        })

        expect(result.eventId).toBeTruthy()
        expect(result.deliveries).toHaveLength(1)
        expect(result.deliveries[0]).toEqual(expect.objectContaining({ channel: 'email', status: 'sent' }))
        expect(emailMod.sendEmail).toHaveBeenCalledTimes(1)

        const events = await query(
          `SELECT id, event_kind FROM commercial.notification_events WHERE tenant_id = $1`,
          [tenantId],
        )
        expect(events).toHaveLength(1)
        expect(events[0].event_kind).toBe(EVENT_KINDS.SUB_RENEWED)

        const deliveries = await query(
          `SELECT status, channel, destination FROM commercial.notification_deliveries WHERE event_id = $1`,
          [result.eventId],
        )
        expect(deliveries).toHaveLength(1)
        expect(deliveries[0]).toEqual(expect.objectContaining({ status: 'sent', channel: 'email' }))
      } finally {
        await closeDb()
      }
    })
  })

  it('opted-out tenant: marks delivery skipped with reason=tenant_opted_out and never calls sendEmail', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = await seedTenant()
        await setPreference({ tenantId, eventKind: EVENT_KINDS.SUB_RENEWED, channel: 'email', enabled: false })
        emailMod.sendEmail.mockClear()

        const result = await dispatch({
          eventKind: EVENT_KINDS.SUB_RENEWED,
          tenantId,
          context: { tenant: { name: 'Test' } },
        })

        expect(result.deliveries[0]).toEqual(expect.objectContaining({ status: 'skipped', reason: 'tenant_opted_out' }))
        expect(emailMod.sendEmail).not.toHaveBeenCalled()

        const deliveries = await query(
          `SELECT status, skip_reason FROM commercial.notification_deliveries WHERE event_id = $1`,
          [result.eventId],
        )
        expect(deliveries[0].skip_reason).toBe('tenant_opted_out')
      } finally {
        await closeDb()
      }
    })
  })

  it('no user row for tenant_id: marks skipped=no_tenant_email; never throws', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        emailMod.sendEmail.mockClear()
        const result = await dispatch({
          eventKind: EVENT_KINDS.SUB_RENEWED,
          tenantId: randomUUID(),
          context: {},
        })
        expect(result.deliveries[0]).toEqual(expect.objectContaining({ status: 'skipped', reason: 'no_tenant_email' }))
        expect(emailMod.sendEmail).not.toHaveBeenCalled()
      } finally {
        await closeDb()
      }
    })
  })

  it('email transport throws: marks delivery failed with error captured; never propagates', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = await seedTenant()
        emailMod.sendEmail.mockClear()
        emailMod.sendEmail.mockImplementationOnce(async () => {
          const err = new Error('SMTP transport down')
          err.code = 'ETIMEDOUT'
          throw err
        })

        const result = await dispatch({
          eventKind: EVENT_KINDS.SUB_RENEWED,
          tenantId,
          context: { tenant: { name: 'Test' } },
        })

        expect(result.deliveries[0]).toEqual(expect.objectContaining({ status: 'failed' }))
        const deliveries = await query(
          `SELECT status, error_code, error_message FROM commercial.notification_deliveries WHERE event_id = $1`,
          [result.eventId],
        )
        expect(deliveries[0]).toEqual(expect.objectContaining({
          status: 'failed',
          error_code: 'ETIMEDOUT',
          error_message: 'SMTP transport down',
        }))
      } finally {
        await closeDb()
      }
    })
  })
})
