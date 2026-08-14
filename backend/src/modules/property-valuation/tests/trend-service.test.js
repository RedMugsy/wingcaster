import { describe, it, expect } from 'vitest'
import { createTrendService } from '../application/trend-service.js'

const logger = { error: () => {}, warn: () => {}, debug: () => {}, info: () => {}, child: () => logger }

function createDal(initial = []) {
  const snapshots = [...initial]
  return {
    findOne: (collection, filter) => Promise.resolve(collection === 'price_trend_snapshots' ? snapshots.find(filter) || null : null),
    findAll: (collection, filter) => Promise.resolve(collection === 'price_trend_snapshots' ? snapshots.filter(filter) : []),
    insert: (_collection, item) => { snapshots.push(item); return Promise.resolve(item) },
    update: (_collection, filter, updater) => {
      const index = snapshots.findIndex(filter)
      if (index >= 0) snapshots[index] = updater(snapshots[index])
      return Promise.resolve(index >= 0 ? 1 : 0)
    },
  }
}

describe('Trend Service', () => {
  it('uses Q4 of the previous year when calculating a Q1 change', async () => {
    const dal = createDal([
      { id: 'previous', area_id: 'area-1', property_type: 'villa', year: 2025, quarter: 4, median_price: 100 },
      { id: 'future', area_id: 'area-1', property_type: 'villa', year: 2026, quarter: 4, median_price: 200 },
    ])
    const service = createTrendService({
      dal,
      adapter: {
        getAreaById: () => Promise.resolve({ id: 'area-1', name: 'Batroun' }),
        getProperties: () => Promise.resolve([
          { id: 'p1', status: 'active', property_type: 'villa', city: 'Batroun', price: 300, currency: 'USD', area: 1, created_at: '2026-01-01T00:00:00.000Z' },
        ]),
      },
      currencyService: { normalizeToUsd: (amount) => Promise.resolve({ amount }) },
      config: { baseCurrency: 'USD' },
      logger,
    })

    const snapshot = await service.snapshotArea('area-1', 'villa', 2026, 1)
    expect(snapshot.change_from_prev_quarter_percent).toBe(200)
    expect(snapshot.trend_direction).toBe('rising')
    expect(snapshot.confidence).toBe('low')
  })
})
