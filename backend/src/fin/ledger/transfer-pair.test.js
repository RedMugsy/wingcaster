import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { insertBalancedPostings, insertLedgerTx } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('transfer-pair D-T3', {}, ({ pool, world }) => {
  it('D-T3a — pair_id on FUNDING is rejected', async () => {
    const { tenantA } = world()
    await expect(insertLedgerTx(pool(), {
      environment: 'LIVE',
      bookId: tenantA.bookUsd.bookId,
      shape: 'FUNDING',
      pairId: randomUUID(),
      economicSourceId: randomUUID(),
    })).rejects.toMatchObject({ code: '23514' })
  })

  it('D-T3b — two TRANSFER rows with the same pair_id + book_id fail unique', async () => {
    const { tenantA } = world()
    const pairId = randomUUID()
    const source = randomUUID()
    const client = await pool().connect()
    try {
      await client.query('BEGIN')
      await insertLedgerTx(client, {
        environment: 'LIVE',
        bookId: tenantA.bookUsd.bookId,
        shape: 'TRANSFER',
        pairId,
        economicSourceId: source,
      })
      await expect(insertLedgerTx(client, {
        environment: 'LIVE',
        bookId: tenantA.bookUsd.bookId,
        shape: 'TRANSFER',
        pairId,
        economicSourceId: randomUUID(),
      })).rejects.toMatchObject({ code: '23505' })
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  })

  it('D-T3c — 3-leg insert in one BEGIN fails at COMMIT', async () => {
    const { tenantA } = world()
    const pairId = randomUUID()
    const source = randomUUID()
    const client = await pool().connect()
    try {
      await client.query('BEGIN')
      for (const book of [tenantA.bookUsd, tenantA.bookEur, tenantA.bookSar]) {
        const txId = await insertLedgerTx(client, {
          environment: 'LIVE',
          bookId: book.bookId,
          shape: 'TRANSFER',
          pairId,
          economicSourceId: source,
        })
        await insertBalancedPostings(client, {
          environment: 'LIVE',
          transactionId: txId,
          bookId: book.bookId,
          accounts: book.accounts,
          debitType: 'AVAILABLE',
          creditType: 'CLEARING',
          units: 100,
        })
      }
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' })
    } finally {
      try { await client.query('ROLLBACK') } catch { /* aborted */ }
      client.release()
    }
  })

  it('D-T3d — 1-leg COMMIT raises', async () => {
    const { tenantA } = world()
    const client = await pool().connect()
    try {
      await client.query('BEGIN')
      const txId = await insertLedgerTx(client, {
        environment: 'LIVE',
        bookId: tenantA.bookUsd.bookId,
        shape: 'TRANSFER',
        pairId: randomUUID(),
        economicSourceId: randomUUID(),
      })
      await insertBalancedPostings(client, {
        environment: 'LIVE',
        transactionId: txId,
        bookId: tenantA.bookUsd.bookId,
        accounts: tenantA.bookUsd.accounts,
        debitType: 'AVAILABLE',
        creditType: 'CLEARING',
        units: 100,
      })
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' })
    } finally {
      try { await client.query('ROLLBACK') } catch { /* aborted */ }
      client.release()
    }
  })

  it('D-T3e — 2-leg two books same currency commits', async () => {
    const { tenantA, platform } = world()
    const { seedBook, seedExtraBillingAccount } = await import('../testing/seed.js')
    const ba = await seedExtraBillingAccount(pool(), {
      environment: 'LIVE',
      tenantId: tenantA.tenantId,
      holderId: tenantA.holderId,
      legalEntityId: platform.legalEntityId,
      currency: 'USD',
    })
    const bookUsd2 = await seedBook(pool(), {
      environment: 'LIVE',
      tenantId: tenantA.tenantId,
      billingAccountId: ba,
      currency: 'USD',
    })

    const pairId = randomUUID()
    const source = randomUUID()
    const client = await pool().connect()
    try {
      await client.query('BEGIN')
      for (const book of [tenantA.bookUsd, bookUsd2]) {
        const txId = await insertLedgerTx(client, {
          environment: 'LIVE',
          bookId: book.bookId,
          shape: 'TRANSFER',
          pairId,
          economicSourceId: source,
        })
        await insertBalancedPostings(client, {
          environment: 'LIVE',
          transactionId: txId,
          bookId: book.bookId,
          accounts: book.accounts,
          debitType: 'AVAILABLE',
          creditType: 'CLEARING',
          units: 100,
        })
      }
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    const rows = await pool().query(
      `SELECT count(*)::int AS n FROM fin.ledger_transactions WHERE pair_id = $1`,
      [pairId],
    )
    expect(rows.rows[0].n).toBe(2)
  })
})
