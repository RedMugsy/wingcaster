import { expect, it } from 'vitest'
import { ACCOUNT_TYPES, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('102_fin_ledger_books_accounts', {}, ({ pool, world }) => {
  it('creates exactly the seven account types per book', async () => {
    const { bookUsd } = world().tenantA
    const rows = await pool().query(
      `SELECT account_type FROM fin.ledger_accounts WHERE book_id = $1 ORDER BY account_type`,
      [bookUsd.bookId],
    )
    expect(rows.rows.map((r) => r.account_type)).toEqual([...ACCOUNT_TYPES].sort())
  })

  it('rejects a duplicate account_type on the same book', async () => {
    const { bookUsd } = world().tenantA
    await expect(pool().query(
      `INSERT INTO fin.ledger_accounts (
         id, environment, book_id, account_type, created_at, updated_at
       ) VALUES (gen_random_uuid(), 'LIVE', $1, 'AVAILABLE', $2, $2)`,
      [bookUsd.bookId, NOW],
    )).rejects.toMatchObject({ code: '23505' })
  })
})
