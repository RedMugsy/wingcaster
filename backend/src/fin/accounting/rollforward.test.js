import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { transaction } from '../../db.js'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { insertAccountingEvent } from './events.js'
import { recordCreditLoss } from './credit-loss.js'

finPostgresSuite('accounting roll-forward', {}, ({ pool, world }) => {
  it('deferred + receivable + credit-loss roll-forward (opening + activity = closing)', async () => {
    const intentId = randomUUID()
    const reservationId = randomUUID()
    const invoiceId = randomUUID()
    const env = commandEnv(world())

    await transaction(async (client) => {
      await insertAccountingEvent(client, {
        ...env,
        tenantId: world().tenantA.tenantId,
        billingAccountId: world().tenantA.billingAccountId,
        legalEntityId: world().legalEntityId,
        eventKind: 'DEFERRED_REVENUE_CREATED',
        amountMinor: 1000,
        currency: 'USD',
        sourceType: 'PURCHASE_INTENT',
        sourceId: intentId,
        actor: { type: 'SYSTEM' },
      })
      await insertAccountingEvent(client, {
        ...env,
        tenantId: world().tenantA.tenantId,
        billingAccountId: world().tenantA.billingAccountId,
        legalEntityId: world().legalEntityId,
        eventKind: 'REVENUE_RECOGNIZED',
        amountMinor: 400,
        currency: 'USD',
        sourceType: 'PURCHASE_INTENT',
        sourceId: intentId,
        actor: { type: 'SYSTEM' },
      })
      await insertAccountingEvent(client, {
        ...env,
        tenantId: world().tenantA.tenantId,
        billingAccountId: world().tenantA.billingAccountId,
        legalEntityId: world().legalEntityId,
        eventKind: 'RECEIVABLE_CREATED',
        amountMinor: 700,
        currency: 'USD',
        sourceType: 'FACILITY_RESERVATION',
        sourceId: reservationId,
        actor: { type: 'SYSTEM' },
      })
      await recordCreditLoss(client, {
        invoiceId,
        amountMinor: 200,
        currency: 'USD',
        tenantId: world().tenantA.tenantId,
        billingAccountId: world().tenantA.billingAccountId,
        legalEntityId: world().legalEntityId,
        environment: 'LIVE',
        now: env.now,
        actor: { type: 'SYSTEM' },
      })
    })

    const sums = await pool().query(`
      SELECT
        COALESCE(SUM(amount_minor) FILTER (WHERE event_kind = 'DEFERRED_REVENUE_CREATED'), 0)::bigint AS deferred,
        COALESCE(SUM(amount_minor) FILTER (WHERE event_kind = 'REVENUE_RECOGNIZED'), 0)::bigint AS recognized,
        COALESCE(SUM(amount_minor) FILTER (WHERE event_kind = 'RECEIVABLE_CREATED'), 0)::bigint AS receivable,
        COALESCE(SUM(amount_minor) FILTER (WHERE event_kind = 'BAD_DEBT_WRITE_OFF'), 0)::bigint AS written
      FROM fin.accounting_events
    `)
    const row = sums.rows[0]
    const remainingDeferred = BigInt(row.deferred) - BigInt(row.recognized)
    expect(remainingDeferred).toBe(600n)
    expect(BigInt(row.deferred)).toBe(BigInt(row.recognized) + remainingDeferred)
    const outstandingAr = BigInt(row.receivable) - BigInt(row.written)
    expect(outstandingAr).toBe(500n)
    expect(BigInt(row.receivable)).toBe(BigInt(row.written) + outstandingAr)
  })
})
