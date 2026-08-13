import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'backend/src/**/*.{test,spec}.js'],
    hookTimeout: 60000,
    testTimeout: 120000,
    fileParallelism: false,
  },
})
