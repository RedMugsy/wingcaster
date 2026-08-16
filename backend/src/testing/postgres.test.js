import pg from 'pg'
import { expect, it } from 'vitest'
import { createTestDatabase, skipIfNoPostgres, verifyPostGIS } from './postgres.js'

const { Pool } = pg

skipIfNoPostgres()('real-Postgres test harness', () => {
  it('provisions an isolated database with migrations + PostGIS, and drops it', async () => {
    const database = await createTestDatabase()
    const pool = new Pool({ connectionString: database.url })

    try {
      const table = await pool.query("SELECT to_regclass('users') AS name")
      const postgisVersion = await verifyPostGIS(pool)
      expect(table.rows[0].name).toBe('users')
      expect(postgisVersion).toBeTruthy()

      // The schemas the application names explicitly must genuinely exist
      // under those names — this is the property the old schema-rewriting
      // harness could not provide, and the reason every gated test failed.
      const schemas = await pool.query(
        `SELECT schema_name FROM information_schema.schemata
         WHERE schema_name = ANY($1::text[]) ORDER BY schema_name`,
        [['area_intelligence', 'commercial', 'market_pricing', 'public', 'wa_listings']],
      )
      expect(schemas.rows.map((r) => r.schema_name)).toEqual([
        'area_intelligence', 'commercial', 'market_pricing', 'public', 'wa_listings',
      ])

      // Spot-check a table in a non-public schema, addressed the way the DAL
      // addresses it.
      const ledger = await pool.query("SELECT to_regclass('commercial.ledger_entries') AS name")
      expect(ledger.rows[0].name).toBe('commercial.ledger_entries')
    } finally {
      await pool.end()
      await database.teardown()
    }

    const verificationPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    try {
      const remaining = await verificationPool.query(
        'SELECT datname FROM pg_database WHERE datname = $1',
        [database.database],
      )
      expect(remaining.rows).toEqual([])
    } finally {
      await verificationPool.end()
    }
  }, 180_000)

  it('isolates concurrent databases from one another', async () => {
    const [first, second] = await Promise.all([createTestDatabase(), createTestDatabase()])
    expect(first.database).not.toBe(second.database)

    const firstPool = new Pool({ connectionString: first.url })
    const secondPool = new Pool({ connectionString: second.url })
    try {
      await firstPool.query(
        "INSERT INTO users (id, email, name, data) VALUES ('iso-1', 'iso-1@example.test', 'Iso', '{}'::jsonb)",
      )
      // A write in one test database must be invisible to another, including
      // in wa_listings, which the previous schema-based harness shared.
      const leaked = await secondPool.query("SELECT id FROM users WHERE id = 'iso-1'")
      expect(leaked.rows).toEqual([])
    } finally {
      await firstPool.end()
      await secondPool.end()
      await Promise.all([first.teardown(), second.teardown()])
    }
  }, 180_000)
})
