import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commandEnv, insertLedgerTx, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { fundPurchase } from '../ledger/transactions.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'

finPostgresSuite('reconciliation runner', {}, ({ pool, world }) => {
  it('inserts R001–R023 and marks R022/R023 ERROR when tables are missing', async () => {
    const run = await runReconciliation(pool(), { now: NOW })
    expect(run.skipped).toBe(false)
    expect(run.results).toHaveLength(23)
    expect(CHECKS.map((c) => c.check_code)).toEqual(run.results.map((r) => r.check_code))
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    expect(byCode.R022.result).toBe('ERROR')
    expect(byCode.R023.result).toBe('ERROR')
    const stored = await pool().query(
      `SELECT check_code FROM fin.reconciliation_checks WHERE run_id = $1 ORDER BY check_code`,
      [run.runId],
    )
    expect(stored.rows.map((r) => r.check_code)).toEqual(CHECKS.map((c) => c.check_code))
    const status = await pool().query(
      `SELECT status FROM fin.reconciliation_runs WHERE id = $1`,
      [run.runId],
    )
    expect(status.rows[0].status).toBe('COMPLETED')
  })

  it('R001 DRIFT after conservation trigger bypass', async () => {
    const { tenantA } = world()
    await pool().query('ALTER TABLE fin.ledger_postings DISABLE TRIGGER trg_ledger_postings_conservation')
    const txId = await insertLedgerTx(pool(), {
      environment: 'LIVE',
      bookId: tenantA.bookUsd.bookId,
      shape: 'GRANT',
      economicSourceId: randomUUID(),
    })
    await pool().query(
      `INSERT INTO fin.ledger_postings (
         id, environment, transaction_id, book_id, account_id, amount_units, created_at
       ) VALUES ($1, 'LIVE', $2, $3, $4, 17, $5)`,
      [randomUUID(), txId, tenantA.bookUsd.bookId, tenantA.bookUsd.accounts.AVAILABLE, NOW],
    )
    await pool().query('ALTER TABLE fin.ledger_postings ENABLE TRIGGER trg_ledger_postings_conservation')

    const run = await runReconciliation(pool(), { now: NOW })
    const r001 = run.results.find((r) => r.check_code === 'R001')
    expect(r001.result).toBe('DRIFT')
    const drift = await pool().query(
      `SELECT d.entity_id, r.action
         FROM fin.reconciliation_drift d
         JOIN fin.reconciliation_checks c ON c.id = d.check_id
         JOIN fin.reconciliation_resolution r ON r.drift_id = d.id
        WHERE c.run_id = $1 AND c.check_code = 'R001'`,
      [run.runId],
    )
    expect(drift.rows.some((row) => row.entity_id === txId)).toBe(true)
    expect(drift.rows[0].action).toBe('BLOCK_BILLING_CLOSE')
  })

  it('R004 DRIFT when the balance cache is off by 1', async () => {
    await fundPurchase({
      ...commandEnv(world()),
      purchaseIntentId: randomUUID(),
      paidUnits: 20,
      bonusUnits: 0,
      considerationMinor: 1,
    })
    await pool().query(
      `UPDATE fin.account_balances SET balance_units = balance_units + 1`,
    )
    const run = await runReconciliation(pool(), { now: NOW })
    expect(run.results.find((r) => r.check_code === 'R004').result).toBe('DRIFT')
  })

  it('R006 DRIFT when remaining_units disagrees with allocations', async () => {
    const funded = await fundPurchase({
      ...commandEnv(world()),
      purchaseIntentId: randomUUID(),
      paidUnits: 15,
      bonusUnits: 0,
      considerationMinor: 1,
    })
    await pool().query(
      `UPDATE fin.lots SET remaining_units = remaining_units - 1 WHERE id = $1`,
      [funded.lotIds[0]],
    )
    const run = await runReconciliation(pool(), { now: NOW })
    expect(run.results.find((r) => r.check_code === 'R006').result).toBe('DRIFT')
  })
})
