#!/usr/bin/env node
/**
 * SQLite -> Postgres backfill CLI.
 *
 * Usage:
 *   node backend/scripts/backfill-to-postgres.js
 *
 * Environment:
 *   DATABASE_URL          Postgres target (required)
 *   SQLITE_PATH           SQLite source (defaults to backend/data/db.sqlite)
 *   DB_LOG_QUERIES=true   Optional verbose query logging
 *
 * Behavior:
 *   - Reads every collection from SQLite.
 *   - Inserts every record into Postgres `collections` table.
 *   - Skips already-existing records (ON CONFLICT DO NOTHING).
 *   - Prints per-collection and total counts and a verification report.
 */

import 'dotenv/config'
import * as sqliteAdapter from '../src/persistence/sqlite-adapter.js'
import * as postgresAdapter from '../src/persistence/postgres-adapter.js'

const BATCH_SIZE = 500

function nowIso() {
  return new Date().toISOString()
}

async function backfillCollection(collection, items) {
  const client = await postgresAdapter.getPool().connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE)
      const values = []
      const params = []
      let paramIndex = 1
      for (const item of batch) {
        const id = item.id
        const createdAt = item.created_at || nowIso()
        const updatedAt = item.updated_at || nowIso()
        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`)
        params.push(collection, id, JSON.stringify(item), createdAt, updatedAt)
        paramIndex += 5
      }
      const sql = `
        INSERT INTO collections (collection, id, data, created_at, updated_at)
        VALUES ${values.join(', ')}
        ON CONFLICT (collection, id) DO NOTHING
      `
      await client.query(sql, params)
    }
    await client.query('COMMIT')
    return items.length
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function verifyBackfill(collections) {
  const report = []
  let totalSource = 0
  let totalTarget = 0
  for (const { name, items } of collections) {
    const targetRows = await postgresAdapter.findAll(name)
    const sourceCount = items.length
    const targetCount = targetRows.length
    totalSource += sourceCount
    totalTarget += targetCount
    report.push({
      collection: name,
      source: sourceCount,
      target: targetCount,
      match: sourceCount === targetCount,
    })
  }
  return { totalSource, totalTarget, report }
}

async function main() {
  const sqlitePath = process.env.SQLITE_PATH
  if (sqlitePath) {
    sqliteAdapter.configure({ path: sqlitePath })
  }
  sqliteAdapter.loadDb()

  // Ensure Postgres schema exists before backfill.
  await postgresAdapter.loadDb()

  // Discover collections by listing unique collection names in SQLite.
  const collectionNames = sqliteAdapter.listCollections()
  console.log(`Found ${collectionNames.length} collection(s) in SQLite: ${collectionNames.join(', ')}`)

  const collections = collectionNames.map((name) => ({
    name,
    items: sqliteAdapter.findAll(name),
  }))

  for (const { name, items } of collections) {
    if (items.length === 0) {
      console.log(`[skip] ${name}: 0 rows`)
      continue
    }
    const inserted = await backfillCollection(name, items)
    console.log(`[backfill] ${name}: ${inserted} rows`)
  }

  const { totalSource, totalTarget, report } = await verifyBackfill(collections)
  console.log('\nVerification report:')
  for (const row of report) {
    console.log(`  ${row.collection}: source=${row.source} target=${row.target} ${row.match ? 'OK' : 'MISMATCH'}`)
  }
  console.log(`\nTotal: source=${totalSource} target=${totalTarget} ${totalSource === totalTarget ? 'OK' : 'MISMATCH'}`)

  if (totalSource !== totalTarget) {
    process.exit(1)
  }

  await postgresAdapter.closeDb()
  sqliteAdapter.closeDb()
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
