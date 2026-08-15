import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, query } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import { createProduct } from './products.js'
import { recordEvent, listEvents } from './subscription-history.js'

async function seedSubscription() {
  const product = await createProduct({ code: `sh-${randomUUID().slice(0, 8)}`, name: 'P', version: 1 })
  const subId = randomUUID()
  await query(
    `INSERT INTO commercial.billing_subscriptions (id, tenant_id, product_id, product_version, status)
     VALUES ($1, $2, $3, 1, 'active')`,
    [subId, randomUUID(), product.id],
  )
  return { subscriptionId: subId, product }
}

skipIfNoPostgres()('subscription-history', () => {
  it('recordEvent + listEvents round-trip; ordered newest-first', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const { subscriptionId } = await seedSubscription()

        await recordEvent({
          subscriptionId, event: 'created',
          toState: { status: 'trialing' },
          actorType: 'tenant', actorId: 'agent-1', reason: 'signup',
        })
        // Small wait so the second row has a distinct created_at when the
        // DB clock ticks at millisecond granularity.
        await new Promise((r) => setTimeout(r, 20))
        await recordEvent({
          subscriptionId, event: 'renewed',
          fromState: { status: 'trialing' }, toState: { status: 'active' },
          actorType: 'system',
        })

        const events = await listEvents(subscriptionId)
        expect(events.length).toBeGreaterThanOrEqual(2)
        expect(events[0].event).toBe('renewed')
        expect(events[1].event).toBe('created')
        expect(events[1].actor_id).toBe('agent-1')
      } finally {
        await closeDb()
      }
    })
  })

  it('recordEvent: rejects missing subscriptionId, missing event, unknown actor type', async () => {
    await expect(recordEvent({ event: 'x' })).rejects.toMatchObject({ code: 'MISSING_FIELD' })
    await expect(recordEvent({ subscriptionId: 'x' })).rejects.toMatchObject({ code: 'MISSING_FIELD' })
    await expect(
      recordEvent({ subscriptionId: 'x', event: 'y', actorType: 'bogus' }),
    ).rejects.toMatchObject({ code: 'INVALID_ACTOR_TYPE' })
  })
})
