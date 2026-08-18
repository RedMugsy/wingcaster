import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('two-admin H7', {}, ({ pool, world }) => {
  it('H7 — self-approval rejected; one approver cannot APPROVE; two distinct succeed', async () => {
    const requester = randomUUID()
    const approver1 = randomUUID()
    const approver2 = randomUUID()
    const requestId = randomUUID()
    await pool().query(
      `INSERT INTO fin.approval_requests (
         id, environment, tenant_id, action_kind, status, payload_hash,
         created_at, created_by_actor_id, updated_at
       ) VALUES ($1, 'LIVE', $2, 'PLATFORM_ADMIN_RECOVERY', 'REQUESTED', 'x',
                 $3, $4, $3)`,
      [requestId, world().tenantA.tenantId, NOW, requester],
    )

    const mins = await pool().query(
      `SELECT min_distinct_approvers FROM fin.approval_requests WHERE id = $1`,
      [requestId],
    )
    expect(mins.rows[0].min_distinct_approvers).toBe(2)

    await expect(pool().query(
      `INSERT INTO fin.approval_actions (
         id, request_id, actor_id, decision, created_at
       ) VALUES ($1, $2, $3, 'APPROVED', $4)`,
      [randomUUID(), requestId, requester, NOW],
    )).rejects.toMatchObject({ code: '23514' })

    await pool().query(
      `INSERT INTO fin.approval_actions (
         id, request_id, actor_id, decision, created_at
       ) VALUES ($1, $2, $3, 'APPROVED', $4)`,
      [randomUUID(), requestId, approver1, NOW],
    )
    await expect(pool().query(
      `UPDATE fin.approval_requests SET status = 'APPROVED' WHERE id = $1`,
      [requestId],
    )).rejects.toMatchObject({ code: '23514' })

    await pool().query(
      `INSERT INTO fin.approval_actions (
         id, request_id, actor_id, decision, created_at
       ) VALUES ($1, $2, $3, 'APPROVED', $4)`,
      [randomUUID(), requestId, approver2, NOW],
    )
    await pool().query(
      `UPDATE fin.approval_requests SET status = 'APPROVED' WHERE id = $1`,
      [requestId],
    )
    const row = await pool().query(
      `SELECT status FROM fin.approval_requests WHERE id = $1`,
      [requestId],
    )
    expect(row.rows[0].status).toBe('APPROVED')
  })
})
