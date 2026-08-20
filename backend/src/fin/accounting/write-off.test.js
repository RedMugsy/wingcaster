import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commandEnv, insertApproval } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { insertControls } from '../funding/test-support.js'
import { openDunningCase } from '../dunning/cases.js'
import { advanceDunning } from '../dunning/steps.js'
import { writeOffInvoice } from '../dunning/write-off-invoice.js'
import { fundPurchase } from '../ledger/transactions.js'

finPostgresSuite('accounting write-off spec §73', {}, ({ pool, world }) => {
  it('WriteOffInvoice writes BAD_DEBT_WRITE_OFF only and does not touch CONSUMED postings', async () => {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    await insertControls(pool(), {
      subjectType: 'BILLING_ACCOUNT',
      subjectId: world().tenantA.billingAccountId,
    })
    const funded = await fundPurchase({
      ...env,
      purchaseIntentId: randomUUID(),
      paidUnits: 40,
      bonusUnits: 0,
      considerationMinor: 40,
    })
    const consumedBefore = await pool().query(
      `SELECT COALESCE(SUM(p.amount_units), 0)::bigint AS qty
         FROM fin.ledger_postings p
         JOIN fin.ledger_accounts a ON a.id = p.account_id
        WHERE a.account_type = 'CONSUMED' AND a.book_id = $1`,
      [world().tenantA.bookUsd.bookId],
    )

    const invoiceId = randomUUID()
    const opened = await openDunningCase({
      ...env,
      invoiceId,
      billingAccountId: world().tenantA.billingAccountId,
      invoiceStatus: 'ISSUED',
      dueAt: '2020-01-01T00:00:00.000Z',
      policyDelayMs: 0,
    })
    let caseId = opened.caseId
    for (let i = 0; i < 6; i += 1) {
      const step = await advanceDunning({
        ...env,
        caseId,
        now: new Date(Date.now() + i * 1000).toISOString(),
        idempotencyKey: `DUNNING:ADV:${caseId}:${i}`,
      })
      caseId = step.caseId
    }
    const status = await pool().query(
      `SELECT status FROM fin.dunning_cases WHERE id = $1`,
      [caseId],
    )
    expect(status.rows[0].status).toBe('WRITE_OFF_REVIEW')

    const approvalId = await insertApproval(pool(), {
      tenantId: world().tenantA.tenantId,
      actionKind: 'WRITE_OFF',
      status: 'APPROVED',
    })
    const written = await writeOffInvoice({
      ...env,
      invoiceId,
      caseId,
      amountMinor: 2500,
      approvalRequestId: approvalId,
      billingAccountId: world().tenantA.billingAccountId,
    })
    expect(written.status).toBe('WRITTEN_OFF')

    const events = await pool().query(
      `SELECT event_kind FROM fin.accounting_events WHERE source_id = $1`,
      [invoiceId],
    )
    expect(events.rows.map((r) => r.event_kind)).toEqual(['BAD_DEBT_WRITE_OFF'])
    expect(events.rows.some((r) => r.event_kind === 'REFUND_REVENUE_REVERSED')).toBe(false)

    const consumedAfter = await pool().query(
      `SELECT COALESCE(SUM(p.amount_units), 0)::bigint AS qty
         FROM fin.ledger_postings p
         JOIN fin.ledger_accounts a ON a.id = p.account_id
        WHERE a.account_type = 'CONSUMED' AND a.book_id = $1`,
      [world().tenantA.bookUsd.bookId],
    )
    expect(String(consumedAfter.rows[0].qty)).toBe(String(consumedBefore.rows[0].qty))

    const lotRemaining = await pool().query(
      `SELECT remaining_units FROM fin.lots WHERE id = $1`,
      [funded.lotIds[0]],
    )
    expect(String(lotRemaining.rows[0].remaining_units)).toBe('40')
  })
})
