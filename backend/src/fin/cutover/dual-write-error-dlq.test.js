/**
 * Real-Postgres — dual-write failure lands in DLQ; legacy still commits.
 */
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { transaction } from '../../db.js'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { dualWrite } from './dual-writer.js'

finPostgresSuite('cutover dual-write error DLQ', {}, ({ pool, world }) => {
  it('legacy row commits and fin.cutover_dual_write_errors gets a row', async () => {
    const legacyId = randomUUID()
    const publicTenantId = world().tenantA.publicTenantId

    await transaction(async (client) => {
      await client.query(
        `INSERT INTO commercial.ledger_entries (
           id, tenant_id, billing_period, type, quota_key, amount, metadata, created_at
         ) VALUES ($1, $2, '2026-08', 'adjustment', 'test.dual', 0, '{}'::jsonb, $3)`,
        [legacyId, publicTenantId, NOW],
      )

      const result = await dualWrite({
        client,
        environment: 'LIVE',
        tenantId: publicTenantId,
        finCommand: 'ingestUsageEventWithClient',
        legacy: {
          source: 'commercial.ledger_entries',
          rowId: legacyId,
          payload: { id: legacyId, tenant_id: publicTenantId },
        },
        fin: async () => {
          throw Object.assign(new Error('tenant missing for mirror'), {
            code: 'FIN_MIRROR_CONTEXT_MISSING',
          })
        },
        now: NOW,
      })
      expect(result.ok).toBe(false)
      expect(result.dlqId).toBeTruthy()
    })

    const legacy = await pool().query(
      `SELECT id FROM commercial.ledger_entries WHERE id = $1`,
      [legacyId],
    )
    expect(legacy.rowCount).toBe(1)

    const dlq = await pool().query(
      `SELECT legacy_source, legacy_row_id, error_code, fin_command
         FROM fin.cutover_dual_write_errors
        WHERE legacy_row_id = $1`,
      [legacyId],
    )
    expect(dlq.rowCount).toBe(1)
    expect(dlq.rows[0]).toMatchObject({
      legacy_source: 'commercial.ledger_entries',
      legacy_row_id: legacyId,
      error_code: 'FIN_MIRROR_CONTEXT_MISSING',
      fin_command: 'ingestUsageEventWithClient',
    })
  })
})
