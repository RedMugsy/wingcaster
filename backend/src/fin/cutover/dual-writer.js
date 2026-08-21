/**
 * Stage 13a dual-write runner (DL-173 / I-14).
 * Runs the fin.* callback inside the caller's tx (ALS join) or opens one.
 * On fin failure: SAVEPOINT rollback + INSERT cutover_dual_write_errors;
 * never rethrows — legacy must still commit.
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'

function errorCodeOf(error) {
  return String(error?.code || error?.error_code || 'DUAL_WRITE_FAILED').slice(0, 128)
}

function errorMessageOf(error) {
  return String(error?.message || error?.error_message || error || 'dual_write_failed').slice(0, 2000)
}

async function insertDualWriteError(client, {
  environment,
  tenantId,
  legacy,
  finCommand,
  error,
  now,
}) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO fin.cutover_dual_write_errors (
       id, environment, tenant_id, legacy_source, legacy_row_id,
       fin_command, error_code, error_message, payload, occurred_at, created_at
     ) VALUES (
       $1,$2,$3,$4,$5,
       $6,$7,$8,$9::jsonb,$10,$10
     )`,
    [
      id,
      environment === 'TEST' ? 'TEST' : 'LIVE',
      tenantId || null,
      legacy?.source || 'unknown',
      legacy?.rowId != null ? String(legacy.rowId) : null,
      finCommand || 'unknown',
      errorCodeOf(error),
      errorMessageOf(error),
      JSON.stringify(legacy?.payload ?? {}),
      now,
    ],
  )
  return id
}

/**
 * @param {{
 *   client?: import('pg').PoolClient,
 *   environment?: string,
 *   tenantId?: string|null,
 *   finCommand?: string,
 *   legacy: { source: string, rowId?: string|null, payload?: object },
 *   fin: (finClient: import('pg').PoolClient) => Promise<any>,
 *   now?: string,
 * }} args
 * @returns {Promise<{ ok: true, finResult: any } | { ok: false, error: any, dlqId?: string }>}
 */
export async function dualWrite({
  client = null,
  environment = 'LIVE',
  tenantId = null,
  finCommand = 'unknown',
  legacy,
  fin,
  now = null,
} = {}) {
  const occurredAt = now || BusinessClock.now()

  const run = async (finClient) => {
    try {
      await finClient.query('SAVEPOINT cutover_dual_write')
      const finResult = await fin(finClient)
      // Soft-fail when fin command returns { ok: false } without throwing.
      if (finResult && typeof finResult === 'object' && finResult.ok === false) {
        throw Object.assign(new Error(finResult.error_code || finResult.denialCode || 'FIN_SOFT_FAIL'), {
          code: finResult.error_code || finResult.denialCode || 'FIN_SOFT_FAIL',
          finResult,
        })
      }
      await finClient.query('RELEASE SAVEPOINT cutover_dual_write')
      return { ok: true, finResult }
    } catch (error) {
      await finClient.query('ROLLBACK TO SAVEPOINT cutover_dual_write').catch(() => {})
      let dlqId = null
      try {
        dlqId = await insertDualWriteError(finClient, {
          environment,
          tenantId,
          legacy,
          finCommand,
          error,
          now: occurredAt,
        })
      } catch (dlqErr) {
        // Last resort: never block legacy. Surface both errors for logs.
        return {
          ok: false,
          error,
          dlqError: dlqErr,
        }
      }
      return { ok: false, error, dlqId }
    }
  }

  if (client) return run(client)
  // Join ambient ALS tx when present; otherwise open a dedicated one.
  return transaction((txClient) => run(txClient))
}
