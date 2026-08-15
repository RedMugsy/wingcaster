import { describe, expect, it } from 'vitest'
import { closeDb, configure } from '../../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../../testing/postgres.js'
import { createGoogleService } from '../application/google-service.js'

const silentLogger = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }

skipIfNoPostgres()('Google API monthly budget cap', () => {
  it('records cost via snake_case callback and trips the cap once cumulative spend exceeds the budget', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const service = createGoogleService({
          config: {
            googleMapsApiKey: 'test-key',
            googleMapsBudgetUsdMonthly: 1, // $1 cap so we can trip it deterministically
            googleMapsRateLimitPerMinute: 1000,
          },
          logger: silentLogger,
        })

        // Fresh service, fresh test DB — nothing should have been spent yet.
        expect(await service.getMonthlySpend()).toBe(0)
        expect(await service.isOverBudget()).toBe(false)

        // Simulate the google-client's usage callback shape (snake_case).
        // Before the fix, cost_estimate_usd landed as undefined inside the
        // destructure and the row's cost was persisted as null → cap never
        // tripped no matter how many calls fired.
        await service.logUsage({
          operation: '/place/nearbysearch/json',
          endpoint: 'https://maps.googleapis.com/…',
          request_count: 1,
          cost_estimate_usd: 0.60,
          response_status: '200',
        })
        expect(await service.getMonthlySpend()).toBeCloseTo(0.60, 5)
        expect(await service.isOverBudget()).toBe(false)

        // Push past the $1 cap.
        await service.logUsage({
          operation: '/place/nearbysearch/json',
          endpoint: 'https://maps.googleapis.com/…',
          request_count: 1,
          cost_estimate_usd: 0.60,
          response_status: '200',
        })
        expect(await service.getMonthlySpend()).toBeCloseTo(1.20, 5)
        expect(await service.isOverBudget()).toBe(true)

        // fetchPlacesForArea must refuse to hit Google once the cap trips.
        await expect(
          service.fetchPlacesForArea(
            { center_latitude: 33.8938, center_longitude: 35.5018, slug: 'test' },
            { extraction_config: { categories: ['restaurant'] } },
            500,
          ),
        ).rejects.toThrow(/monthly budget cap/i)
      } finally {
        await closeDb()
      }
    })
  })

  it('also accepts camelCase input for backward compatibility', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const service = createGoogleService({
          config: {
            googleMapsApiKey: 'test-key',
            googleMapsBudgetUsdMonthly: 100,
            googleMapsRateLimitPerMinute: 100,
          },
          logger: silentLogger,
        })
        await service.logUsage({
          operation: '/distancematrix/json',
          endpoint: 'https://…',
          requestCount: 3,
          costEstimateUsd: 0.015,
          responseStatus: '200',
        })
        expect(await service.getMonthlySpend()).toBeCloseTo(0.015, 5)
      } finally {
        await closeDb()
      }
    })
  })
})
