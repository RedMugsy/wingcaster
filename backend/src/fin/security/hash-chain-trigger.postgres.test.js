import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('hash-chain-trigger H5', {}, ({ pool, world }) => {
  it('H5 — stamps row_hash; second prev_hash = first row_hash; genesis is 64-zero; client hashes overwritten', async () => {
    const firstId = randomUUID()
    const secondId = randomUUID()
    await pool().query(
      `INSERT INTO fin.financial_audit_events (
         id, environment, actor_type, actor_email_snapshot, action,
         target_type, target_id, reason_code, prev_hash, row_hash, created_at
       ) VALUES (
         $1, 'LIVE', 'SYSTEM', 'ops@example.test', 'GRANT',
         'TENANT', $3, 'TEST', repeat('a', 64), repeat('b', 64), $4
       )`,
      [firstId, null, world().tenantA.tenantId, NOW],
    )
    await pool().query(
      `INSERT INTO fin.financial_audit_events (
         id, environment, actor_type, actor_email_snapshot, action,
         target_type, target_id, reason_code, prev_hash, row_hash, created_at
       ) VALUES (
         $1, 'LIVE', 'SYSTEM', 'ops@example.test', 'CAPTURE',
         'TENANT', $2, 'TEST', repeat('c', 64), repeat('d', 64), $3
       )`,
      [secondId, world().tenantA.tenantId, '2026-08-18T12:00:01.000Z'],
    )

    const rows = await pool().query(
      `SELECT id, prev_hash, row_hash FROM fin.financial_audit_events
        WHERE id = ANY($1::uuid[]) ORDER BY created_at, id`,
      [[firstId, secondId]],
    )
    expect(rows.rows[0].prev_hash).toBe('0'.repeat(64))
    expect(rows.rows[0].row_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows.rows[0].row_hash).not.toBe('b'.repeat(64))
    expect(rows.rows[1].prev_hash).toBe(rows.rows[0].row_hash)
    expect(rows.rows[1].row_hash).not.toBe('d'.repeat(64))
  })
})
