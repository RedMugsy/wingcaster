import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { insertLedgerTx, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('103_fin_ledger_transactions_postings', {}, ({ pool, world }) => {
  it('A §18 #2 — unbalanced postings fail at COMMIT (I-01)', async () => {
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
      await client.query(
        `INSERT INTO fin.ledger_postings (
           id, environment, transaction_id, book_id, account_id, amount_units, created_at
         ) VALUES ($1, 'LIVE', $2, $3, $4, 100, $5)`,
        [randomUUID(), txId, tenantA.bookUsd.bookId, tenantA.bookUsd.accounts.AVAILABLE, NOW],
      )
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' })
    } finally {
      try { await client.query('ROLLBACK') } catch { /* committed or aborted */ }
      client.release()
    }
  })

  it('A §18 #3 — posting.book_id ≠ tx.book_id is rejected (I-02 / M8)', async () => {
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
      await expect(client.query(
        `INSERT INTO fin.ledger_postings (
           id, environment, transaction_id, book_id, account_id, amount_units, created_at
         ) VALUES ($1, 'LIVE', $2, $3, $4, 100, $5)`,
        [randomUUID(), txId, tenantA.bookEur.bookId, tenantA.bookEur.accounts.CLEARING, NOW],
      )).rejects.toMatchObject({ code: '23514' })
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  })

  it('A §18 #3 — account.book_id ≠ posting.book_id is rejected even for CLEARING', async () => {
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
      await expect(client.query(
        `INSERT INTO fin.ledger_postings (
           id, environment, transaction_id, book_id, account_id, amount_units, created_at
         ) VALUES ($1, 'LIVE', $2, $3, $4, 100, $5)`,
        [
          randomUUID(), txId, tenantA.bookUsd.bookId,
          tenantA.bookEur.accounts.CLEARING, NOW,
        ],
      )).rejects.toMatchObject({ code: '23514' })
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  })
})
