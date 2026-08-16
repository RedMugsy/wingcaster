/**
 * Postgres adapter — production DAL implementation.
 *
 * Postgres is the sole primary database. Every DAL operation maps to a real
 * SQL table (or the legacy_collections JSONB fallback) via table-mapper.js.
 */

import pg from 'pg'
import { randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import dbConfig, { resolveDatabaseUrl, setDatabaseUrl } from './config.js'
import { logQuery } from './metrics.js'
import { runMigrations } from './migrations/runner.js'
import {
  resolveTable,
  quotedTable,
  toRow,
  fromRow,
  columnNames,
} from './table-mapper.js'
import { generatedColumnsFor } from './generated-columns.js'

const { Pool } = pg

let _pool = null
let _migrationsRun = false

/**
 * Transactional-context propagation. When code runs inside `transaction(fn)`,
 * every nested `findAll` / `findOne` / `insert` / `update` / `remove` / `query`
 * call MUST use the SAME pg client that owns the BEGIN — otherwise a rollback
 * discards nothing and callers get a "looks atomic but isn't" bug (surfaced
 * in the Phase 7b re-audit). We propagate the client via AsyncLocalStorage
 * so the DAL API surface (which is used by hundreds of call sites) does not
 * have to thread an extra parameter through every function.
 */
const txStorage = new AsyncLocalStorage()

function currentTxClient() {
  return txStorage.getStore()?.client || null
}

export function getPool() {
  if (!_pool) {
    const databaseUrl = resolveDatabaseUrl({ throwOnMissing: true })
    _pool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.PG_SSL === 'false' ? false : undefined,
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10000),
      idleTimeoutMillis: 60000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    })
  }
  return _pool
}

export async function loadDb() {
  if (!_migrationsRun) {
    await runMigrations()
    _migrationsRun = true
  }
}

export async function closeDb() {
  if (_pool) {
    await _pool.end()
    _pool = null
    _migrationsRun = false
  }
}

export async function getDb() {
  await loadDb()
  return new Proxy(
    {},
    {
      get(_target, collection) {
        if (typeof collection !== 'string') return undefined
        return findAll(collection)
      },
    }
  )
}

export function configure(options = {}) {
  if (options.databaseUrl) {
    if (_pool && !options.force) {
      throw new Error('Cannot reconfigure Postgres adapter after pool is initialized')
    }
    if (_pool && options.force) {
      _pool.end().catch(() => {})
      _pool = null
      _migrationsRun = false
    }
    setDatabaseUrl(options.databaseUrl)
  }
}

async function runLogged(operation, collection, sql, params) {
  const start = Date.now()
  const executor = currentTxClient() || getPool()
  try {
    const result = await executor.query(sql, params)
    logQuery({ operation, collection, durationMs: Date.now() - start })
    return result
  } catch (err) {
    logQuery({ operation, collection, durationMs: Date.now() - start })
    throw err
  }
}

function placeholders(start, count) {
  return Array.from({ length: count }, (_, i) => `$${start + i}`).join(', ')
}

function serializeParam(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return value
  if (typeof value === 'object') {
    // PostgreSQL over some proxies/versions cannot accept JS objects directly
    // for JSONB columns outside the public schema. Stringify all objects/arrays
    // and let the column coercion parse them.
    return JSON.stringify(value)
  }
  return value
}

/**
 * Columns every INSERT names regardless of whether the record carries them —
 * the adapter supplies these itself.
 */
const ALWAYS_WRITTEN_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'data', 'collection'])

function isLegacy(mapping) {
  return mapping.table === 'legacy_collections'
}

function rowToItem(collection, row) {
  return fromRow(collection, row)
}

export async function findAll(collection, filter) {
  await loadDb()
  const mapping = resolveTable(collection)
  const table = quotedTable(collection)
  const sql = isLegacy(mapping)
    ? `SELECT * FROM ${table} WHERE "collection" = $1`
    : `SELECT * FROM ${table}`
  const params = isLegacy(mapping) ? [collection] : []
  const { rows } = await runLogged('findAll', collection, sql, params)
  const items = rows.map((row) => rowToItem(collection, row))
  return filter ? items.filter(filter) : items
}

export async function findOne(collection, filter) {
  return (await findAll(collection, filter))[0]
}

export async function insert(collection, item) {
  await loadDb()
  const mapping = resolveTable(collection)
  const table = quotedTable(collection)
  const id = item.id || item._id || randomUUID()
  const now = new Date().toISOString()
  const row = toRow(collection, { ...item, id })
  const createdAt = item.created_at || now
  const updatedAt = now

  const generated = new Set(generatedColumnsFor(mapping.schema, mapping.table))
  const cols = columnNames(collection)
    .filter((c) => !generated.has(c))
    // Only name columns the record actually carries. Naming a column and
    // passing NULL overrides its DEFAULT, so a `NOT NULL DEFAULT false`
    // column (billing_subscriptions.eligible_for_migration,
    // notification_preferences.metadata, …) blew up on every insert whose
    // JS object simply had not set it. `toRow` builds `row` with `pick`, so
    // presence here means the caller genuinely supplied the field — an
    // explicit `null` is still honoured and still writes NULL.
    .filter((c) => ALWAYS_WRITTEN_COLUMNS.has(c) || c in row)
  const vals = cols.map((c) => serializeParam(row[c] ?? (c === 'id' ? id : c === 'created_at' ? createdAt : c === 'updated_at' ? updatedAt : null)))
  const conflictTarget = isLegacy(mapping) ? '(collection, id)' : '(id)'

  const sql = `
    INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')})
    VALUES (${placeholders(1, cols.length)})
    ON CONFLICT ${conflictTarget} DO UPDATE SET
      ${cols.filter((c) => c !== 'id' && c !== 'collection').map((c, i) => `"${c}" = EXCLUDED."${c}"`).join(', ')}
  `

  await runLogged('insert', collection, sql, vals)
  return rowToItem(collection, row)
}

export async function update(collection, filter, updater) {
  await loadDb()
  const mapping = resolveTable(collection)
  const table = quotedTable(collection)
  const items = await findAll(collection, filter)
  if (!items.length) return 0
  const now = new Date().toISOString()

  // If we're inside an outer transaction (transaction(fn)), reuse its client
  // so the writes participate in that transaction's atomicity. Otherwise
  // open our own BEGIN so a multi-row update is still all-or-nothing.
  const ambient = currentTxClient()
  const client = ambient || await getPool().connect()
  const ownsTransaction = !ambient

  let changed = 0
  try {
    if (ownsTransaction) await client.query('BEGIN')
    for (const item of items) {
      const updated = updater(item)
      if (!updated || typeof updated !== 'object') continue
      const id = updated.id || item.id
      const row = toRow(collection, { ...updated, id })
      // Never update id, collection, created_at, or updated_at here.
      // updated_at is appended explicitly as a TIMESTAMPTZ literal.
      // Generated columns are computed by Postgres — assigning them
      // (even NULL) raises "cannot insert a non-DEFAULT value".
      const generated = new Set(generatedColumnsFor(mapping.schema, mapping.table))
      const cols = columnNames(collection)
        .filter((c) => !['id', 'collection', 'created_at', 'updated_at'].includes(c))
        .filter((c) => !generated.has(c))
        // Same rule as insert, and here it also prevents data loss: assigning
        // every mapped column meant a record that had never carried a field
        // wrote NULL over whatever was already in that column.
        .filter((c) => c in row)
      const setClause = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ')
      const vals = cols.map((c) => serializeParam(row[c] ?? null))
      // `data` is always present, so this is defensive — but an empty SET
      // list would be a syntax error rather than a no-op.
      const assignments = setClause ? `${setClause}, ` : ''
      const updatedAtIdx = cols.length + 1
      const pkStartIdx = cols.length + 2
      const pkClause = isLegacy(mapping)
        ? `"collection" = $${pkStartIdx} AND "id" = $${pkStartIdx + 1}`
        : `"id" = $${pkStartIdx}`
      const pkValues = isLegacy(mapping) ? [collection, id] : [id]

      await client.query(
        `UPDATE ${table} SET ${assignments}"updated_at" = $${updatedAtIdx}::timestamptz WHERE ${pkClause}`,
        [...vals, now, ...pkValues]
      )
      changed++
    }
    if (ownsTransaction) await client.query('COMMIT')
  } catch (err) {
    if (ownsTransaction) await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    if (ownsTransaction) client.release()
  }

  return changed
}

export async function remove(collection, filter) {
  await loadDb()
  const mapping = resolveTable(collection)
  const table = quotedTable(collection)
  const items = await findAll(collection, filter)
  if (!items.length) return 0
  const ids = items.map((item) => item.id)

  const pkClause = isLegacy(mapping)
    ? '"collection" = $1 AND "id" = ANY($2::text[])'
    : '"id" = ANY($1::text[])'
  const params = isLegacy(mapping) ? [collection, ids] : [ids]

  await runLogged('remove', collection, `DELETE FROM ${table} WHERE ${pkClause}`, params)
  return ids.length
}

export async function query(sql, params) {
  await loadDb()
  const { rows } = await runLogged('query', null, sql, params)
  return rows
}

export async function transaction(work) {
  await loadDb()
  // Nested transaction(): reuse the ambient client so we don't try to open
  // a second BEGIN on the same connection (Postgres errors). The outer
  // transaction owns the commit/rollback boundary.
  const ambient = currentTxClient()
  if (ambient) return await work(ambient)

  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    // Everything inside `work` — including any nested insert/update/find/
    // query calls that go through this module — runs with `client` as the
    // ALS-scoped executor. This is what makes rollbacks actually roll back.
    const result = await txStorage.run({ client }, () => work(client))
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
