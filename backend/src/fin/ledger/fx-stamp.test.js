import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { insertBalancedPostings, insertLedgerTx, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

async function insertSnapshot(client) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO fin.fx_rate_snapshots (
       id, base_currency, quote_currency, rate_bps_num, rate_bps_den,
       source, effective_at, snapshot_kind
     ) VALUES ($1, 'USD', 'EUR', 920000, 1000000, 'TEST', $2, 'TRANSACTION')`,
    [id, NOW],
  )
  return id
}

async function insertPair(client, { bookA, bookB, snapshotA, snapshotB, source }) {
  const pairId = randomUUID()
  const src = source || randomUUID()
  const txA = await insertLedgerTx(client, {
    environment: 'LIVE',
    bookId: bookA.bookId,
    shape: 'TRANSFER',
    pairId,
    fxRateSnapshotId: snapshotA || null,
    economicSourceId: src,
  })
  await insertBalancedPostings(client, {
    environment: 'LIVE',
    transactionId: txA,
    bookId: bookA.bookId,
    accounts: bookA.accounts,
    debitType: 'AVAILABLE',
    creditType: 'CLEARING',
    units: 100,
  })
  const txB = await insertLedgerTx(client, {
    environment: 'LIVE',
    bookId: bookB.bookId,
    shape: 'TRANSFER',
    pairId,
    fxRateSnapshotId: snapshotB || null,
    economicSourceId: src,
  })
  await insertBalancedPostings(client, {
    environment: 'LIVE',
    transactionId: txB,
    bookId: bookB.bookId,
    accounts: bookB.accounts,
    debitType: 'CLEARING',
    creditType: 'AVAILABLE',
    units: 92,
  })
  return pairId
}

finPostgresSuite('fx-stamp D-T4', {}, ({ pool, world }) => {
  it('A §18 #10 / D-T4 — cross-currency pair without snapshot fails COMMIT', async () => {
    const { tenantA } = world()
    const client = await pool().connect()
    try {
      await client.query('BEGIN')
      await insertPair(client, {
        bookA: tenantA.bookUsd,
        bookB: tenantA.bookEur,
      })
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' })
    } finally {
      try { await client.query('ROLLBACK') } catch { /* aborted */ }
      client.release()
    }
  })

  it('D-T4 — same pair with a shared snapshot on both legs commits', async () => {
    const { tenantA } = world()
    const client = await pool().connect()
    let pairId
    try {
      await client.query('BEGIN')
      const snapshotId = await insertSnapshot(client)
      pairId = await insertPair(client, {
        bookA: tenantA.bookUsd,
        bookB: tenantA.bookEur,
        snapshotA: snapshotId,
        snapshotB: snapshotId,
      })
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

  it('D-T4 — same-currency pair without snapshot commits', async () => {
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
    const client = await pool().connect()
    try {
      await client.query('BEGIN')
      await insertPair(client, {
        bookA: tenantA.bookUsd,
        bookB: bookUsd2,
      })
      await client.query('COMMIT')
    } finally {
      client.release()
    }
  })

  it('D-T4 — mismatched snapshots on the two legs raise', async () => {
    const { tenantA } = world()
    const client = await pool().connect()
    try {
      await client.query('BEGIN')
      const a = await insertSnapshot(client)
      const b = randomUUID()
      await client.query(
        `INSERT INTO fin.fx_rate_snapshots (
           id, base_currency, quote_currency, rate_bps_num, rate_bps_den,
           source, effective_at, snapshot_kind
         ) VALUES ($1, 'USD', 'EUR', 910000, 1000000, 'TEST', $2, 'TRANSACTION')`,
        [b, '2026-08-18T13:00:00.000Z'],
      )
      await insertPair(client, {
        bookA: tenantA.bookUsd,
        bookB: tenantA.bookEur,
        snapshotA: a,
        snapshotB: b,
      })
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' })
    } finally {
      try { await client.query('ROLLBACK') } catch { /* aborted */ }
      client.release()
    }
  })
})
