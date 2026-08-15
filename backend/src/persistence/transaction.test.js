import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, findOne, insert, query, transaction, update } from '../db.js'
import { skipIfNoPostgres, withTestDb } from '../testing/postgres.js'

const { Pool } = pg

const AUDIT_COLLECTION = 'audit_log'

skipIfNoPostgres()('transaction(work) — nested DAL calls share the client', () => {
  it('rolls back inserts issued via the DAL when work() throws', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const marker = `tx_test_${randomUUID()}`

        await expect(transaction(async () => {
          // Nested insert routed through the module surface (NOT the raw
          // client). Before the ALS threading fix this insert opened its
          // own connection off the pool and the outer ROLLBACK affected
          // nothing.
          await insert(AUDIT_COLLECTION, {
            id: randomUUID(),
            type: 'billing',
            action: 'tx_rollback_test',
            metadata: { marker },
          })
          throw new Error('force rollback')
        })).rejects.toThrow('force rollback')

        // Direct pool query bypasses ALS — proves the row was actually
        // rolled back (not just filtered by an ambient transaction we
        // never left).
        const pool = new Pool({ connectionString: databaseUrl })
        try {
          const { rows } = await pool.query(
            `SELECT id FROM audit_log WHERE action = 'tx_rollback_test' AND (metadata->>'marker') = $1`,
            [marker],
          )
          expect(rows).toHaveLength(0)
        } finally {
          await pool.end()
        }
      } finally {
        await closeDb()
      }
    })
  })

  it('commits inserts + updates issued via the DAL when work() resolves', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const marker = `tx_commit_${randomUUID()}`
        const id = randomUUID()

        await transaction(async () => {
          await insert(AUDIT_COLLECTION, {
            id,
            type: 'billing',
            action: 'tx_commit_test',
            metadata: { marker, phase: 'insert' },
          })
          await update(
            AUDIT_COLLECTION,
            (r) => r.id === id,
            (r) => ({ ...r, metadata: { marker, phase: 'updated' } }),
          )
        })

        const row = await findOne(AUDIT_COLLECTION, (r) => r.id === id)
        expect(row).toBeTruthy()
        expect(row.metadata).toMatchObject({ marker, phase: 'updated' })
      } finally {
        await closeDb()
      }
    })
  })

  it('nested transaction() reuses the outer client (no BEGIN-on-BEGIN error)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const marker = `tx_nested_${randomUUID()}`
        const outerId = randomUUID()
        const innerId = randomUUID()

        await transaction(async () => {
          await insert(AUDIT_COLLECTION, {
            id: outerId,
            type: 'billing',
            action: 'tx_nested_outer',
            metadata: { marker },
          })
          await transaction(async () => {
            await insert(AUDIT_COLLECTION, {
              id: innerId,
              type: 'billing',
              action: 'tx_nested_inner',
              metadata: { marker },
            })
          })
        })

        const outer = await findOne(AUDIT_COLLECTION, (r) => r.id === outerId)
        const inner = await findOne(AUDIT_COLLECTION, (r) => r.id === innerId)
        expect(outer).toBeTruthy()
        expect(inner).toBeTruthy()
      } finally {
        await closeDb()
      }
    })
  })

  it('raw query() inside transaction sees writes made via insert() (read-your-own-writes)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const marker = `tx_ryow_${randomUUID()}`
        const id = randomUUID()

        await transaction(async () => {
          await insert(AUDIT_COLLECTION, {
            id,
            type: 'billing',
            action: 'tx_ryow_test',
            metadata: { marker },
          })
          // Raw query goes through runLogged → ALS → ambient client, so it
          // MUST see the row we just wrote in this transaction.
          const rows = await query(
            `SELECT id FROM audit_log WHERE id = $1`,
            [id],
          )
          expect(rows).toHaveLength(1)
        })
      } finally {
        await closeDb()
      }
    })
  })
})
