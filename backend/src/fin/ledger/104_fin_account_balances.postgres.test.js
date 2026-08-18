import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { insertBalancedPostings, insertLedgerTx } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('104_fin_account_balances', {}, ({ pool, world }) => {
  it('posting trigger maintains the account_balances cache', async () => {
    const { tenantA } = world()
    const client = await pool().connect()
    try {
      await client.query('BEGIN')
      const txId = await insertLedgerTx(client, {
        environment: 'LIVE',
        bookId: tenantA.bookUsd.bookId,
        shape: 'GRANT',
        economicSourceId: randomUUID(),
      })
      await insertBalancedPostings(client, {
        environment: 'LIVE',
        transactionId: txId,
        bookId: tenantA.bookUsd.bookId,
        accounts: tenantA.bookUsd.accounts,
        debitType: 'ISSUANCE',
        creditType: 'AVAILABLE',
        units: 5_000_000,
      })
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    const available = await pool().query(
      `SELECT balance_units FROM fin.account_balances WHERE account_id = $1`,
      [tenantA.bookUsd.accounts.AVAILABLE],
    )
    const issuance = await pool().query(
      `SELECT balance_units FROM fin.account_balances WHERE account_id = $1`,
      [tenantA.bookUsd.accounts.ISSUANCE],
    )
    expect(available.rows[0].balance_units).toBe('5000000')
    expect(issuance.rows[0].balance_units).toBe('-5000000')
  })
})
