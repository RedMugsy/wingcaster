/**
 * Vendor registry — vendors, products, rate cards, rate versions.
 * Version machine mirrors Stage 4 prices with DEPRECATED (DL-158).
 * Commercial life only — no ledger_transactions.
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { requestFingerprint } from '../idempotency/fingerprint.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import {
  assertIfMatch, bumpHeader, claim, envelope, finish, iso, lockHeader,
  lockVendor, mapExclusion, mapVendorPgError, nextKey, withRetry,
} from './helpers.js'

const LEGAL_RATE_TRANSITIONS = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['DEPRECATED'],
}

export function assertLegalRateVersionTransition(from, to) {
  if (!LEGAL_RATE_TRANSITIONS[from]?.includes(to)) {
    throw finError('VENDOR_RATE_VERSION_ILLEGAL_TRANSITION', {
      category: CATEGORY.PRECONDITION,
      httpStatus: 409,
      details: { from, to },
    })
  }
}

export function validateRates(rates) {
  if (!rates || typeof rates !== 'object' || Array.isArray(rates)) {
    throw finError('FIN_VENDOR_RATES_INVALID', { category: CATEGORY.VALIDATION })
  }
  for (const [code, row] of Object.entries(rates)) {
    if (!code || !row || typeof row !== 'object') {
      throw finError('FIN_VENDOR_RATES_INVALID', { category: CATEGORY.VALIDATION })
    }
    if (row.unit_cost_minor == null || row.unit_cost_minor === '') {
      throw finError('FIN_VENDOR_RATES_INVALID', { category: CATEGORY.VALIDATION })
    }
    if (!row.currency || String(row.currency).length !== 3) {
      throw finError('FIN_VENDOR_RATES_INVALID', { category: CATEGORY.VALIDATION })
    }
  }
}

function requireName(name) {
  if (!name || !String(name).trim()) {
    throw finError('FIN_VENDOR_NAME_REQUIRED', { category: CATEGORY.VALIDATION })
  }
}

function requireCurrency(currency) {
  if (!currency || String(currency).length !== 3) {
    throw finError('FIN_VENDOR_CURRENCY_INVALID', { category: CATEGORY.VALIDATION })
  }
}

export async function createVendor(input) {
  const name = input.name
  const currency = input.currency
  requireName(name)
  requireCurrency(currency)
  const env = envelope(input)
  const key = env.idempotencyKey || `VENDOR_CREATE:${env.environment}:${name}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'CreateVendor', environment: env.environment, name, currency,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.vendors (
         id, environment, name, currency, contact_meta, active,
         created_at, created_by_actor_type, created_by_actor_id,
         updated_at, updated_by_actor_type, updated_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$7,$8,$9)`,
      [
        id, env.environment, name, currency,
        JSON.stringify(input.contactMeta || input.contact_meta || {}),
        input.active !== false, env.now, env.actorType, env.actorId,
      ],
    )
    const header = (await client.query(`SELECT * FROM fin.vendors WHERE id = $1`, [id])).rows[0]
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'VENDOR_CREATED',
      targetType: 'VENDOR',
      targetId: id,
      afterState: { name, currency },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.created',
      dedupeKey: `vendor:${id}`,
      payload: { id, name, currency },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'CreateVendor',
      id,
      version: Number(header.version),
    })
  })
}

export async function upsertVendorProduct(input) {
  const vendorId = input.vendorId ?? input.vendor_id
  const productCode = input.productCode ?? input.product_code
  const productClass = input.productClass ?? input.product_class ?? null
  if (!vendorId) throw finError('FIN_VENDOR_NOT_FOUND', { category: CATEGORY.VALIDATION })
  if (!productCode) throw finError('FIN_VENDOR_PRODUCT_CODE_REQUIRED', { category: CATEGORY.VALIDATION })
  const env = envelope(input)
  // Semantic A (DL-161): same key + same payload = replay; same key +
  // different payload = a new claim. Payload hash is in the key so an
  // intentional UPDATE does not collide on IDEMPOTENCY_FINGERPRINT_CONFLICT.
  const fingerprintPayload = {
    cmd: 'UpsertVendorProduct', vendorId, productCode, productClass,
  }
  const payloadHash = requestFingerprint(fingerprintPayload)
  const key = env.idempotencyKey
    || `VENDOR_PRODUCT:UPSERT:${vendorId}:${productCode}:${payloadHash}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, fingerprintPayload)
    if (claimed.kind === 'replay') return claimed.row.response_body

    const vendor = await lockVendor(client, vendorId)
    if (!vendor) throw finError('FIN_VENDOR_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    if (vendor.environment !== env.environment) {
      throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
    }

    const existing = (await client.query(
      `SELECT * FROM fin.vendor_products WHERE vendor_id = $1 AND product_code = $2 FOR UPDATE`,
      [vendorId, productCode],
    )).rows[0]

    let id
    if (existing) {
      id = existing.id
      await client.query(
        `UPDATE fin.vendor_products
            SET product_class = $2, updated_at = $3,
                updated_by_actor_type = $4, updated_by_actor_id = $5
          WHERE id = $1`,
        [id, productClass, env.now, env.actorType, env.actorId],
      )
    } else {
      id = randomUUID()
      await client.query(
        `INSERT INTO fin.vendor_products (
           id, vendor_id, environment, product_code, product_class,
           created_at, created_by_actor_type, created_by_actor_id,
           updated_at, updated_by_actor_type, updated_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6,$7,$8)`,
        [id, vendorId, vendor.environment, productCode, productClass,
          env.now, env.actorType, env.actorId],
      )
    }

    await bumpHeader(client, {
      table: 'vendors', id: vendorId, expectedVersion: vendor.version,
      now: env.now, actorType: env.actorType, actorId: env.actorId,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: existing ? 'VENDOR_PRODUCT_UPDATED' : 'VENDOR_PRODUCT_CREATED',
      targetType: 'VENDOR_PRODUCT',
      targetId: id,
      afterState: { vendorId, productCode, productClass },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.product',
      dedupeKey: `vprod:${id}:v${Number(vendor.version) + 1}`,
      payload: { id, vendorId, productCode },
      now: env.now,
    })
    const bumped = (await client.query(`SELECT version FROM fin.vendors WHERE id = $1`, [vendorId])).rows[0]
    return finish(client, claimed, env, {
      command: 'UpsertVendorProduct',
      id,
      vendorId,
      productCode,
      version: Number(bumped.version),
    })
  })
}

export async function createRateCard(input) {
  const vendorId = input.vendorId ?? input.vendor_id
  const name = input.name
  requireName(name)
  if (!vendorId) throw finError('FIN_VENDOR_NOT_FOUND', { category: CATEGORY.VALIDATION })
  const env = envelope(input)
  const key = env.idempotencyKey || `VENDOR_RATE_CARD:${vendorId}:${name}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'CreateRateCard', vendorId, name,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const vendor = await lockVendor(client, vendorId)
    if (!vendor) throw finError('FIN_VENDOR_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })

    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.vendor_rate_cards (
         id, vendor_id, environment, name,
         created_at, created_by_actor_type, created_by_actor_id,
         updated_at, updated_by_actor_type, updated_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$5,$6,$7)`,
      [id, vendorId, vendor.environment, name, env.now, env.actorType, env.actorId],
    )
    await bumpHeader(client, {
      table: 'vendors', id: vendorId, expectedVersion: vendor.version,
      now: env.now, actorType: env.actorType, actorId: env.actorId,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'VENDOR_RATE_CARD_CREATED',
      targetType: 'VENDOR_RATE_CARD',
      targetId: id,
      afterState: { vendorId, name },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.rate_card',
      dedupeKey: `vrc:${id}`,
      payload: { id, vendorId, name },
      now: env.now,
    })
    const header = (await client.query(`SELECT version FROM fin.vendor_rate_cards WHERE id = $1`, [id])).rows[0]
    return finish(client, claimed, env, {
      command: 'CreateRateCard',
      id,
      vendorId,
      version: Number(header.version),
    })
  })
}

export async function draftRateVersion(input) {
  const rateCardId = input.rateCardId ?? input.rate_card_id
  const rates = input.rates
  if (!rateCardId) throw finError('FIN_VENDOR_RATE_CARD_NOT_FOUND', { category: CATEGORY.VALIDATION })
  validateRates(rates)
  const effectiveFrom = iso(input.effective_from ?? input.effectiveFrom)
  const effectiveTo = input.effective_to ?? input.effectiveTo ?? null
  const env = envelope(input)
  const key = env.idempotencyKey || nextKey(`VENDOR_RATE_DRAFT:${rateCardId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'DraftRateVersion', rateCardId, rates, effectiveFrom, effectiveTo,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const card = await lockHeader(client, 'vendor_rate_cards', rateCardId)
    if (!card) {
      throw finError('FIN_VENDOR_RATE_CARD_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    await lockVendor(client, card.vendor_id)
    assertIfMatch(card, env.expectedVersion)

    const maxN = (await client.query(
      `SELECT COALESCE(MAX(version_n), 0) AS n FROM fin.vendor_rate_versions WHERE rate_card_id = $1`,
      [rateCardId],
    )).rows[0].n
    const versionId = randomUUID()
    const versionN = Number(maxN) + 1
    try {
      await client.query(
        `INSERT INTO fin.vendor_rate_versions (
           id, rate_card_id, environment, version_n, effective_from, effective_to, status, rates
         ) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7::jsonb)`,
        [
          versionId, rateCardId, card.environment, versionN,
          effectiveFrom, effectiveTo, JSON.stringify(rates),
        ],
      )
    } catch (error) {
      mapExclusion(error, 'FIN_VENDOR_RATE_VERSION_OVERLAP')
    }

    const bumped = await bumpHeader(client, {
      table: 'vendor_rate_cards',
      id: rateCardId,
      expectedVersion: card.version,
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'VENDOR_RATE_VERSION_DRAFTED',
      targetType: 'VENDOR_RATE_VERSION',
      targetId: versionId,
      afterState: { rateCardId, versionN },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.rate_version',
      dedupeKey: `vrv:${versionId}:DRAFT`,
      payload: { id: versionId, rateCardId, status: 'DRAFT' },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'DraftRateVersion',
      id: versionId,
      rateCardId,
      version_n: versionN,
      version: Number(bumped.version),
    })
  })
}

async function deprecateActiveRateVersion(client, { rateCardId, successorFrom }) {
  const current = (await client.query(
    `SELECT * FROM fin.vendor_rate_versions
      WHERE rate_card_id = $1 AND status = 'ACTIVE'
      FOR UPDATE`,
    [rateCardId],
  )).rows[0]
  if (!current) return null
  if (new Date(successorFrom) <= new Date(current.effective_from)) {
    throw finError('FIN_VENDOR_RATE_VERSION_OVERLAP', { category: CATEGORY.CONFLICT, httpStatus: 409 })
  }
  try {
    await client.query(
      `UPDATE fin.vendor_rate_versions
          SET status = 'DEPRECATED', effective_to = $2
        WHERE id = $1 AND status = 'ACTIVE'`,
      [current.id, successorFrom],
    )
  } catch (error) {
    throw mapVendorPgError(error)
  }
  return current
}

export async function activateRateVersion(input) {
  const rateCardId = input.rateCardId ?? input.rate_card_id
  const rateVersionId = input.rateVersionId ?? input.rate_version_id
  if (!rateVersionId) {
    throw finError('FIN_VENDOR_RATE_VERSION_NOT_FOUND', { category: CATEGORY.VALIDATION })
  }
  if (input.currentStatus) {
    assertLegalRateVersionTransition(input.currentStatus, 'ACTIVE')
  }
  const env = envelope(input)
  const key = env.idempotencyKey || nextKey(`VENDOR_RATE_ACTIVATE:${rateVersionId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'ActivateRateVersion', rateVersionId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const card = await lockHeader(client, 'vendor_rate_cards', rateCardId)
    if (!card) {
      throw finError('FIN_VENDOR_RATE_CARD_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    await lockVendor(client, card.vendor_id)
    assertIfMatch(card, env.expectedVersion)

    const version = (await client.query(
      `SELECT * FROM fin.vendor_rate_versions WHERE id = $1 AND rate_card_id = $2 FOR UPDATE`,
      [rateVersionId, rateCardId],
    )).rows[0]
    if (!version) {
      throw finError('FIN_VENDOR_RATE_VERSION_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    assertLegalRateVersionTransition(version.status, 'ACTIVE')

    await deprecateActiveRateVersion(client, {
      rateCardId,
      successorFrom: version.effective_from,
    })
    try {
      await client.query(
        `UPDATE fin.vendor_rate_versions SET status = 'ACTIVE' WHERE id = $1 AND status = 'DRAFT'`,
        [rateVersionId],
      )
    } catch (error) {
      mapExclusion(error, 'FIN_VENDOR_RATE_VERSION_OVERLAP')
    }

    const bumped = await bumpHeader(client, {
      table: 'vendor_rate_cards',
      id: rateCardId,
      expectedVersion: card.version,
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'VENDOR_RATE_VERSION_ACTIVATED',
      targetType: 'VENDOR_RATE_VERSION',
      targetId: rateVersionId,
      afterState: { status: 'ACTIVE' },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.rate_version',
      dedupeKey: `vrv:${rateVersionId}:ACTIVE`,
      payload: { id: rateVersionId, rateCardId, status: 'ACTIVE' },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'ActivateRateVersion',
      id: rateVersionId,
      rateCardId,
      status: 'ACTIVE',
      version: Number(bumped.version),
    })
  })
}

export async function deprecateRateVersion(input) {
  const rateCardId = input.rateCardId ?? input.rate_card_id
  const rateVersionId = input.rateVersionId ?? input.rate_version_id
  if (!rateVersionId) {
    throw finError('FIN_VENDOR_RATE_VERSION_NOT_FOUND', { category: CATEGORY.VALIDATION })
  }
  if (input.currentStatus) {
    assertLegalRateVersionTransition(input.currentStatus, 'DEPRECATED')
  }
  const env = envelope(input)
  const key = env.idempotencyKey || nextKey(`VENDOR_RATE_DEPRECATE:${rateVersionId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'DeprecateRateVersion', rateVersionId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const card = await lockHeader(client, 'vendor_rate_cards', rateCardId)
    if (!card) {
      throw finError('FIN_VENDOR_RATE_CARD_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    await lockVendor(client, card.vendor_id)
    assertIfMatch(card, env.expectedVersion)

    const version = (await client.query(
      `SELECT * FROM fin.vendor_rate_versions WHERE id = $1 AND rate_card_id = $2 FOR UPDATE`,
      [rateVersionId, rateCardId],
    )).rows[0]
    if (!version) {
      throw finError('FIN_VENDOR_RATE_VERSION_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    assertLegalRateVersionTransition(version.status, 'DEPRECATED')
    try {
      // DL-162: DEPRECATE is a status semantic. Gap-fill already wrote
      // effective_to when the successor activated; overwriting it with
      // `now` can reverse tstzrange when effective_from is in the future.
      await client.query(
        `UPDATE fin.vendor_rate_versions
            SET status = 'DEPRECATED'
          WHERE id = $1 AND status = 'ACTIVE'`,
        [rateVersionId],
      )
    } catch (error) {
      throw mapVendorPgError(error)
    }

    const bumped = await bumpHeader(client, {
      table: 'vendor_rate_cards',
      id: rateCardId,
      expectedVersion: card.version,
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'VENDOR_RATE_VERSION_DEPRECATED',
      targetType: 'VENDOR_RATE_VERSION',
      targetId: rateVersionId,
      afterState: { status: 'DEPRECATED' },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.rate_version',
      dedupeKey: `vrv:${rateVersionId}:DEPRECATED`,
      payload: { id: rateVersionId, rateCardId, status: 'DEPRECATED' },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'DeprecateRateVersion',
      id: rateVersionId,
      rateCardId,
      status: 'DEPRECATED',
      version: Number(bumped.version),
    })
  })
}

export async function mapMeterVendor(input) {
  const meterId = input.meterId ?? input.meter_id
  const vendorId = input.vendorId ?? input.vendor_id
  const productCode = input.vendorProductCode ?? input.vendor_product_code
  if (!meterId || !vendorId || !productCode) {
    throw finError('FIN_METER_VENDOR_MAP_INVALID', { category: CATEGORY.VALIDATION })
  }
  const env = envelope(input)
  const key = env.idempotencyKey || `VENDOR_METER_MAP:${env.environment}:${meterId}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'MapMeterVendor', meterId, vendorId, productCode,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const vendor = await lockVendor(client, vendorId)
    if (!vendor) throw finError('FIN_VENDOR_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })

    const existing = (await client.query(
      `SELECT * FROM fin.meter_vendor_map WHERE environment = $1 AND meter_id = $2 FOR UPDATE`,
      [env.environment, meterId],
    )).rows[0]
    let id
    if (existing) {
      id = existing.id
      await client.query(
        `UPDATE fin.meter_vendor_map
            SET vendor_id = $2, vendor_product_code = $3, updated_at = $4,
                updated_by_actor_type = $5, updated_by_actor_id = $6
          WHERE id = $1`,
        [id, vendorId, productCode, env.now, env.actorType, env.actorId],
      )
    } else {
      id = randomUUID()
      await client.query(
        `INSERT INTO fin.meter_vendor_map (
           id, environment, meter_id, vendor_id, vendor_product_code,
           created_at, created_by_actor_type, created_by_actor_id,
           updated_at, updated_by_actor_type, updated_by_actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6,$7,$8)`,
        [id, env.environment, meterId, vendorId, productCode, env.now, env.actorType, env.actorId],
      )
    }
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'METER_VENDOR_MAPPED',
      targetType: 'METER_VENDOR_MAP',
      targetId: id,
      afterState: { meterId, vendorId, productCode },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.vendor.meter_map',
      dedupeKey: `vmap:${env.environment}:${meterId}`,
      payload: { id, meterId, vendorId, productCode },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'MapMeterVendor',
      id,
      meterId,
      vendorId,
      vendorProductCode: productCode,
    })
  })
}

export async function getVendor(client, id) {
  const header = (await client.query(`SELECT * FROM fin.vendors WHERE id = $1`, [id])).rows[0]
  if (!header) return null
  const products = (await client.query(
    `SELECT * FROM fin.vendor_products WHERE vendor_id = $1 ORDER BY product_code`,
    [id],
  )).rows
  const cards = (await client.query(
    `SELECT * FROM fin.vendor_rate_cards WHERE vendor_id = $1 ORDER BY name`,
    [id],
  )).rows
  const activeVersion = (await client.query(
    `SELECT vrv.*
       FROM fin.vendor_rate_versions vrv
       JOIN fin.vendor_rate_cards vrc ON vrc.id = vrv.rate_card_id
      WHERE vrc.vendor_id = $1 AND vrv.status = 'ACTIVE'
      ORDER BY vrv.effective_from DESC
      LIMIT 1`,
    [id],
  )).rows[0] || null
  return { ...header, products, rateCards: cards, activeRateVersion: activeVersion }
}

export async function listVendors(client, { environment = 'LIVE' } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM fin.vendors WHERE environment = $1 ORDER BY name`,
    [environment],
  )
  return rows
}
