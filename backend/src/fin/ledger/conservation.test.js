import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commandEnv, insertApproval, seedBook, seedExtraBillingAccount } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import {
  authorizeHold, captureFacility, captureHold, directSpend, directSpendPostpaid,
  expireHold, expireLot, fundPurchase, grantCredits, issueCreditNote, issueDebitNote,
  manualAdjust, migrateLot, reconcileAdjust, refundPurchase, reversePayment,
  transferCredits, voidHold, writeOffInvoice,
} from './transactions.js'

finPostgresSuite('conservation C01', {}, ({ pool, world }) => {
  it('C01 — every §5 command commits postings that sum to 0', async () => {
    const w = world()
    const env = commandEnv(w)
    const ba2 = await seedExtraBillingAccount(pool(), {
      environment: 'LIVE',
      tenantId: w.tenantA.tenantId,
      holderId: w.tenantA.holderId,
      legalEntityId: w.legalEntityId,
      currency: 'USD',
    })
    const book2 = await seedBook(pool(), {
      environment: 'LIVE',
      tenantId: w.tenantA.tenantId,
      billingAccountId: ba2,
      currency: 'USD',
    })

    await fundPurchase({
      ...env, purchaseIntentId: randomUUID(), paidUnits: 500, bonusUnits: 100,
      considerationMinor: 50,
    })
    const h1 = await authorizeHold({ ...env, units: 10, subjectId: randomUUID() })
    await captureHold({ ...env, holdId: h1.holdId })
    const h2 = await authorizeHold({ ...env, units: 8, subjectId: randomUUID() })
    await voidHold({ ...env, holdId: h2.holdId })
    const h3 = await authorizeHold({ ...env, units: 6, subjectId: randomUUID() })
    await expireHold({ ...env, holdId: h3.holdId })
    await directSpend({ ...env, units: 5, ratedUsageId: randomUUID() })
    await directSpendPostpaid({ ...env, units: 3, ratedUsageId: randomUUID() })
    const expireFund = await fundPurchase({
      ...env, purchaseIntentId: randomUUID(), paidUnits: 20, bonusUnits: 0,
      considerationMinor: 1,
    })
    await expireLot({ ...env, lotId: expireFund.lotIds[0] })
    const approvalId = await insertApproval(pool(), { tenantId: w.tenantA.tenantId })
    await grantCredits({ ...env, approvalRequestId: approvalId, units: 15 })
    await transferCredits({
      ...env, sourceBookId: env.bookId, destBookId: book2.bookId, units: 7,
    })
    await refundPurchase({ ...env, purchaseIntentId: randomUUID(), units: 8 })
    await manualAdjust({ ...env, units: 4, direction: 'increase' })
    await reconcileAdjust({ ...env, units: 2, direction: 'decrease' })
    await writeOffInvoice({ ...env, subjectId: randomUUID() })
    const mig = await fundPurchase({
      ...env, purchaseIntentId: randomUUID(), paidUnits: 11, bonusUnits: 0,
      considerationMinor: 1,
    })
    await migrateLot({ ...env, lotId: mig.lotIds[0] })
    await captureFacility({ ...env, units: 6, reservationId: randomUUID() })
    await issueCreditNote({ ...env, subjectId: randomUUID() })
    await issueDebitNote({ ...env, subjectId: randomUUID() })
    await reversePayment({ ...env, subjectId: randomUUID() })

    const sums = await pool().query(`
      SELECT t.id, t.shape, COALESCE(SUM(p.amount_units), 0)::bigint AS s
        FROM fin.ledger_transactions t
        LEFT JOIN fin.ledger_postings p ON p.transaction_id = t.id
       GROUP BY t.id, t.shape
    `)
    expect(sums.rowCount).toBeGreaterThan(0)
    for (const row of sums.rows) {
      expect(Number(row.s), row.shape).toBe(0)
    }
  })

  it('C01 — mid-command failure leaves zero new txs', async () => {
    const before = await pool().query('SELECT count(*)::int AS n FROM fin.ledger_transactions')
    await expect(fundPurchase({
      ...commandEnv(world()),
      purchaseIntentId: randomUUID(),
      paidUnits: 0,
      bonusUnits: 0,
      considerationMinor: 0,
    })).rejects.toMatchObject({ code: '23514' })
    const after = await pool().query('SELECT count(*)::int AS n FROM fin.ledger_transactions')
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })
})
