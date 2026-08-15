import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, configure, loadDb, query } from '../db.js'
import { skipIfNoPostgres } from '../testing/postgres.js'
import { grantAllowance, quotaBalance, recordConsumption, recordTopup } from './ledger.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const testPrefix = `ledger-race-${randomUUID()}`
const period = '2099-01'
const quotaKey = 'test.units'

function tenant(label) {
  return `${testPrefix}-${label}-${randomUUID()}`
}

async function ledgerRows(tenantId) {
  return query(
    `SELECT id, type, amount
       FROM commercial.ledger_entries
      WHERE tenant_id = $1 AND quota_key = $2 AND billing_period = $3`,
    [tenantId, quotaKey, period],
  )
}

skipIfNoPostgres()('recordConsumption Postgres serialization', () => {
  beforeAll(async () => {
    configure({ databaseUrl: testDatabaseUrl, force: true })
    await loadDb()
  }, 180_000)

  afterAll(async () => {
    await query('DELETE FROM commercial.ledger_entries WHERE tenant_id LIKE $1', [`${testPrefix}%`])
    await closeDb()
  })

  it.each([
    { allowance: 10, amount: 3, withinAllowance: 3, overage: 0 },
    { allowance: 10, amount: 15, withinAllowance: 10, overage: 5 },
    { allowance: 0, amount: 5, withinAllowance: 0, overage: 5 },
  ])('classifies allowance=$allowance and consumption=$amount', async ({ allowance, amount, withinAllowance, overage }) => {
    const tenantId = tenant(`single-${allowance}-${amount}`)
    if (allowance) await grantAllowance({ tenantId, billingPeriod: period, quotaKey, amount: allowance })

    const result = await recordConsumption({ tenantId, billingPeriod: period, quotaKey, amount })

    expect(result.withinAllowance).toBe(withinAllowance)
    expect(result.overage).toBe(overage)
    expect(result.entries.reduce((sum, entry) => sum + Math.abs(entry.amount), 0)).toBe(amount)
  })

  it('serializes five racers and releases the transaction lock', async () => {
    const tenantId = tenant('five-racers')
    await grantAllowance({ tenantId, billingPeriod: period, quotaKey, amount: 10 })

    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => recordConsumption({
      tenantId,
      billingPeriod: period,
      quotaKey,
      amount: 3,
      sourceEventId: `race-${index}`,
    })))

    expect(results.reduce((sum, result) => sum + result.withinAllowance, 0)).toBe(10)
    expect(results.reduce((sum, result) => sum + result.overage, 0)).toBe(5)
    expect(results.reduce((sum, result) => sum + result.entries.reduce((entrySum, entry) => entrySum + Math.abs(entry.amount), 0), 0)).toBe(15)

    const returnedIds = results.flatMap((result) => result.entries.map((entry) => entry.id))
    const storedRows = await ledgerRows(tenantId)
    expect(new Set(returnedIds).size).toBe(returnedIds.length)
    expect(storedRows.filter((row) => row.type === 'consumption' || row.type === 'overage')).toHaveLength(returnedIds.length)

    await expect(recordConsumption({ tenantId, billingPeriod: period, quotaKey, amount: 1 })).resolves.toMatchObject({
      withinAllowance: 0,
      overage: 1,
    })
  })

  it('preserves the SUM invariant across 100 concurrent random operations', async () => {
    const tenantId = tenant('hundred-racers')
    const allowance = 175
    const topups = 75
    const amounts = Array.from({ length: 100 }, () => 1 + Math.floor(Math.random() * 5))
    await grantAllowance({ tenantId, billingPeriod: period, quotaKey, amount: allowance })
    await recordTopup({ tenantId, billingPeriod: period, quotaKey, amount: topups })

    const results = await Promise.all(amounts.map((amount, index) => recordConsumption({
      tenantId,
      billingPeriod: period,
      quotaKey,
      amount,
      sourceEventId: `random-${index}`,
    })))

    const totalConsumption = amounts.reduce((sum, amount) => sum + amount, 0)
    const classifiedConsumption = results.reduce((sum, result) => sum + result.withinAllowance + result.overage, 0)
    const rows = await ledgerRows(tenantId)
    const debits = rows
      .filter((row) => row.type === 'consumption' || row.type === 'overage')
      .reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0)

    expect(classifiedConsumption).toBe(totalConsumption)
    expect(debits).toBe(totalConsumption)
    expect(await quotaBalance({ tenantId, billingPeriod: period, quotaKey })).toBe(allowance + topups - debits)
  })
})
