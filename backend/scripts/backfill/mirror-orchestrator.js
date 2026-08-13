/**
 * Mirror orchestrator.
 *
 * When Postgres is the primary, every mutating DAL operation is mirrored to
 * SQLite so the local file remains a hot standby. Mirror failures are logged
 * and reported but do not fail the primary request.
 */

import { dbConfig } from './config.js'
import * as sqliteAdapter from './sqlite-adapter.js'
import { logMirrorRetry } from './metrics.js'

const MAX_MIRROR_ATTEMPTS = 3
const MIRROR_RETRY_DELAYS_MS = [100, 500, 2000]

export function createMirrorMutation({ operation, collection, id, payload, correlationId }) {
  return {
    operation,
    collection,
    id,
    payload,
    correlationId,
    attemptedAt: new Date().toISOString(),
  }
}

export function buildInsertMirror({ collection, item, correlationId }) {
  return createMirrorMutation({
    operation: 'insert',
    collection,
    id: item.id,
    payload: item,
    correlationId,
  })
}

export function buildUpdateMirror({ collection, items, correlationId }) {
  return createMirrorMutation({
    operation: 'update',
    collection,
    id: null,
    payload: items,
    correlationId,
  })
}

export function buildRemoveMirror({ collection, ids, correlationId }) {
  return createMirrorMutation({
    operation: 'remove',
    collection,
    id: null,
    payload: ids,
    correlationId,
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function mirrorMutation(mutation, { attempt = 1 } = {}) {
  if (dbConfig.primary !== 'postgres') {
    return { ok: true, skipped: true, reason: 'postgres_not_primary' }
  }
  if (!dbConfig.mirrorSqlite) {
    return { ok: true, skipped: true, reason: 'mirror_disabled' }
  }

  try {
    await applyMutationToSQLite(mutation)
    return { ok: true }
  } catch (err) {
    if (attempt < MAX_MIRROR_ATTEMPTS) {
      const delay = MIRROR_RETRY_DELAYS_MS[attempt - 1] || 2000
      logMirrorRetry({
        operation: mutation.operation,
        collection: mutation.collection,
        id: mutation.id,
        attempt,
        error: err.message || String(err),
        correlationId: mutation.correlationId,
      })
      await sleep(delay)
      return mirrorMutation(mutation, { attempt: attempt + 1 })
    }

    return { ok: false, error: err.message || String(err) }
  }
}

async function applyMutationToSQLite(mutation) {
  switch (mutation.operation) {
    case 'insert':
      sqliteAdapter.insert(mutation.collection, mutation.payload)
      break
    case 'update': {
      const items = Array.isArray(mutation.payload) ? mutation.payload : []
      for (const item of items) {
        if (!item || !item.id) continue
        sqliteAdapter.update(
          mutation.collection,
          (row) => row.id === item.id,
          () => item,
        )
      }
      break
    }
    case 'remove': {
      const ids = Array.isArray(mutation.payload) ? mutation.payload : []
      if (ids.length === 0) break
      sqliteAdapter.remove(mutation.collection, (row) => ids.includes(row.id))
      break
    }
    default:
      throw new Error(`Unknown mirror operation: ${mutation.operation}`)
  }
}
