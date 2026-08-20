import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { commandEnv, insertApproval } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runReconciliation } from '../reconciliation/runner.js'
import {
  hardClosePeriod, openAccountingPeriod, reopenPeriod, softClosePeriod,
} from './periods.js'

describe('accounting period validation (fast)', () => {
  it('rejects missing reason before opening a transaction', async () => {
    await expect(openAccountingPeriod({
      legalEntityId: randomUUID(),
      periodKey: '2026-01',
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-02-01T00:00:00.000Z',
    })).rejects.toMatchObject({ code: 'REASON_CODE_REQUIRED' })
  })

  it('rejects reopen without an override approval before SQL', async () => {
    await expect(reopenPeriod({
      reasonCode: 'TEST',
      periodId: randomUUID(),
    })).rejects.toMatchObject({ code: 'ACCOUNTING_PERIOD_REOPEN_WITHOUT_APPROVAL' })
  })
})

finPostgresSuite('accounting periods B §550', {}, ({ pool, world }) => {
  it('walks OPEN → SOFT_CLOSED → HARD_CLOSED; reopen requires override', async () => {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const opened = await openAccountingPeriod({
      ...env,
      legalEntityId: world().legalEntityId,
      periodKey: '2026-05',
      startsAt: '2026-05-01T00:00:00.000Z',
      endsAt: '2026-06-01T00:00:00.000Z',
    })
    expect(opened.status).toBe('OPEN')

    await runReconciliation(pool(), { now: env.now })
    await expect(hardClosePeriod({
      ...env,
      periodId: opened.periodId,
      idempotencyKey: `HARD-SKIP:${opened.periodId}`,
    })).rejects.toMatchObject({ code: 'ACCOUNTING_PERIOD_SKIP_TO_HARD' })

    const soft = await softClosePeriod({
      ...env,
      periodId: opened.periodId,
      now: world().now,
    })
    expect(soft.status).toBe('SOFT_CLOSED')

    await runReconciliation(pool(), { now: env.now })
    const hard = await hardClosePeriod({
      ...env,
      periodId: opened.periodId,
      now: world().now,
    })
    expect(hard.status).toBe('HARD_CLOSED')

    await expect(reopenPeriod({
      ...env,
      periodId: opened.periodId,
      idempotencyKey: `REOPEN-NO:${opened.periodId}`,
    })).rejects.toMatchObject({ code: 'ACCOUNTING_PERIOD_REOPEN_WITHOUT_APPROVAL' })

    const approvalId = await insertApproval(pool(), {
      tenantId: world().tenantA.tenantId,
      actionKind: 'RECONCILIATION_OVERRIDE',
      status: 'APPROVED',
    })
    const reopened = await reopenPeriod({
      ...env,
      periodId: opened.periodId,
      approvalRequestId: approvalId,
    })
    expect(reopened.status).toBe('SOFT_CLOSED')
    expect(reopened.reopened).toBe(true)
  })
})
