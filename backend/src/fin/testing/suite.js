import pg from 'pg'
import { afterAll, beforeAll } from 'vitest'
import { createTestDatabase, skipIfNoPostgres } from '../../testing/postgres.js'
import { seedWorld } from './seed.js'

/**
 * One throwaway database per file. Migrations run verbatim; optional world seed.
 */
export function finPostgresSuite(name, { seed = true } = {}, define) {
  skipIfNoPostgres()(name, () => {
    let database
    let pool
    let world

    beforeAll(async () => {
      database = await createTestDatabase()
      pool = new pg.Pool({ connectionString: database.url })
      pool.on('error', () => {})
      if (seed) {
        const client = await pool.connect()
        try {
          world = await seedWorld(client)
        } finally {
          client.release()
        }
      }
    }, 180_000)

    afterAll(async () => {
      if (pool) await pool.end().catch(() => {})
      if (database) await database.teardown()
    })

    define({
      pool: () => pool,
      world: () => world,
    })
  })
}
