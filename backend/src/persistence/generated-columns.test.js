import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, configure, insert, update, findOne, query } from '../db.js'
import { withTestDb, skipIfNoPostgres } from '../testing/postgres.js'

const { Pool } = pg

/**
 * properties.agent_id and properties.territory_id are real foreign keys, so
 * the parent rows have to exist before a property can reference them.
 */
async function seedAgent() {
  const id = randomUUID()
  const email = `gencol-${id}@example.test`
  await query('INSERT INTO users (id, email, name) VALUES ($1, $2, $3)', [id, email, 'Gencol Tester'])
  await query(
    'INSERT INTO agents (id, user_id, email, name, slug) VALUES ($1, $1, $2, $3, $4)',
    [id, email, 'Gencol Tester', `gencol-${id.slice(0, 8)}`],
  )
  return id
}

async function seedTerritory() {
  const id = randomUUID()
  await query(
    'INSERT INTO territories (id, code, name, currency) VALUES ($1, $2, $3, $4)',
    [id, 'LB', 'Lebanon', 'USD'],
  )
  return id
}

skipIfNoPostgres()('properties.geom generated column', () => {
  it('inserts + updates properties without touching the generated geom column', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const id = randomUUID()
        const agentId = await seedAgent()
        const territoryId = await seedTerritory()

        // INSERT — the adapter must strip `geom` from the column list
        // even though the mapper listed it historically.
        const inserted = await insert('properties', {
          id,
          agent_id: agentId,
          title: 'Beirut apartment',
          property_type: 'apartment',
          listing_type: 'sale',
          price: 250000,
          latitude: 33.8938,
          longitude: 35.5018,
          territory_id: territoryId,
        })
        expect(inserted.id).toBe(id)

        // Verify geom was populated by the STORED generated expression.
        const pool = new Pool({ connectionString: databaseUrl })
        try {
          const row = await pool.query(
            "SELECT id, ST_AsText(geom) AS geom_wkt FROM properties WHERE id = $1",
            [id],
          )
          expect(row.rows[0].geom_wkt).toBe('POINT(35.5018 33.8938)')

          // UPDATE lat/lng — geom must recompute automatically.
          await update(
            'properties',
            (p) => p.id === id,
            (p) => ({ ...p, latitude: 25.2048, longitude: 55.2708 }),
          )
          const after = await pool.query(
            "SELECT ST_AsText(geom) AS geom_wkt FROM properties WHERE id = $1",
            [id],
          )
          expect(after.rows[0].geom_wkt).toBe('POINT(55.2708 25.2048)')
        } finally {
          await pool.end()
        }

        // findOne round-trip should still return latitude/longitude fields
        // even though geom is not surfaced.
        const fetched = await findOne('properties', (p) => p.id === id)
        expect(fetched).toMatchObject({ id, latitude: 25.2048, longitude: 55.2708 })
      } finally {
        await closeDb()
      }
    })
  }, 180_000)
})
