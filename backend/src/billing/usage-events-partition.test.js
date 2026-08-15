import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure } from '../db.js'
import { emitUsageEvent, PLATFORM_TERRITORY_ID } from './events.js'
import { withTestDb, skipIfNoPostgres } from '../testing/postgres.js'

const { Pool } = pg

skipIfNoPostgres()('usage_events partition — platform-scoped events', () => {
  it('territory-less events land in the __platform__ partition', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = randomUUID()

        // No country, no subscription, no territory context — the
        // hardest case. Before this fix, insert would fail with 23502
        // not-null violation on territory_id (partition key + PK).
        const event = await emitUsageEvent({
          actionKey: 'webhook.received',
          tenantId,
          channel: 'instagram',
        })
        expect(event).not.toBeNull()
        expect(event.territory_id).toBe(PLATFORM_TERRITORY_ID)

        const pool = new Pool({ connectionString: databaseUrl })
        try {
          // Row is in commercial.usage_events (parent).
          const parent = await pool.query(
            'SELECT id, territory_id FROM commercial.usage_events WHERE id = $1',
            [event.id],
          )
          expect(parent.rows).toHaveLength(1)
          expect(parent.rows[0].territory_id).toBe(PLATFORM_TERRITORY_ID)

          // Row is physically in the platform partition (proves the
          // named partition binding works, not just the default).
          const partition = await pool.query(
            'SELECT id FROM commercial.usage_events_platform WHERE id = $1',
            [event.id],
          )
          expect(partition.rows).toHaveLength(1)
        } finally {
          await pool.end()
        }
      } finally {
        await closeDb()
      }
    })
  }, 180_000)

  it('column DEFAULT applies when territory_id is not supplied at all', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const pool = new Pool({ connectionString: databaseUrl })
        try {
          const id = randomUUID()
          // Direct SQL — omit territory_id entirely. DEFAULT must kick
          // in. This proves belt-and-braces coverage for callers that
          // don't route through emitUsageEvent().
          await pool.query(
            `INSERT INTO commercial.usage_events
               (id, tenant_id, action_key, quantity, billing_period)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, randomUUID(), 'listing.created', 1, '2099-01'],
          )
          const row = await pool.query(
            'SELECT territory_id FROM commercial.usage_events WHERE id = $1',
            [id],
          )
          expect(row.rows[0].territory_id).toBe(PLATFORM_TERRITORY_ID)
        } finally {
          await pool.end()
        }
      } finally {
        await closeDb()
      }
    })
  }, 180_000)
})
