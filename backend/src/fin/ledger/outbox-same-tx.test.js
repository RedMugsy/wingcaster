import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { fundPurchase } from './transactions.js'

finPostgresSuite('outbox-same-tx C13', {}, ({ world, pool }) => {
  it('C13 — committed FUNDING always has ledger.posted + lot.issued', async () => {
    const env = commandEnv(world())
    const result = await fundPurchase({
      ...env,
      purchaseIntentId: randomUUID(),
      paidUnits: 40,
      bonusUnits: 10,
      considerationMinor: 2,
    })

    const posted = await pool().query(
      `SELECT topic, dedupe_key FROM fin.outbox_events
        WHERE dedupe_key = $1 OR dedupe_key = ANY($2::text[])`,
      [`tx:${result.txId}`, result.lotIds.map((id) => `lot:${id}`)],
    )
    const topics = posted.rows.map((r) => r.topic).sort()
    expect(topics).toEqual(['fin.ledger.posted', 'fin.lot.issued', 'fin.lot.issued'].sort())

    const orphanTxs = await pool().query(`
      SELECT t.id
        FROM fin.ledger_transactions t
       WHERE NOT EXISTS (
         SELECT 1 FROM fin.outbox_events o
          WHERE o.topic = 'fin.ledger.posted' AND o.dedupe_key = 'tx:' || t.id::text
       )
    `)
    expect(orphanTxs.rowCount).toBe(0)
  })
})
