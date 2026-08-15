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

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`
}

function scopeMigration(sql, schemaMap) {
  if (!schemaMap) return sql
  return Object.entries(schemaMap).reduce(
    (scoped, [source, target]) => scoped
      .replaceAll(`${source}.`, `${quoteIdentifier(target)}.`)
      .replaceAll(`'${source}'`, `'${target}'`)
      .replace(
        new RegExp(`(CREATE\\s+SCHEMA\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)${source}\\b`, 'gi'),
        `$1${quoteIdentifier(target)}`,
      )
      .replace(new RegExp(`(SET\\s+SCHEMA\\s+)${source}\\b`, 'gi'), `$1${quoteIdentifier(target)}`),
    sql,
  )
}

export async function runMigrations(options = {}) {
  const pool = options.pool || getPool()
  const schemaMap = options.schemaMap || null
  const migrationsSchema = schemaMap?.public || 'public'
  const migrationsTable = `${quoteIdentifier(migrationsSchema)}.schema_migrations`

  // Ensure migrations table exists outside a transaction so concurrent workers
  // do not abort a shared transaction on a duplicate-key race.
  {
    const client = await pool.connect()
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${migrationsTable} (
          filename TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `)
    } finally {
      client.release()
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Serialize concurrent migration runs across all workers/services.
    await client.query('SELECT pg_advisory_xact_lock(123456789)')
    const { rows } = await client.query(`SELECT filename FROM ${migrationsTable}`)
    const applied = new Set(rows.map((row) => row.filename))

    const files = (await readdir(__dirname))
      .filter((f) => extname(f).toLowerCase() === '.sql')
      .sort(migrationSort)

    for (const file of files) {
      if (applied.has(file)) continue
      const sql = scopeMigration(await readFile(join(__dirname, file), 'utf-8'), schemaMap)
      await client.query(sql)
      await client.query(`INSERT INTO ${migrationsTable} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`, [file])
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
