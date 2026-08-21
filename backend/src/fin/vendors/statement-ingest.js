/**
 * Vendor statement ingest — create / add line / receive.
 * Mutable operations are pre-FINALIZE. Actual costs are written with each
 * line (nullable-line posture is the row itself; FINALIZE attributes cost).
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import {
  asMinor, bumpHeader, claim, envelope, finish, lockHeader, lockVendor,
  mapVendorPgError, nextKey, withRetry,
} from './helpers.js'

async function recomputeTotals(client, statementId, {
  expectedVersion, now, actorType, actorId,
} = {}) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total
       FROM fin.vendor_statement_lines WHERE statement_id = $1`,
    [statementId],
  )
  const total = rows[0].total
  if (expectedVersion == null) {
    await client.query(
      `UPDATE fin.vendor_statements SET subtotal_minor = $2, total_minor = $2 WHERE id = $1`,
      [statementId, total],
    )
    return { total, row: null }
  }
  const updated = await client.query(
    `UPDATE fin.vendor_statements
        SET subtotal_minor = $2, total_minor = $2,
            updated_at = $3, updated_by_actor_type = $4, updated_by_actor_id = $5
      WHERE id = $1 AND version = $6
      RETURNING *`,
    [statementId, total, now, actorType, actorId, expectedVersion],
  )
  return { total, row: updated.rows[0] || null }
}

async function matchEstimate(client, { vendorId, productCode, usedEstimateIds }) {
  const { rows } = await client.query(
    `SELECT * FROM fin.vendor_cost_estimates
      WHERE vendor_id = $1 AND vendor_product_code = $2 AND status = 'ACTIVE'
      ORDER BY created_at ASC, id ASC`,
    [vendorId, productCode],
  )
  return rows.find((row) => !usedEstimateIds.has(row.id)) || null
}

export async function createStatement(input) {
  const vendorId = input.vendorId ?? input.vendor_id
  const periodKey = input.statementPeriodKey ?? input.statement_period_key
  const currency = input.currency
  if (!vendorId) throw finError('FIN_VENDOR_NOT_FOUND', { category: CATEGORY.VALIDATION })
  if (!periodKey) throw finError('VENDOR_STATEMENT_PERIOD_REQUIRED', { category: CATEGORY.VALIDATION })
  if (!currency || String(currency).length !== 3) {
    throw finError('FIN_VENDOR_CURRENCY_INVALID', { category: CATEGORY.VALIDATION })
  }
  const env = envelope(input)
  const key = env.idempotencyKey || `VENDOR_STMT_CREATE:${env.environment}:${vendorId}:${periodKey}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'CreateVendorStatement', vendorId, periodKey, currency,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const vendor = await lockVendor(client, vendorId)
    if (!vendor) throw finError('FIN_VENDOR_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })

    const id = randomUUID()
    try {
      await client.query(
        `INSERT INTO fin.vendor_statements (
           id, vendor_id, environment, statement_period_key, currency,
           subtotal_minor, tax_minor, total_minor, status,
           created_at, created_by_actor_type, created_by_actor_id,
           updated_at, updated_by_actor_type, updated_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,0,0,0,'DRAFT',$6,$7,$8,$6,$7,$8)`,
        [id, vendorId, vendor.environment, periodKey, currency, env.now, env.actorType, env.actorId],
      )
    } catch (error) {
      if (error.code === '23505') {
        throw finError('VENDOR_STATEMENT_PERIOD_EXISTS', { category: CATEGORY.CONFLICT, httpStatus: 409 })
      }
      throw mapVendorPgError(error)
    }
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'VENDOR_STATEMENT_CREATED',
      targetType: 'VENDOR_STATEMENT',
      targetId: id,
      afterState: { vendorId, periodKey, status: 'DRAFT' },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.statement.status',
      dedupeKey: `vstmt:${id}:DRAFT`,
      payload: { id, vendorId, status: 'DRAFT' },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'CreateVendorStatement',
      id,
      vendorId,
      statementPeriodKey: periodKey,
      status: 'DRAFT',
      version: 1,
    })
  })
}

export async function addStatementLine(input) {
  const statementId = input.statementId ?? input.statement_id
  const productCode = input.productCode ?? input.product_code
  const quantityUnits = asMinor(input.quantityUnits ?? input.quantity_units)
  const unitCostMinor = asMinor(input.unitCostMinor ?? input.unit_cost_minor)
  if (!statementId) throw finError('VENDOR_STATEMENT_NOT_FOUND', { category: CATEGORY.VALIDATION })
  if (!productCode) throw finError('FIN_VENDOR_PRODUCT_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
  const env = envelope(input)
  const amountMinor = input.amountMinor != null || input.amount_minor != null
    ? asMinor(input.amountMinor ?? input.amount_minor)
    : quantityUnits * unitCostMinor
  const key = env.idempotencyKey || nextKey(`VENDOR_STMT_LINE:${statementId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'AddVendorStatementLine', statementId, productCode,
      quantityUnits: quantityUnits.toString(), unitCostMinor: unitCostMinor.toString(),
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const statement = await lockHeader(client, 'vendor_statements', statementId)
    if (!statement) {
      throw finError('VENDOR_STATEMENT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    if (!['DRAFT', 'RECEIVED'].includes(statement.status)) {
      throw finError('VENDOR_STATEMENT_ILLEGAL_TRANSITION', {
        category: CATEGORY.PRECONDITION,
        httpStatus: 409,
        details: { status: statement.status },
      })
    }
    await lockVendor(client, statement.vendor_id)

    const lineId = randomUUID()
    const currency = input.currency || statement.currency
    try {
      await client.query(
        `INSERT INTO fin.vendor_statement_lines (
           id, statement_id, environment, product_code, quantity_units,
           unit_cost_minor, amount_minor, currency, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          lineId, statementId, statement.environment, productCode,
          quantityUnits.toString(), unitCostMinor.toString(), amountMinor.toString(),
          currency, env.now,
        ],
      )
    } catch (error) {
      throw mapVendorPgError(error)
    }

    const usedEstimateIds = new Set()
    const linkedEstimates = (await client.query(
      `SELECT e.id
         FROM fin.vendor_cost_estimates e
         JOIN fin.vendor_actual_costs a ON a.rated_usage_id = e.rated_usage_id
        WHERE a.vendor_id = $1 AND e.status = 'ACTIVE'`,
      [statement.vendor_id],
    )).rows
    for (const row of linkedEstimates) usedEstimateIds.add(row.id)

    const estimate = await matchEstimate(client, {
      vendorId: statement.vendor_id,
      productCode,
      usedEstimateIds,
    })

    const actualId = randomUUID()
    await client.query(
      `INSERT INTO fin.vendor_actual_costs (
         id, vendor_statement_line_id, vendor_id, vendor_product_code, rated_usage_id,
         environment, quantity_units, unit_cost_minor, amount_minor, currency,
         created_at, created_by_actor_type, created_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        actualId, lineId, statement.vendor_id, productCode,
        estimate?.rated_usage_id || null,
        statement.environment, quantityUnits.toString(), unitCostMinor.toString(),
        amountMinor.toString(), currency, env.now, env.actorType, env.actorId,
      ],
    )

    const { total, row: bumped } = await recomputeTotals(client, statementId, {
      expectedVersion: statement.version,
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
    })
    if (!bumped) {
      throw finError('PRECONDITION_FAILED', {
        category: CATEGORY.CONFLICT,
        httpStatus: 412,
        retryable: true,
      })
    }
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'VENDOR_STATEMENT_LINE_ADDED',
      targetType: 'VENDOR_STATEMENT_LINE',
      targetId: lineId,
      afterState: { statementId, productCode, amountMinor: amountMinor.toString() },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.statement.line',
      dedupeKey: `vstmtln:${lineId}`,
      payload: { id: lineId, statementId, actualId },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'AddVendorStatementLine',
      id: lineId,
      statementId,
      actualCostId: actualId,
      ratedUsageId: estimate?.rated_usage_id || null,
      totalMinor: String(total),
      version: Number(bumped.version),
    })
  })
}

export async function receiveStatement(input) {
  const statementId = input.statementId ?? input.statement_id
  if (!statementId) throw finError('VENDOR_STATEMENT_NOT_FOUND', { category: CATEGORY.VALIDATION })
  const env = envelope(input)
  const key = env.idempotencyKey || nextKey(`VENDOR_STMT_RECEIVE:${statementId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'ReceiveVendorStatement', statementId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const statement = await lockHeader(client, 'vendor_statements', statementId)
    if (!statement) {
      throw finError('VENDOR_STATEMENT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    await lockVendor(client, statement.vendor_id)
    if (statement.status !== 'DRAFT') {
      throw finError('VENDOR_STATEMENT_ILLEGAL_TRANSITION', {
        category: CATEGORY.PRECONDITION,
        httpStatus: 409,
        details: { from: statement.status, to: 'RECEIVED' },
      })
    }
    let updated
    try {
      updated = (await client.query(
        `UPDATE fin.vendor_statements SET status = 'RECEIVED' WHERE id = $1 AND status = 'DRAFT'
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
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'VENDOR_STATEMENT_RECEIVED',
      targetType: 'VENDOR_STATEMENT',
      targetId: statementId,
      afterState: { status: 'RECEIVED' },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.statement.status',
      dedupeKey: `vstmt:${statementId}:RECEIVED:v${Number(bumped.version)}`,
      payload: { id: statementId, status: 'RECEIVED' },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'ReceiveVendorStatement',
      id: statementId,
      status: 'RECEIVED',
      version: Number(bumped.version),
    })
  })
}

export async function listVendorStatements(client, vendorId) {
  const statements = (await client.query(
    `SELECT s.*,
            (SELECT COUNT(*)::int FROM fin.vendor_variances v
              WHERE v.statement_id = s.id AND v.resolved = false) AS unresolved_variance_count
       FROM fin.vendor_statements s
      WHERE s.vendor_id = $1
      ORDER BY s.statement_period_key DESC`,
    [vendorId],
  )).rows
  return statements
}
