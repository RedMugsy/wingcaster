/**
 * 6-way vendor statement variance (spec §125) + FINALIZE.
 * Reason codes live in fin.vendor_variance_reasons (DL-152 TABLE).
 * Per-statement xact lock FIN_VENDOR_STATEMENT_RECON = 1021 (DL-151).
 * No book lock — this is metrics, not ledger.
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import { attributeProviderCostForStatement } from '../accounting/provider-cost.js'
import {
  asMinor, bumpHeader, claim, envelope, finish, lockHeader, lockVendor,
  lockVendorStatementRecon, mapVendorPgError, nextKey, withRetry,
} from './helpers.js'

export const VARIANCE_REASONS = [
  'drift',
  'rate_change',
  'late_usage',
  'duplicate',
  'missing_source',
  'timezone',
  'rounding',
  'currency_mismatch',
  'classification_drift',
  'unknown',
]

export const VARIANCE_AXES = ['A', 'B', 'C', 'D', 'E', 'F']

export function classifyVariance({ leftQty, rightQty, hints = {} } = {}) {
  if (hints.reason && VARIANCE_REASONS.includes(hints.reason)) return hints.reason
  if (hints.currencyMismatch) return 'currency_mismatch'
  if (hints.duplicate) return 'duplicate'
  if (hints.lateUsage) return 'late_usage'
  if (hints.timezone) return 'timezone'
  if (hints.classificationDrift) return 'classification_drift'
  if (hints.rateChange) return 'rate_change'
  if (hints.unknown) return 'unknown'
  const left = asMinor(leftQty)
  const right = asMinor(rightQty)
  if (left === right) return null
  if (left === 0n || right === 0n) return 'missing_source'
  const delta = left > right ? left - right : right - left
  if (delta === 1n) return 'rounding'
  return 'drift'
}

async function qty(client, sql, params) {
  const { rows } = await client.query(sql, params)
  return asMinor(rows[0]?.qty ?? 0)
}

async function measureAxes(client, statement) {
  const vendorId = statement.vendor_id
  const periodKey = statement.statement_period_key
  const environment = statement.environment
  const params = [vendorId, environment, periodKey]

  const A_left = await qty(client, `
    SELECT COALESCE(SUM(e.quantity_units), 0)::bigint AS qty
      FROM fin.usage_events e
      JOIN fin.metered_usage_sources s
        ON s.usage_event_id = e.id AND s.residency_key = e.residency_key
      JOIN fin.metered_usage mu ON mu.id = s.metered_usage_id
      JOIN fin.meter_versions mv ON mv.id = mu.meter_version_id
      JOIN fin.meter_vendor_map mvm
        ON mvm.meter_id = mv.meter_id AND mvm.vendor_id = $1 AND mvm.environment = $2
     WHERE e.environment = $2
       AND to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = $3
  `, params)
  const A_right = await qty(client, `
    SELECT COALESCE(SUM(mu.quantity_units), 0)::bigint AS qty
      FROM fin.metered_usage mu
      JOIN fin.meter_versions mv ON mv.id = mu.meter_version_id
      JOIN fin.meter_vendor_map mvm
        ON mvm.meter_id = mv.meter_id AND mvm.vendor_id = $1 AND mvm.environment = $2
     WHERE mu.environment = $2
       AND to_char(mu.metered_at AT TIME ZONE 'UTC', 'YYYY-MM') = $3
  `, params)

  const B_left = A_right
  const B_right = await qty(client, `
    SELECT COALESCE(SUM(quantity_units), 0)::bigint AS qty
      FROM fin.vendor_usage_events
     WHERE vendor_id = $1 AND environment = $2
       AND to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = $3
  `, params)

  const C_left = B_right
  const C_right = await qty(client, `
    SELECT COALESCE(SUM(quantity_units), 0)::bigint AS qty
      FROM fin.vendor_reported_usage
     WHERE vendor_id = $1 AND environment = $2 AND reporting_period_key = $3
  `, params)

  const D_left = C_right
  const D_right = await qty(client, `
    SELECT COALESCE(SUM(l.quantity_units), 0)::bigint AS qty
      FROM fin.vendor_statement_lines l
     WHERE l.statement_id = $1
  `, [statement.id])

  const E_left = await qty(client, `
    SELECT COALESCE(SUM(e.amount_minor), 0)::bigint AS qty
      FROM fin.vendor_cost_estimates e
      JOIN fin.rated_usage ru ON ru.id = e.rated_usage_id
     WHERE e.vendor_id = $1 AND e.environment = $2 AND e.status = 'ACTIVE'
       AND to_char(ru.metered_at AT TIME ZONE 'UTC', 'YYYY-MM') = $3
  `, params)
  const E_right = await qty(client, `
    SELECT COALESCE(SUM(a.amount_minor), 0)::bigint AS qty
      FROM fin.vendor_actual_costs a
      JOIN fin.vendor_statement_lines l ON l.id = a.vendor_statement_line_id
     WHERE l.statement_id = $1
  `, [statement.id])

  const F_left = E_right
  const F_right = asMinor(statement.total_minor)

  return {
    A: { left: A_left, right: A_right },
    B: { left: B_left, right: B_right },
    C: { left: C_left, right: C_right },
    D: { left: D_left, right: D_right },
    E: { left: E_left, right: E_right },
    F: { left: F_left, right: F_right },
  }
}

function hintsForAxis(axis, pair, inputHints = {}) {
  const axisHints = inputHints[axis] || {}
  if (axis === 'E' && pair.left !== pair.right && !axisHints.reason) {
    return { ...axisHints, rateChange: axisHints.rateChange ?? true }
  }
  return axisHints
}

export async function reconcileStatement(input) {
  const statementId = input.statementId ?? input.statement_id
  if (!statementId) throw finError('VENDOR_STATEMENT_NOT_FOUND', { category: CATEGORY.VALIDATION })
  const env = envelope(input)
  const key = env.idempotencyKey || nextKey(`VENDOR_STMT_RECON:${statementId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'ReconcileVendorStatement', statementId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    await lockVendorStatementRecon(client, statementId)
    const statement = await lockHeader(client, 'vendor_statements', statementId)
    if (!statement) {
      throw finError('VENDOR_STATEMENT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    await lockVendor(client, statement.vendor_id)
    if (!['RECEIVED', 'RECONCILED'].includes(statement.status)) {
      throw finError('VENDOR_STATEMENT_ILLEGAL_TRANSITION', {
        category: CATEGORY.PRECONDITION,
        httpStatus: 409,
        details: { status: statement.status },
      })
    }

    const axes = await measureAxes(client, statement)
    const rows = []
    for (const axis of VARIANCE_AXES) {
      const pair = axes[axis]
      const reason = classifyVariance({
        leftQty: pair.left,
        rightQty: pair.right,
        hints: hintsForAxis(axis, pair, input.hints || {}),
      })
      if (!reason) continue
      const id = randomUUID()
      await client.query(
        `INSERT INTO fin.vendor_variances (
           id, statement_id, environment, axis, reason_code, left_qty, right_qty,
           resolved, details, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8::jsonb,$9,$9)
         ON CONFLICT (statement_id, axis) DO UPDATE
           SET reason_code = EXCLUDED.reason_code,
               left_qty = EXCLUDED.left_qty,
               right_qty = EXCLUDED.right_qty,
               resolved = false,
               details = EXCLUDED.details,
               updated_at = EXCLUDED.updated_at`,
        [
          id, statementId, statement.environment, axis, reason,
          pair.left.toString(), pair.right.toString(),
          JSON.stringify({ axis }), env.now,
        ],
      )
      rows.push({ axis, reason, leftQty: pair.left.toString(), rightQty: pair.right.toString() })
    }
    const matching = VARIANCE_AXES.filter((axis) => !rows.find((r) => r.axis === axis))
    if (matching.length) {
      await client.query(
        `UPDATE fin.vendor_variances
            SET resolved = true, updated_at = $2
          WHERE statement_id = $1 AND axis = ANY($3::text[])`,
        [statementId, env.now, matching],
      )
    }

    let bumped = statement
    if (statement.status === 'RECEIVED') {
      let updated
      try {
        updated = (await client.query(
          `UPDATE fin.vendor_statements SET status = 'RECONCILED' WHERE id = $1 AND status = 'RECEIVED'
           RETURNING *`,
          [statementId],
        )).rows[0]
      } catch (error) {
        throw mapVendorPgError(error)
      }
      bumped = await bumpHeader(client, {
        table: 'vendor_statements',
        id: statementId,
        expectedVersion: updated.version,
        now: env.now,
        actorType: env.actorType,
        actorId: env.actorId,
      })
    }

    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'VENDOR_STATEMENT_RECONCILED',
      targetType: 'VENDOR_STATEMENT',
      targetId: statementId,
      afterState: { status: 'RECONCILED', variances: rows.length },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.statement.status',
      dedupeKey: `vstmt:${statementId}:RECONCILED:v${Number(bumped.version)}`,
      payload: { id: statementId, status: 'RECONCILED', variances: rows.length },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'ReconcileVendorStatement',
      id: statementId,
      status: 'RECONCILED',
      variances: rows,
      version: Number(bumped.version),
    })
  })
}

async function loadOverrideApproval(client, approvalId) {
  if (!approvalId) return null
  const { rows } = await client.query(
    `SELECT * FROM fin.approval_requests WHERE id = $1`,
    [approvalId],
  )
  const approval = rows[0]
  if (
    !approval
    || approval.action_kind !== 'VENDOR_VARIANCE_OVERRIDE'
    || !['APPROVED', 'EXECUTED'].includes(approval.status)
  ) {
    throw finError('VENDOR_STATEMENT_UNRESOLVED_VARIANCE', {
      category: CATEGORY.APPROVAL,
      httpStatus: 409,
    })
  }
  return approval
}

export async function finalizeStatement(input) {
  const statementId = input.statementId ?? input.statement_id
  if (!statementId) throw finError('VENDOR_STATEMENT_NOT_FOUND', { category: CATEGORY.VALIDATION })
  const env = envelope(input)
  const key = env.idempotencyKey || nextKey(`VENDOR_STMT_FINALIZE:${statementId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'FinalizeVendorStatement', statementId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    await lockVendorStatementRecon(client, statementId)
    const statement = await lockHeader(client, 'vendor_statements', statementId)
    if (!statement) {
      throw finError('VENDOR_STATEMENT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    await lockVendor(client, statement.vendor_id)
    if (statement.status !== 'RECONCILED') {
      throw finError('VENDOR_STATEMENT_ILLEGAL_TRANSITION', {
        category: CATEGORY.PRECONDITION,
        httpStatus: 409,
        details: { from: statement.status, to: 'FINALIZED' },
      })
    }

    const unresolved = (await client.query(
      `SELECT COUNT(*)::int AS n FROM fin.vendor_variances
        WHERE statement_id = $1 AND resolved = false`,
      [statementId],
    )).rows[0].n
    if (unresolved > 0) {
      const approvalId = input.approvalRequestId ?? input.approval_request_id ?? null
      if (!approvalId && env.actorType === 'USER') {
        throw finError('VENDOR_STATEMENT_UNRESOLVED_VARIANCE', {
          category: CATEGORY.APPROVAL,
          httpStatus: 409,
        })
      }
      if (approvalId) {
        await loadOverrideApproval(client, approvalId)
      } else if (env.actorType !== 'SYSTEM' && env.actorType !== 'WORKER') {
        throw finError('VENDOR_STATEMENT_UNRESOLVED_VARIANCE', {
          category: CATEGORY.APPROVAL,
          httpStatus: 409,
        })
      } else {
        throw finError('VENDOR_STATEMENT_UNRESOLVED_VARIANCE', {
          category: CATEGORY.PRECONDITION,
          httpStatus: 409,
        })
      }
    }

    let updated
    try {
      updated = (await client.query(
        `UPDATE fin.vendor_statements SET status = 'FINALIZED' WHERE id = $1 AND status = 'RECONCILED'
         RETURNING *`,
        [statementId],
      )).rows[0]
    } catch (error) {
      throw mapVendorPgError(error)
    }
    const bumped = await bumpHeader(client, {
      table: 'vendor_statements',
      id: statementId,
      expectedVersion: updated.version,
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
    })

    await attributeProviderCostForStatement(client, {
      statement: bumped,
      now: env.now,
      actor: { type: env.actorType, id: env.actorId, email: env.actorEmail },
    })

    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'VENDOR_STATEMENT_FINALIZED',
      targetType: 'VENDOR_STATEMENT',
      targetId: statementId,
      afterState: { status: 'FINALIZED' },
      reasonCode: env.reasonCode,
      approvalRequestId: input.approvalRequestId || null,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.statement.finalized',
      dedupeKey: `vstmt:${statementId}:FINALIZED:v${Number(bumped.version)}`,
      payload: { id: statementId, status: 'FINALIZED' },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'FinalizeVendorStatement',
      id: statementId,
      status: 'FINALIZED',
      version: Number(bumped.version),
    })
  })
}
