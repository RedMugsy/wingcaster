import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { commandEnv, asRole } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { insertControls } from '../funding/test-support.js'
import {
  cancelDunningCase, cureDunning, openDunningCase,
} from './cases.js'
import { advanceDunning } from './steps.js'
import { runDunningTick } from './worker.js'
import { FIN_DUNNING } from '../foundation/advisory-locks.js'

describe('openDunningCase validation (fast)', () => {
  it('rejects a missing reason before opening a transaction', async () => {
    await expect(openDunningCase({
      invoiceId: randomUUID(),
      billingAccountId: randomUUID(),
      invoiceStatus: 'ISSUED',
      dueAt: '2020-01-01T00:00:00.000Z',
    })).rejects.toMatchObject({ code: 'REASON_CODE_REQUIRED' })
  })
})

finPostgresSuite('dunning cases B §6', {}, ({ pool, world }) => {
  async function seedOpen(nowOffsetMs = -60_000) {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    await insertControls(pool(), {
      subjectType: 'BILLING_ACCOUNT',
      subjectId: world().tenantA.billingAccountId,
    })
    const opened = await openDunningCase({
      ...env,
      invoiceId: randomUUID(),
      billingAccountId: world().tenantA.billingAccountId,
      invoiceStatus: 'ISSUED',
      dueAt: new Date(Date.parse(env.now) - 86_400_000).toISOString(),
      policyDelayMs: 0,
      now: new Date(Date.now() + nowOffsetMs).toISOString(),
    })
    return { env, opened }
  }

  it('snapshots controls at OPEN and restores them on CURED and CANCELED', async () => {
    const { env, opened } = await seedOpen()
    const snap = await pool().query(
      `SELECT controls_snapshot FROM fin.dunning_cases WHERE id = $1`,
      [opened.caseId],
    )
    expect(snap.rows[0].controls_snapshot.allow_purchases).toBe(true)

    await advanceDunning({ ...env, caseId: opened.caseId, now: new Date().toISOString() })
    await advanceDunning({ ...env, caseId: opened.caseId, now: new Date().toISOString(), idempotencyKey: `DUNNING:ADV:${randomUUID()}` })
    await advanceDunning({ ...env, caseId: opened.caseId, now: new Date().toISOString(), idempotencyKey: `DUNNING:ADV:${randomUUID()}` })

    const paused = await pool().query(
      `SELECT allow_purchases FROM fin.account_controls
        WHERE subject_type = 'BILLING_ACCOUNT' AND subject_id = $1`,
      [world().tenantA.billingAccountId],
    )
    expect(paused.rows[0].allow_purchases).toBe(false)

    await cureDunning({ ...env, caseId: opened.caseId, reasonCode: 'AR_CURED' })
    const restored = await pool().query(
      `SELECT allow_purchases FROM fin.account_controls
        WHERE subject_type = 'BILLING_ACCOUNT' AND subject_id = $1`,
      [world().tenantA.billingAccountId],
    )
    expect(restored.rows[0].allow_purchases).toBe(true)

    const other = await seedOpen()
    await cancelDunningCase({ ...other.env, caseId: other.opened.caseId, reasonCode: 'TEST' })
    const canceled = await pool().query(
      `SELECT status FROM fin.dunning_cases WHERE id = $1`,
      [other.opened.caseId],
    )
    expect(canceled.rows[0].status).toBe('CANCELED')
  })
})

finPostgresSuite('dunning steps APPEND_ONLY', {}, ({ pool, world }) => {
  it('UPDATE as fin_app_role is rejected', async () => {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    await insertControls(pool(), {
      subjectType: 'BILLING_ACCOUNT',
      subjectId: world().tenantA.billingAccountId,
    })
    const opened = await openDunningCase({
      ...env,
      invoiceId: randomUUID(),
      billingAccountId: world().tenantA.billingAccountId,
      invoiceStatus: 'ISSUED',
      dueAt: '2020-01-01T00:00:00.000Z',
      policyDelayMs: 0,
    })
    await advanceDunning({ ...env, caseId: opened.caseId, now: new Date().toISOString() })
    const client = await pool().connect()
    try {
      await expect(asRole(client, 'fin_app_role', {
        'fin.environment': 'LIVE',
        'fin.tenant_id': world().tenantA.tenantId,
      }, async (c) => c.query(
        `UPDATE fin.dunning_steps SET outcome = 'TAMPER' WHERE case_id = $1`,
        [opened.caseId],
      ))).rejects.toBeTruthy()
    } finally {
      client.release()
    }
  })
})

finPostgresSuite('dunning worker', {}, ({ pool }) => {
  it('skips the tick when the advisory lock is held', async () => {
    const client = await pool().connect()
    try {
      await client.query('SELECT pg_advisory_lock($1, 0)', [FIN_DUNNING])
      const tick = await runDunningTick({ pool: pool() })
      expect(tick.skipped).toBe(true)
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, 0)', [FIN_DUNNING])
      client.release()
    }
  })
})
