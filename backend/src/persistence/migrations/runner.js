/**
 * Ordered SQL migration runner.
 *
 * Reads numbered .sql files from this directory, tracks applied migrations in
 * `schema_migrations`, and runs missing ones inside a Postgres transaction.
 * Safe to call on every startup (idempotent).
 */

import { readdir, readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join, basename, extname } from 'path'
import { getPool } from '../postgres-adapter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function migrationSort(a, b) {
  const na = parseInt(basename(a).match(/^\d+/)?.[0] || '0', 10)
  const nb = parseInt(basename(b).match(/^\d+/)?.[0] || '0', 10)
  return na - nb
}

async function ensureMigrationsTable(client, retries = 3) {
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `)
  } catch (err) {
    // Race: another worker may create the table concurrently. Retry.
    if (retries > 0 && err.code === '23505') {
      await new Promise((r) => setTimeout(r, 50))
      return ensureMigrationsTable(client, retries - 1)
    }
    throw err
  }
}

async function loadApplied(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations')
  return new Set(rows.map((r) => r.filename))
}

export async function runMigrations() {
  const pool = getPool()

  // Ensure migrations table exists outside a transaction so concurrent workers
  // do not abort a shared transaction on a duplicate-key race.
  {
    const client = await pool.connect()
    try {
      await ensureMigrationsTable(client)
    } finally {
      client.release()
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Serialize concurrent migration runs across all workers/services.
    await client.query('SELECT pg_advisory_xact_lock(123456789)')
    const applied = await loadApplied(client)

    const files = (await readdir(__dirname))
      .filter((f) => extname(f).toLowerCase() === '.sql')
      .sort(migrationSort)

    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(join(__dirname, file), 'utf-8')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING', [file])
      console.log(`[migration] applied ${file}`)
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
