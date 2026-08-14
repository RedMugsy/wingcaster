/**
 * Production entrypoint — apply pending migrations, then boot the server.
 *
 * Used by the Docker image CMD and by the `npm start` script. The
 * migration runner is idempotent and acquires a Postgres advisory lock so
 * concurrent workers on a Railway rolling deploy will serialize safely.
 */

import { loadDb } from '../src/db.js'
import { runMigrations } from '../src/persistence/migrations/runner.js'

await loadDb()
await runMigrations()
await import('../src/server.js')
