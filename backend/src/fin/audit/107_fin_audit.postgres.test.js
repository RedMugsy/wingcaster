import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { insertUser, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('107_fin_audit', {}, ({ pool, world }) => {
  it('A §18 #7 — insert stamps row_hash; deleting the actor leaves the snapshot', async () => {
    const actorUserId = 'u-audit-actor'
    await insertUser(pool(), {
      id: actorUserId,
      email: 'audit-actor@example.test',
      name: 'Audit Actor',
    })
    const id = randomUUID()
    await pool().query(
      `INSERT INTO fin.financial_audit_events (
         id, environment, actor_type, actor_id, actor_email_snapshot, action,
         target_type, target_id, reason_code, prev_hash, row_hash, created_at
       ) VALUES (
         $1, 'LIVE', 'USER', $2, 'audit-actor@example.test', 'GRANT',
         'TENANT', $3, 'TEST', repeat('a', 64), repeat('b', 64), $4
       )`,
      [id, randomUUID(), world().tenantA.tenantId, NOW],
    )
    const row = await pool().query(
      `SELECT prev_hash, row_hash, actor_email_snapshot
         FROM fin.financial_audit_events WHERE id = $1`,
      [id],
    )
    expect(row.rows[0].prev_hash).toBe('0'.repeat(64))
    expect(row.rows[0].row_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.rows[0].row_hash).not.toBe('b'.repeat(64))
    expect(row.rows[0].actor_email_snapshot).toBe('audit-actor@example.test')

    await pool().query('DELETE FROM users WHERE id = $1', [actorUserId])
    const after = await pool().query(
      `SELECT actor_email_snapshot FROM fin.financial_audit_events WHERE id = $1`,
      [id],
    )
    expect(after.rows[0].actor_email_snapshot).toBe('audit-actor@example.test')
  })
})
