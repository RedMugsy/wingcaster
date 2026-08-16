/**
 * Real-Postgres test harness.
 *
 * Every gated test gets its own throwaway DATABASE, created from the server
 * pointed at by TEST_DATABASE_URL and dropped on teardown.
 *
 * ---------------------------------------------------------------------------
 * Why a database and not a schema
 * ---------------------------------------------------------------------------
 *
 * This harness previously isolated runs in scratch SCHEMAS inside one shared
 * database (`test_abc`, `test_abc_commercial`, …) reached via a `search_path`
 * connection option, with migration SQL rewritten on the fly to retarget
 * `public.` / `commercial.` prefixes.
 *
 * That could never work, because the code under test does not go through
 * `search_path`. It names schemas explicitly and always has:
 *
 *   * `table-mapper.js#quotedTable` emits `"public"."x"` / `"commercial"."x"`
 *     for every single DAL read and write; and
 *   * roughly ninety raw SQL statements across ~25 modules hardcode
 *     `commercial.`, `wa_listings.`, `market_pricing.` and friends.
 *
 * So migrations built the tables in the scratch schema and the application
 * then looked in the real `public`/`commercial` schemas, which nothing ever
 * populated — every DB-touching test failed with 42P01. It went unnoticed for
 * the whole of phase 7c because the CI `postgres` job declares `needs: fast`
 * and the fast suite was red, so the gated suite had never actually run.
 *
 * Giving each run a real database means the schemas inside it are genuinely
 * named `public`, `commercial`, `wa_listings`, … so every hardcoded reference
 * resolves correctly with no rewriting, no `search_path` games, and no changes
 * to production code. It also isolates `wa_listings`, which the schema-based
 * approach shared across all concurrent runs.
 */

import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { describe } from 'vitest'
import { runMigrations } from '../persistence/migrations/runner.js'

const { Pool } = pg
let skipNoticePrinted = false

function identifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function databaseName(name) {
  const normalized = String(name || `test_${randomBytes(8).toString('hex')}`)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
  const prefixed = normalized.startsWith('test_') ? normalized : `test_${normalized}`
  // Postgres identifiers are capped at 63 bytes.
  return prefixed.slice(0, 63)
}

function urlForDatabase(databaseUrl, database) {
  const url = new URL(databaseUrl)
  url.pathname = `/${database}`
  // Any search_path pinning from an older configuration would defeat the
  // point of per-database isolation.
  url.searchParams.delete('options')
  return url.toString()
}

export async function verifyPostGIS(pool) {
  try {
    const { rows } = await pool.query('SELECT PostGIS_Version() AS version')
    if (!rows[0]?.version) {
      throw new Error('PostGIS extension not installed on this database')
    }
    return rows[0].version
  } catch (error) {
    if (error.code === '42883') {
      throw new Error('PostGIS extension not installed on this database')
    }
    throw error
  }
}

/**
 * CREATE DATABASE copies template1, which fails if anything else is connected
 * to it at that instant (55006). With parallel vitest workers all creating
 * databases at once that is a live race, so retry briefly rather than failing
 * an unrelated test.
 */
async function createDatabaseWithRetry(adminPool, database, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await adminPool.query(`CREATE DATABASE ${identifier(database)}`)
      return
    } catch (error) {
      const retryable = error.code === '55006' || error.code === '23505' || error.code === '42P04'
      if (!retryable || attempt >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
    }
  }
}

async function dropDatabase(adminPool, database) {
  try {
    // FORCE (PG13+) terminates any connection the application under test left
    // behind, so a leaked pool cannot wedge teardown.
    await adminPool.query(`DROP DATABASE IF EXISTS ${identifier(database)} WITH (FORCE)`)
  } catch (error) {
    if (error.code !== '42601') throw error
    await adminPool.query(`DROP DATABASE IF EXISTS ${identifier(database)}`)
  }
}

export async function createTestDatabase(name) {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for real-Postgres tests')
  }

  const database = databaseName(name)
  const adminPool = new Pool({ connectionString: databaseUrl })

  try {
    await createDatabaseWithRetry(adminPool, database)
  } catch (error) {
    await adminPool.end()
    throw error
  }

  const url = urlForDatabase(databaseUrl, database)
  const migrationPool = new Pool({ connectionString: url })
  // DROP DATABASE ... WITH (FORCE) terminates whatever is still connected,
  // and pg surfaces that as an 'error' on the idle client. Unhandled, it
  // fails the run after every test has already passed.
  migrationPool.on('error', () => {})
  adminPool.on('error', () => {})

  try {
    // The postgis image seeds template1, so a fresh database usually inherits
    // the extension; create it explicitly so the harness also works against a
    // plain server where PostGIS is available but not templated.
    await migrationPool.query('CREATE EXTENSION IF NOT EXISTS postgis')
    await verifyPostGIS(migrationPool)
    // No schemaMap: migrations run verbatim and build real `public`,
    // `commercial`, `wa_listings`, … schemas inside this database.
    await runMigrations({ pool: migrationPool })
  } catch (error) {
    await migrationPool.end().catch(() => {})
    await dropDatabase(adminPool, database).catch(() => {})
    await adminPool.end()
    throw error
  }

  // Nothing needs this pool once the schema exists, and holding it open until
  // teardown just leaves a connection for the FORCE drop to kill.
  await migrationPool.end().catch(() => {})

  let tornDown = false
  return {
    url,
    database,
    async teardown() {
      if (tornDown) return
      tornDown = true
      try {
        await dropDatabase(adminPool, database)
      } finally {
        await adminPool.end()
      }
    },
  }
}

export async function withTestDb(fn) {
  const database = await createTestDatabase()
  try {
    return await fn(database.url, database)
  } finally {
    await database.teardown()
  }
}

export function skipIfNoPostgres() {
  const unavailable = !process.env.TEST_DATABASE_URL
  if (unavailable && !skipNoticePrinted) {
    skipNoticePrinted = true
    console.warn('REQUIRES REAL POSTGRES: TEST_DATABASE_URL not set — suite not run')
  }
  return describe.skipIf(unavailable)
}
