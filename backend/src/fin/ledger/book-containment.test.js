import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commandEnv, seedBook, seedExtraBillingAccount } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { transferCredits } from './transactions.js'

finPostgresSuite('book-containment C02', {}, ({ pool, world }) => {
  it('C02 — command postings stay inside their tx book, including CLEARING', async () => {
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
    const result = await transferCredits({
      ...env,
      sourceBookId: w.tenantA.bookUsd.bookId,
      destBookId: book2.bookId,
      units: 25,
    })
    expect(result.pairId).toBeTruthy()
    expect(result.txIds).toHaveLength(2)

    const crossed = await pool().query(`
      SELECT p.id
        FROM fin.ledger_postings p
        JOIN fin.ledger_transactions t ON t.id = p.transaction_id
        JOIN fin.ledger_accounts a ON a.id = p.account_id
       WHERE p.book_id <> t.book_id OR a.book_id <> p.book_id
    `)
    expect(crossed.rowCount).toBe(0)

    const clearing = await pool().query(`
      SELECT p.book_id, t.book_id AS tx_book, a.account_type
        FROM fin.ledger_postings p
        JOIN fin.ledger_transactions t ON t.id = p.transaction_id
        JOIN fin.ledger_accounts a ON a.id = p.account_id
       WHERE t.id = ANY($1::uuid[]) AND a.account_type = 'CLEARING'
    `, [result.txIds])
    expect(clearing.rowCount).toBe(2)
    for (const row of clearing.rows) {
      expect(row.book_id).toBe(row.tx_book)
    }
  })
})
