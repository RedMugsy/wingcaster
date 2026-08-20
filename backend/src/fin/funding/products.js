/**
 * fin.credit_products catalog. Effective_from/effective_to windows.
 * Read-only HTTP is Stage 12; commands exist so Stage 7 can quote and test.
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import { asMinor, asUnits, unitsString } from './units.js'
import { claim, envelope, finish, iso, withRetry } from './helpers.js'

export function isProductActive(product, now) {
  if (!product) return false
  if (product.active === false || product.active === 'f') return false
  const clock = iso(now)
  const from = iso(product.effective_from || product.effectiveFrom)
  const to = product.effective_to ?? product.effectiveTo ?? null
  if (from && clock < from) return false
  if (to && clock >= iso(to)) return false
  return true
}

function productFields(input) {
  const units = asUnits(input.units)
  const bonusUnits = asUnits(input.bonus_units ?? input.bonusUnits ?? 0)
  const priceMinor = asMinor(input.price_minor ?? input.priceMinor)
  if (units <= 0n || priceMinor <= 0n) {
    throw finError('QUOTE_INVALID', { category: CATEGORY.VALIDATION })
  }
  if (bonusUnits < 0n) {
    throw finError('QUOTE_INVALID', { category: CATEGORY.VALIDATION })
  }
  return {
    code: input.code,
    name: input.name || input.code,
    units,
    bonusUnits,
    priceMinor,
    currency: input.currency,
    effectiveFrom: iso(input.effective_from ?? input.effectiveFrom),
    effectiveTo: input.effective_to ?? input.effectiveTo ?? null,
    active: input.active !== false,
  }
}

export async function createCreditProduct(input) {
  const env = envelope(input)
  const fields = productFields(input)
  const key = env.idempotencyKey || `PRODUCT_CREATE:${env.environment}:${fields.code}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'CreateCreditProduct', environment: env.environment, ...fields,
      units: unitsString(fields.units),
      bonusUnits: unitsString(fields.bonusUnits),
      priceMinor: unitsString(fields.priceMinor),
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.credit_products (
         id, environment, code, name, units, bonus_units, price_minor, currency,
         effective_from, effective_to, active,
         created_at, created_by_actor_type, created_by_actor_id,
         updated_at, updated_by_actor_type, updated_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$12,$13,$14)`,
      [
        id, env.environment, fields.code, fields.name,
        unitsString(fields.units), unitsString(fields.bonusUnits),
        unitsString(fields.priceMinor), fields.currency,
        fields.effectiveFrom, fields.effectiveTo, fields.active,
        env.now, env.actorType, env.actorId,
      ],
    )
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'CREDIT_PRODUCT_CREATED',
      targetType: 'CREDIT_PRODUCT',
      targetId: id,
      afterState: { code: fields.code, currency: fields.currency },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.product.created',
      dedupeKey: `product:${id}`,
      payload: { id, code: fields.code },
      now: env.now,
    })
    return finish(client, claimed, env, { command: 'CreateCreditProduct', id })
  })
}

export async function listCreditProducts({ environment = 'LIVE', currency, now } = {}) {
  const { query } = await import('../../db.js')
  const clock = iso(now)
  const rows = await query(
    `SELECT * FROM fin.credit_products
      WHERE environment = $1
        AND ($2::text IS NULL OR currency = $2)
      ORDER BY code ASC`,
    [environment, currency || null],
  )
  return rows.filter((row) => isProductActive(row, clock))
}

export async function getCreditProduct(clientOrId, maybeId) {
  const id = maybeId || clientOrId
  const client = maybeId ? clientOrId : null
  const sql = `SELECT * FROM fin.credit_products WHERE id = $1`
  if (client?.query) {
    const { rows } = await client.query(sql, [id])
    return rows[0] || null
  }
  const { query } = await import('../../db.js')
  const rows = await query(sql, [id])
  return rows[0] || null
}

export async function deactivateCreditProduct(input) {
  const env = envelope(input)
  const productId = input.productId || input.id
  const key = env.idempotencyKey || `PRODUCT_DEACTIVATE:${productId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'DeactivateCreditProduct', productId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body
    const { rowCount } = await client.query(
      `UPDATE fin.credit_products
          SET active = false, effective_to = COALESCE(effective_to, $2),
              updated_at = $2, updated_by_actor_type = $3, updated_by_actor_id = $4
        WHERE id = $1 AND environment = $5`,
      [productId, env.now, env.actorType, env.actorId, env.environment],
    )
    if (!rowCount) {
      throw finError('FIN_PRODUCT_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    return finish(client, claimed, env, { command: 'DeactivateCreditProduct', id: productId })
  })
}
