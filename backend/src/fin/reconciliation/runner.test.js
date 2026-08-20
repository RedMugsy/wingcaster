import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commandEnv, insertLedgerTx, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { fundPurchase } from '../ledger/transactions.js'
import { CHECKS } from './checks.js'
import { runReconciliation } from './runner.js'

finPostgresSuite('reconciliation runner', {}, ({ pool, world }) => {
  it('inserts R001–R023, R030–R039, R040–R049; R042-R044/R049/R053 ERROR (R023 is GREEN after Stage 8)', async () => {
    const run = await runReconciliation(pool(), { now: NOW })
    expect(run.skipped).toBe(false)
    expect(run.results).toHaveLength(CHECKS.length)
    expect(CHECKS.map((c) => c.check_code)).toEqual(run.results.map((r) => r.check_code))
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    const errorCodes = new Set(['R042', 'R043', 'R044', 'R049', 'R053'])
    for (const check of CHECKS.filter((c) => !errorCodes.has(c.check_code))) {
      expect(byCode[check.check_code].result, check.check_code).toBe('GREEN')
    }
    expect(byCode.R022.result).toBe('GREEN')
    for (const code of errorCodes) {
      expect(byCode[code].result, code).toBe('ERROR')
    }
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

  it('R006 is GREEN after fundPurchase (remaining = granted, no issue allocation)', async () => {
    await fundPurchase({
      ...commandEnv(world()),
      purchaseIntentId: randomUUID(),
      paidUnits: 15,
      bonusUnits: 0,
      considerationMinor: 1,
    })
    const run = await runReconciliation(pool(), { now: NOW })
    expect(run.results.find((r) => r.check_code === 'R006').result).toBe('GREEN')
  })

  it('R006 DRIFT when a draw allocation is applied without updating remaining', async () => {
    const funded = await fundPurchase({
      ...commandEnv(world()),
      purchaseIntentId: randomUUID(),
      paidUnits: 15,
      bonusUnits: 0,
      considerationMinor: 1,
    })
    const posting = await pool().query(
      `SELECT p.id
         FROM fin.ledger_postings p
         JOIN fin.ledger_accounts a ON a.id = p.account_id
        WHERE p.lot_id = $1 AND a.account_type = 'AVAILABLE'`,
      [funded.lotIds[0]],
    )
    await pool().query('ALTER TABLE fin.lot_allocations DISABLE TRIGGER trg_lot_allocations_apply')
    await pool().query(
      `INSERT INTO fin.lot_allocations (
         id, environment, lot_id, posting_id, units, created_at
       ) VALUES ($1, 'LIVE', $2, $3, -5, $4)`,
      [randomUUID(), funded.lotIds[0], posting.rows[0].id, NOW],
    )
    await pool().query('ALTER TABLE fin.lot_allocations ENABLE TRIGGER trg_lot_allocations_apply')
    const run = await runReconciliation(pool(), { now: NOW })
    expect(run.results.find((r) => r.check_code === 'R006').result).toBe('DRIFT')
  })
})
