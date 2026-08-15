import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    exclude: ['src/modules/*/tests/e2e/**'],
    testTimeout: process.env.TEST_DATABASE_URL ? 120_000 : 5_000,
    hookTimeout: process.env.TEST_DATABASE_URL ? 180_000 : 10_000,
    env: process.env.TEST_DATABASE_URL ? { PG_CONNECTION_TIMEOUT_MS: '120000' } : {},
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
})
