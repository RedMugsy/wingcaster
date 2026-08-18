export async function lockBooks(client, bookIds) {
  const ids = [...new Set(bookIds.filter(Boolean))].sort()
  if (!ids.length) return
  await client.query(
    `SELECT id FROM fin.ledger_books WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE`,
    [ids],
  )
}

export async function lockAccounts(client, accountIds) {
  const ids = [...new Set(accountIds.filter(Boolean))]
  if (!ids.length) return
  await client.query(
    `SELECT a.id
       FROM fin.ledger_accounts a
      WHERE a.id = ANY($1::uuid[])
      ORDER BY a.book_id ASC, fin.account_type_rank(a.account_type) ASC, a.id ASC
      FOR UPDATE`,
    [ids],
  )
  await client.query(
    `SELECT account_id FROM fin.account_balances
      WHERE account_id = ANY($1::uuid[])
      ORDER BY account_id ASC
      FOR UPDATE`,
    [ids],
  )
}

export async function lockLots(client, lotIds) {
  const ids = [...new Set(lotIds.filter(Boolean))]
  if (!ids.length) return
  await client.query(
    `SELECT id FROM fin.lots
      WHERE id = ANY($1::uuid[])
      ORDER BY holder_id ASC, draw_priority ASC, id ASC
      FOR UPDATE`,
    [ids],
  )
}

export async function lockHolds(client, holdIds) {
  const ids = [...new Set(holdIds.filter(Boolean))]
  if (!ids.length) return
  await client.query(
    `SELECT id FROM fin.holds WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE`,
    [ids],
  )
}
