import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    exclude: ['src/modules/*/tests/e2e/**'],
    testTimeout: process.env.TEST_DATABASE_URL ? 120_000 : 5_000,
    hookTimeout: process.env.TEST_DATABASE_URL ? 180_000 : 10_000,
    env: {
      // Background workers start on module registration, i.e. as soon as a
      // test imports server.js — and they keep polling on a timer long after
      // the test that started them has finished and withTestDb has dropped its
      // database. Every query then fails with `database "test_..." does not
      // exist`, which fails the run after every test has already passed.
      //
      // Test-env only. These are the same flags production uses to control
      // them, so production behaviour is untouched.
      MARKET_PRICING_WORKER_ENABLED: 'false',
      AREA_INTELLIGENCE_SCORING_WORKER_ENABLED: 'false',
      AREA_INTELLIGENCE_GOOGLE_REFRESH_WORKER_ENABLED: 'false',
      BILLING_SCHEDULER_ENABLED: 'false',
      ...(process.env.TEST_DATABASE_URL ? { PG_CONNECTION_TIMEOUT_MS: '120000' } : {}),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
})
