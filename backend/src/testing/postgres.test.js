import pg from 'pg'
import { expect, it } from 'vitest'
import { createTestDatabase, skipIfNoPostgres, verifyPostGIS } from './postgres.js'

const { Pool } = pg

skipIfNoPostgres()('real-Postgres test harness', () => {
  it('runs migrations with PostGIS and tears down its schemas', async () => {
    const database = await createTestDatabase()
    const pool = new Pool({ connectionString: database.url })

    try {
      const table = await pool.query("SELECT to_regclass('users') AS name")
      const postgisVersion = await verifyPostGIS(pool)
      expect(table.rows[0].name).toBe('users')
      expect(postgisVersion).toBeTruthy()
    } finally {
      await pool.end()
      await database.teardown()
    }

    const verificationPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    try {
      const remaining = await verificationPool.query(
        'SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1::text[])',
        [Object.values(database.schemas)],
      )
      expect(remaining.rows).toEqual([])
    } finally {
      await verificationPool.end()
    }
  }, 180_000)
})
