import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { asRole, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('112_fin_meters', {}, ({ pool, world }) => {
  it('rejects overlapping meter_versions (DL-023 gist exclude)', async () => {
    const meterId = randomUUID()
    await pool().query(
      `INSERT INTO fin.meters (id, environment, code, name, created_at, updated_at)
       VALUES ($1, 'LIVE', 'overlap.meter', 'Overlap', $2, $2)`,
      [meterId, NOW],
    )
    await pool().query(
      `INSERT INTO fin.meter_versions (
         id, meter_id, environment, version_n, aggregation_type, filter_definition,
         effective_from, effective_to
       ) VALUES ($1, $2, 'LIVE', 1, 'SUM', '{}'::jsonb, $3, $4)`,
      [randomUUID(), meterId, NOW, '2026-12-01T00:00:00.000Z'],
    )
    await expect(pool().query(
      `INSERT INTO fin.meter_versions (
         id, meter_id, environment, version_n, aggregation_type, filter_definition,
         effective_from
       ) VALUES ($1, $2, 'LIVE', 2, 'SUM', '{}'::jsonb, $3)`,
      [randomUUID(), meterId, '2026-09-01T00:00:00.000Z'],
    )).rejects.toMatchObject({ code: '23P01' })
  })

  it('APPEND_ONLY — fin_app_role cannot UPDATE meter_versions', async () => {
    const meterId = randomUUID()
    const versionId = randomUUID()
    await pool().query(
      `INSERT INTO fin.meters (id, environment, code, name, created_at, updated_at)
       VALUES ($1, 'LIVE', 'append.meter', 'Append', $2, $2)`,
      [meterId, NOW],
    )
    await pool().query(
      `INSERT INTO fin.meter_versions (
         id, meter_id, environment, version_n, aggregation_type, filter_definition,
         effective_from
       ) VALUES ($1, $2, 'LIVE', 1, 'COUNT', '{}'::jsonb, $3)`,
      [versionId, meterId, NOW],
    )
    const client = await pool().connect()
    try {
      await expect(asRole(client, 'fin_app_role', {
        'fin.environment': 'LIVE',
        'fin.tenant_id': world().tenantA.tenantId,
      }, (c) => c.query(
        `UPDATE fin.meter_versions SET version_n = 9 WHERE id = $1`,
        [versionId],
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)
    } finally {
      client.release()
    }
  })
})
