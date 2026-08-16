import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Global environment stays 'node' for the pure-logic test files (helpers,
    // validators, formatters) so they run fast. Component tests that need a
    // DOM opt in via `// @vitest-environment jsdom` at the top of the file —
    // vitest reads that directive per-file and swaps environments.
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'backend/src/**/*.{test,spec}.js'],
    hookTimeout: 60000,
    testTimeout: 120000,
    fileParallelism: false,
    setupFiles: ['./vitest.setup.ts'],
    // Coverage config is defined but off by default. Enable with
    // `npm test -- --coverage`. Thresholds will be tightened as the
    // component-test surface grows.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
})
