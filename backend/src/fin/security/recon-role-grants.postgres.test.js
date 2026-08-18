import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { asRole, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('recon-role-grants H10', {}, ({ pool, world }) => {
  it('H10 — fin_recon_role can INSERT checks; cannot INSERT ledger_postings', async () => {
    const runId = randomUUID()
    await pool().query(
      `INSERT INTO fin.reconciliation_runs (
         id, environment, started_at, scope, status, schedule_kind,
         advisory_lock_key, created_at, updated_at
       ) VALUES ($1, 'LIVE', $2, 'platform', 'RUNNING', 'ON_DEMAND',
                 'fin.recon.R001.LIVE.platform', $2, $2)`,
      [runId, NOW],
    )

    const client = await pool().connect()
    try {
      await asRole(client, 'fin_recon_role', { 'fin.environment': 'LIVE' }, (c) => c.query(
        `INSERT INTO fin.reconciliation_checks (
           id, run_id, environment, check_code, severity, result,
           expected_delta_units, advisory_lock_key, created_at
         ) VALUES ($1, $2, 'LIVE', 'R001', 'HIGH', 'GREEN', 0, 'R001.LIVE', $3)`,
        [randomUUID(), runId, NOW],
      ))

      await expect(asRole(client, 'fin_recon_role', { 'fin.environment': 'LIVE' }, (c) => c.query(
        `INSERT INTO fin.ledger_postings (
           id, environment, transaction_id, book_id, account_id, amount_units, created_at
         ) VALUES ($1, 'LIVE', $2, $3, $4, 1, $5)`,
        [
          randomUUID(), randomUUID(), world().tenantA.bookUsd.bookId,
          world().tenantA.bookUsd.accounts.AVAILABLE, NOW,
        ],
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)
    } finally {
      client.release()
    }
  })
})
