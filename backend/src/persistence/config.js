/**
 * Postgres-only configuration.
 *
 * SQLite primary and mirror modes are removed from the runtime. This module
 * keeps configuration lazy and environment-aware so tests and non-database
 * startup paths can initialize without crashing, while still failing clearly
 * when a database connection is actually required.
 */

import logger from '../lib/logger.js'

function readBoolean(key, defaultValue = false) {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return defaultValue
  return raw === 'true'
}

function readString(key, defaultValue = '') {
  return process.env[key] || defaultValue
}

export const dbConfig = {
  primary: 'postgres',
  databaseUrl: readString('DATABASE_URL'),
  logQueries: readBoolean('DB_LOG_QUERIES', false),
  // Deprecated flags kept for back-compat parsing only; they are ignored.
  mirrorSqlite: false,
  consistencyMode: 'warn',
  reconcileOnStart: false,
}

export function setDatabaseUrl(databaseUrl) {
  const normalized = databaseUrl || ''
  dbConfig.databaseUrl = normalized
  if (normalized) {
    process.env.DATABASE_URL = normalized
  } else {
    delete process.env.DATABASE_URL
  }
  return normalized
}

export function resolveDatabaseUrl(options = {}) {
  const { throwOnMissing = false } = options
  const configured = process.env.DATABASE_URL || dbConfig.databaseUrl || ''

  if (!configured && throwOnMissing) {
    throw new Error('DATABASE_URL is required; Postgres is the sole database.')
  }

  return configured
}

export function validateDatabaseUrl() {
  return resolveDatabaseUrl({ throwOnMissing: true })
}

logger.info(
  {
    db_primary: dbConfig.primary,
    db_log_queries: dbConfig.logQueries,
    has_database_url: Boolean(dbConfig.databaseUrl),
  },
  'persistence config loaded',
)

export default dbConfig
