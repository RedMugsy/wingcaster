/**
 * SQLite adapter — extracted from the original `backend/src/db.js`.
 *
 * Implements the persistence DAL contract using `better-sqlite3`.
 * All data is stored as JSON in a generic document table (`collections`).
 */

import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import dbConfig from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const defaultDataDir = join(__dirname, '../../data')

let _dbPath = dbConfig.sqlitePath || join(defaultDataDir, 'db.sqlite')
let _db = null

export function configure(options = {}) {
  if (options.path) {
    _dbPath = options.path
  }
  if (_db) {
    _db.close()
    _db = null
  }
}

function ensureDataDir() {
  const dataDir = dirname(_dbPath)
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
}

function getConnectionInternal() {
  if (!_db) {
    ensureDataDir()
    _db = new Database(_dbPath)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
  }
  return _db
}

export function getConnection() {
  return getConnectionInternal()
}

export function loadDb() {
  const db = getConnectionInternal()
  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_collections_collection ON collections(collection);
    CREATE INDEX IF NOT EXISTS idx_collections_collection_created_at ON collections(collection, created_at);
    CREATE INDEX IF NOT EXISTS idx_collections_collection_updated_at ON collections(collection, updated_at);
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)
  return db
}

export function closeDb() {
  if (_db) {
    _db.close()
    _db = null
  }
}

export function listCollections() {
  loadDb()
  const rows = getConnectionInternal()
    .prepare('SELECT DISTINCT collection FROM collections')
    .all()
  return rows.map((row) => row.collection)
}

export function getDb() {
  loadDb()
  return new Proxy(
    {},
    {
      get(_target, collection) {
        if (typeof collection !== 'string') return undefined
        return findAll(collection)
      },
    },
  )
}

export function findAll(collection, filter) {
  loadDb()
  const rows = getConnectionInternal()
    .prepare('SELECT data FROM collections WHERE collection = ?')
    .all(collection)
  const items = rows.map((row) => JSON.parse(row.data))
  return filter ? items.filter(filter) : items
}

export function findOne(collection, filter) {
  return findAll(collection, filter)[0]
}

export function insert(collection, item) {
  loadDb()
  const id = item.id || item._id || randomUUID()
  const now = new Date().toISOString()
  const data = JSON.stringify({ ...item, id })
  getConnectionInternal()
    .prepare(
      'INSERT OR REPLACE INTO collections (collection, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(collection, id, data, item.created_at || now, now)
  return { ...item, id }
}

export function remove(collection, filter) {
  loadDb()
  const items = findAll(collection, filter)
  if (!items.length) return 0
  const ids = items.map((item) => item.id)
  const deleteStmt = getConnectionInternal().prepare('DELETE FROM collections WHERE collection = ? AND id = ?')
  const deleteMany = getConnectionInternal().transaction((rows) => {
    for (const id of rows) deleteStmt.run(collection, id)
  })
  deleteMany(ids)
  return ids.length
}

export function update(collection, filter, updater) {
  loadDb()
  const items = findAll(collection, filter)
  if (!items.length) return 0
  const now = new Date().toISOString()
  const selectStmt = getConnectionInternal().prepare('SELECT data FROM collections WHERE collection = ? AND id = ?')
  const updateStmt = getConnectionInternal().prepare(
    'UPDATE collections SET data = ?, updated_at = ? WHERE collection = ? AND id = ?',
  )
  const updateMany = getConnectionInternal().transaction((rows) => {
    for (const item of rows) {
      const updated = updater(item)
      if (!updated || typeof updated !== 'object') continue
      const id = updated.id || item.id
      const existing = selectStmt.get(collection, id)
      const created_at = existing ? JSON.parse(existing.data).created_at : updated.created_at || now
      updateStmt.run(JSON.stringify({ ...updated, id }), now, collection, id)
    }
  })
  updateMany(items)
  return items.length
}

export function transaction(work) {
  loadDb()
  const run = getConnection().transaction(() => work())
  return run()
}
