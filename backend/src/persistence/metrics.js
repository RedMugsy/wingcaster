/**
 * Structured observability helpers for the persistence layer.
 *
 * All persistence mutations log with a correlation ID so that a primary write
 * and its mirror attempt can be traced across log lines.
 */

import { randomUUID } from 'crypto'
import logger from '../lib/logger.js'

export function createCorrelationId() {
  return randomUUID()
}

export function logWrite({ operation, collection, id, primaryResult, mirrorResult, durationMs, correlationId }) {
  logger.info(
    {
      component: 'persistence',
      event: 'write',
      correlation_id: correlationId,
      operation,
      collection,
      id,
      primary_result: primaryResult,
      mirror_result: mirrorResult,
      duration_ms: durationMs,
    },
    `persistence write: ${operation} ${collection}`,
  )
}

export function logMirrorRetry({ operation, collection, id, attempt, error, correlationId }) {
  logger.warn(
    {
      component: 'persistence',
      event: 'mirror_retry',
      correlation_id: correlationId,
      operation,
      collection,
      id,
      attempt,
      error: error?.message || String(error),
    },
    `mirror retry ${attempt} for ${operation} ${collection}`,
  )
}

export function logReconciliation({ collection, driftType, count, durationMs }) {
  logger.info(
    {
      component: 'persistence',
      event: 'reconciliation',
      collection,
      drift_type: driftType,
      drift_count: count,
      duration_ms: durationMs,
    },
    `reconciliation complete: ${collection}`,
  )
}

export function logStartupConsistency({ mode, ok, details }) {
  const level = ok ? 'info' : mode === 'strict' ? 'fatal' : 'warn'
  logger[level](
    {
      component: 'persistence',
      event: 'startup_consistency',
      mode,
      ok,
      details,
    },
    `startup consistency check: ${ok ? 'passed' : 'failed'}`,
  )
}

export function logQuery({ operation, collection, durationMs, correlationId }) {
  logger.debug(
    {
      component: 'persistence',
      event: 'query',
      correlation_id: correlationId,
      operation,
      collection,
      duration_ms: durationMs,
    },
    `query: ${operation} ${collection}`,
  )
}
