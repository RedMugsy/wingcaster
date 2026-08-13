/**
 * Public DAL (Data Access Layer) facade — Postgres-only, async-only.
 *
 * All business code imports from this module (or the backwards-compatible
 * `backend/src/db.js` barrel). Adapter-specific libraries are never exposed.
 */

import * as postgresAdapter from './postgres-adapter.js'
import { dbConfig } from './config.js'
import { createCorrelationId, logWrite, logQuery } from './metrics.js'

function withQueryLog(operation, collection, fn) {
  if (!dbConfig.logQueries) return fn()
  const start = performance.now()
  const correlationId = createCorrelationId()
  const result = fn()
  if (result && typeof result.then === 'function') {
    return result.finally(() => {
      logQuery({ operation, collection, durationMs: Math.round(performance.now() - start), correlationId })
    })
  }
  logQuery({ operation, collection, durationMs: Math.round(performance.now() - start), correlationId })
  return result
}

function finalizeWrite(operation, collection, id, primaryResult, durationMs, correlationId) {
  logWrite({ operation, collection, id, primaryResult, mirrorResult: { skipped: true }, durationMs, correlationId })
}

export function configure(options) {
  return postgresAdapter.configure(options)
}

export function loadDb() {
  return postgresAdapter.loadDb()
}

export function closeDb() {
  return postgresAdapter.closeDb()
}

export function getDb() {
  return postgresAdapter.getDb()
}

export function findAll(collection, filter) {
  return withQueryLog('findAll', collection, () => postgresAdapter.findAll(collection, filter))
}

export function findOne(collection, filter) {
  return withQueryLog('findOne', collection, () => postgresAdapter.findOne(collection, filter))
}

export function insert(collection, item) {
  const start = performance.now()
  const correlationId = createCorrelationId()
  return postgresAdapter.insert(collection, item).then((stored) => {
    finalizeWrite('insert', collection, stored?.id || item?.id, { ok: true, result: stored }, Math.round(performance.now() - start), correlationId)
    return stored
  }).catch((err) => {
    finalizeWrite('insert', collection, item?.id, { ok: false, error: err.message || String(err) }, Math.round(performance.now() - start), correlationId)
    throw err
  })
}

export function update(collection, filter, updater) {
  const start = performance.now()
  const correlationId = createCorrelationId()
  return postgresAdapter.update(collection, filter, updater).then((count) => {
    finalizeWrite('update', collection, null, { ok: true, result: count }, Math.round(performance.now() - start), correlationId)
    return count
  }).catch((err) => {
    finalizeWrite('update', collection, null, { ok: false, error: err.message || String(err) }, Math.round(performance.now() - start), correlationId)
    throw err
  })
}

export function remove(collection, filter) {
  const start = performance.now()
  const correlationId = createCorrelationId()
  return postgresAdapter.remove(collection, filter).then((count) => {
    finalizeWrite('remove', collection, null, { ok: true, result: count }, Math.round(performance.now() - start), correlationId)
    return count
  }).catch((err) => {
    finalizeWrite('remove', collection, null, { ok: false, error: err.message || String(err) }, Math.round(performance.now() - start), correlationId)
    throw err
  })
}

export function query(sql, params) {
  return withQueryLog('query', null, () => postgresAdapter.query(sql, params))
}

export function transaction(work) {
  return withQueryLog('transaction', null, () => postgresAdapter.transaction(work))
}

export const dal = {
  configure,
  loadDb,
  closeDb,
  getDb,
  findAll,
  findOne,
  insert,
  update,
  remove,
  query,
  transaction,
}

export { dbConfig } from './config.js'
