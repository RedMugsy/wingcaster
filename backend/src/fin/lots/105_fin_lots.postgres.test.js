import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { insertBalancedPostings, insertLedgerTx, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('105_fin_lots', {}, ({ pool, world }) => {
  it('lot_allocations adjust remaining_units; remaining cannot exceed granted', async () => {
    const { tenantA } = world()
    const lotId = randomUUID()
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
        units: 1_000_000,
      })
      const posting = await client.query(
        `SELECT id FROM fin.ledger_postings
          WHERE transaction_id = $1 AND amount_units > 0`,
        [txId],
      )
      await client.query(
        `INSERT INTO fin.lots (
           id, environment, tenant_id, book_id, billing_account_id, holder_id,
           source_kind, granted_units, remaining_units, consideration_minor,
           currency, draw_priority, status, created_at, updated_at
         ) VALUES ($1, 'LIVE', $2, $3, $4, $5, 'PROMOTIONAL_GRANT',
                   1000000, 1000000, 0, 'USD', 10, 'ACTIVE', $6, $6)`,
        [
          lotId, tenantA.tenantId, tenantA.bookUsd.bookId,
          tenantA.billingAccountId, tenantA.holderId, NOW,
        ],
      )
      await client.query(
        `INSERT INTO fin.lot_allocations (
           id, environment, lot_id, posting_id, units, created_at
         ) VALUES ($1, 'LIVE', $2, $3, -250000, $4)`,
        [randomUUID(), lotId, posting.rows[0].id, NOW],
      )
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    const lot = await pool().query(
      `SELECT remaining_units FROM fin.lots WHERE id = $1`,
      [lotId],
    )
    expect(lot.rows[0].remaining_units).toBe('750000')
  })
})
