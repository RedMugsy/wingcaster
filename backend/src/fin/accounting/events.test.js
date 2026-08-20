import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { transaction } from '../../db.js'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { insertAccountingEvent } from './events.js'
import {
  hardClosePeriod, openAccountingPeriod, softClosePeriod,
} from './periods.js'
import { runReconciliation } from '../reconciliation/runner.js'

describe('insertAccountingEvent validation (fast)', () => {
  it('throws before opening a transaction when client is missing', async () => {
    await expect(insertAccountingEvent(null, {
      eventKind: 'DEFERRED_REVENUE_CREATED',
      tenantId: randomUUID(),
      amountMinor: 1,
      currency: 'USD',
      sourceType: 'PURCHASE_INTENT',
      sourceId: randomUUID(),
    })).rejects.toMatchObject({ code: 'REASON_CODE_REQUIRED' })
  })

  it('rejects an unknown event kind before SQL', async () => {
    await expect(insertAccountingEvent({}, {
      eventKind: 'NOT_A_KIND',
      tenantId: randomUUID(),
      amountMinor: 1,
      currency: 'USD',
      sourceType: 'PURCHASE_INTENT',
      sourceId: randomUUID(),
    })).rejects.toMatchObject({ code: 'REASON_CODE_REQUIRED' })
  })
})

finPostgresSuite('accounting events', {}, ({ pool, world }) => {
  async function insertDeferred(eventAt = world().now) {
    return transaction(async (client) => insertAccountingEvent(client, {
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      billingAccountId: world().tenantA.billingAccountId,
      legalEntityId: world().legalEntityId,
      eventKind: 'DEFERRED_REVENUE_CREATED',
      amountMinor: 100,
      currency: 'USD',
      sourceType: 'PURCHASE_INTENT',
      sourceId: randomUUID(),
      now: eventAt,
      eventAt,
      actor: { type: 'SYSTEM' },
    }))
  }

  it('inserts into an OPEN period', async () => {
    const row = await insertDeferred()
    expect(row.id).toBeTruthy()
    expect(row.flaggedSoftClosed).toBe(false)
    const stored = await pool().query(
      `SELECT event_kind, amount_minor FROM fin.accounting_events WHERE id = $1`,
      [row.id],
    )
    expect(stored.rows[0].event_kind).toBe('DEFERRED_REVENUE_CREATED')
    expect(String(stored.rows[0].amount_minor)).toBe('100')
  })

  it('allows insert into a SOFT_CLOSED period (recon fixes) and flags it', async () => {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const opened = await openAccountingPeriod({
      ...env,
      legalEntityId: world().legalEntityId,
      periodKey: '2026-06',
      startsAt: '2026-06-01T00:00:00.000Z',
      endsAt: '2026-07-01T00:00:00.000Z',
    })
    const first = await insertDeferred('2026-06-15T12:00:00.000Z')
    expect(first.flaggedSoftClosed).toBe(false)
    await softClosePeriod({
      ...env,
      periodId: opened.periodId,
      now: world().now,
    })
    const row = await insertDeferred('2026-06-16T12:00:00.000Z')
    expect(row.flaggedSoftClosed).toBe(true)
  })

  it('rejects insert into a HARD_CLOSED period with ACCOUNTING_PERIOD_HARD_CLOSED', async () => {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const opened = await openAccountingPeriod({
      ...env,
      legalEntityId: world().legalEntityId,
      periodKey: '2026-07',
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-08-01T00:00:00.000Z',
    })
    await softClosePeriod({
      ...env,
      periodId: opened.periodId,
      now: world().now,
    })
    await runReconciliation(pool(), { now: env.now })
    await hardClosePeriod({
      ...env,
      periodId: opened.periodId,
      now: world().now,
    })
    await expect(insertDeferred('2026-07-15T12:00:00.000Z'))
      .rejects.toMatchObject({ code: 'ACCOUNTING_PERIOD_HARD_CLOSED' })
  })
})
