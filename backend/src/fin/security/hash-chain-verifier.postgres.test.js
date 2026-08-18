import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('hash-chain-verifier H6', {}, ({ pool, world }) => {
  it('H6 — superuser tamper makes the verifier report broken', async () => {
    const firstId = randomUUID()
    const secondId = randomUUID()
    await pool().query(
      `INSERT INTO fin.financial_audit_events (
         id, environment, actor_type, actor_email_snapshot, action,
         target_type, target_id, reason_code, prev_hash, row_hash, created_at
       ) VALUES (
         $1, 'TEST', 'SYSTEM', 'ops@example.test', 'GRANT',
         'TENANT', $2, 'TEST', repeat('0', 64), repeat('0', 64), $3
       )`,
      [firstId, world().tenantA.tenantId, NOW],
    )
    await pool().query(
      `INSERT INTO fin.financial_audit_events (
         id, environment, actor_type, actor_email_snapshot, action,
         target_type, target_id, reason_code, prev_hash, row_hash, created_at
       ) VALUES (
         $1, 'TEST', 'SYSTEM', 'ops@example.test', 'CAPTURE',
         'TENANT', $2, 'TEST', repeat('0', 64), repeat('0', 64), $3
       )`,
      [secondId, world().tenantA.tenantId, '2026-08-18T12:00:01.000Z'],
    )

    const intact = await pool().query(
      `SELECT broken, at_genesis FROM fin.verify_audit_chain($1)`,
      [secondId],
    )
    expect(intact.rows.some((r) => r.at_genesis && !r.broken)).toBe(true)

    await pool().query(
      `UPDATE fin.financial_audit_events SET action = 'tamper' WHERE id = $1`,
      [firstId],
    )
    const broken = await pool().query(
      `SELECT broken, at_genesis FROM fin.verify_audit_chain($1)`,
      [secondId],
    )
    expect(broken.rows.some((r) => r.broken)).toBe(true)
  })
})
