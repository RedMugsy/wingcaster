/**
 * E2E: properties.geom generated-column persistence (Prompt 14 P0).
 *
 * The generated column caused every insert/update to fail on the ON-CONFLICT
 * UPDATE path (cannot assign a value to a generated column). Fix landed in
 * 8f0202d with generatedColumnsFor() + adapter-level stripping. This test
 * proves the fix survives a real INSERT → geom populated automatically,
 * and a real UPDATE of lat/lng → geom recomputed.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, insert, query, update } from '../db.js'
import { skipIfNoPostgres, withTestDb } from '../testing/postgres.js'

skipIfNoPostgres()('E2E: properties.geom generated column', () => {
  it('insert with lat/lng populates geom; update of lat/lng recomputes geom', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const propertyId = randomUUID()
        const agentId = randomUUID()

        // Beirut, LB
        await insert('properties', {
          id: propertyId,
          agent_id: agentId,
          title: 'E2E geom test property',
          price: 350000,
          currency: 'USD',
          latitude: 33.8938,
          longitude: 35.5018,
          status: 'active',
        })

        const afterInsert = await query(
          `SELECT id,
                  ST_X(geom::geometry) AS lng,
                  ST_Y(geom::geometry) AS lat,
                  ST_SRID(geom::geometry) AS srid
             FROM public.properties
            WHERE id = $1`,
          [propertyId],
        )
        expect(afterInsert).toHaveLength(1)
        expect(Number(afterInsert[0].lng)).toBeCloseTo(35.5018, 4)
        expect(Number(afterInsert[0].lat)).toBeCloseTo(33.8938, 4)
        expect(Number(afterInsert[0].srid)).toBe(4326)

        // Move to Tripoli, LB.
        await update(
          'properties',
          (p) => p.id === propertyId,
          (p) => ({ ...p, latitude: 34.4367, longitude: 35.8497 }),
        )

        const afterUpdate = await query(
          `SELECT ST_X(geom::geometry) AS lng, ST_Y(geom::geometry) AS lat
             FROM public.properties
            WHERE id = $1`,
          [propertyId],
        )
        expect(Number(afterUpdate[0].lng)).toBeCloseTo(35.8497, 4)
        expect(Number(afterUpdate[0].lat)).toBeCloseTo(34.4367, 4)
      } finally {
        await closeDb()
      }
    })
  })

  it('insert without lat/lng leaves geom NULL (no phantom origin point)', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const propertyId = randomUUID()
        await insert('properties', {
          id: propertyId,
          agent_id: randomUUID(),
          title: 'No-geo property',
          price: 100000,
          currency: 'USD',
          status: 'active',
        })
        const rows = await query('SELECT geom FROM public.properties WHERE id = $1', [propertyId])
        expect(rows[0].geom).toBeNull()
      } finally {
        await closeDb()
      }
    })
  })
})
