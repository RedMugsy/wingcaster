import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'

finPostgresSuite('usage_events facts-only schema (F R032 / DL-007)', { seed: false }, ({ pool }) => {
  it('has no price_minor, casts_charged, or rate_card_version columns', async () => {
    const cols = await pool().query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'fin'
          AND table_name = 'usage_events'
          AND column_name IN ('price_minor', 'casts_charged', 'rate_card_version')
        ORDER BY column_name`,
    )
    expect(cols.rows).toEqual([])
  })
})
