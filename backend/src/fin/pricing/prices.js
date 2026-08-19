/**
 * fin.prices command service. Commercial life only — no ledger_transactions (C §6).
 */
import { randomUUID } from 'node:crypto'
import { CATEGORY, finError } from '../errors.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import {
  assertIfMatch, bumpHeader, claim, envelope, finish, iso, lockHeader,
  mapExclusion, nextKey, requireBackdatedApproval, withRetry,
} from './helpers.js'

const TIER_MODELS = new Set(['GRADUATED_TIER', 'VOLUME_TIER'])
const DIMENSION_MODELS = new Set(['DIMENSIONAL'])
const UNIT_MODELS = new Set(['PER_UNIT', 'FLAT'])
const PACKAGE_MODELS = new Set(['PACKAGE'])

function validateModelShape({ model, unitRateMinor, packageSizeUnits, tiers, dimensions }) {
  if (TIER_MODELS.has(model) && (!Array.isArray(tiers) || tiers.length === 0)) {
    throw finError('FIN_PRICE_MODEL_INVALID', { category: CATEGORY.VALIDATION })
  }
  if (DIMENSION_MODELS.has(model) && (!Array.isArray(dimensions) || dimensions.length === 0)) {
    throw finError('FIN_PRICE_MODEL_INVALID', { category: CATEGORY.VALIDATION })
  }
  if (UNIT_MODELS.has(model) && (unitRateMinor == null || unitRateMinor === '')) {
    throw finError('FIN_PRICE_MODEL_INVALID', { category: CATEGORY.VALIDATION })
  }
  if (PACKAGE_MODELS.has(model) && (packageSizeUnits == null || packageSizeUnits === '')) {
    throw finError('FIN_PRICE_MODEL_INVALID', { category: CATEGORY.VALIDATION })
  }
  if (!TIER_MODELS.has(model) && Array.isArray(tiers) && tiers.length > 0) {
    throw finError('FIN_PRICE_MODEL_INVALID', { category: CATEGORY.VALIDATION })
  }
  if (!DIMENSION_MODELS.has(model) && Array.isArray(dimensions) && dimensions.length > 0) {
    throw finError('FIN_PRICE_MODEL_INVALID', { category: CATEGORY.VALIDATION })
  }
}

function denseTiers(tiers) {
  return tiers.map((tier, index) => ({
    tierNo: tier.tier_no ?? tier.tierNo ?? (index + 1),
    uptoUnits: tier.upto_units ?? tier.uptoUnits ?? null,
    rateMinor: tier.rate_minor ?? tier.rateMinor,
  }))
}

export async function createPrice(input) {
  const env = envelope(input)
  const code = input.code
  const currency = input.currency
  const meterId = input.meterId ?? input.meter_id ?? null
  const key = env.idempotencyKey || `PRICE_CREATE:${env.environment}:${code}`
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'CreatePrice', environment: env.environment, code, currency, meterId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const id = randomUUID()
    await client.query(
      `INSERT INTO fin.prices (
         id, environment, code, meter_id, currency,
         created_at, created_by_actor_type, created_by_actor_id,
         updated_at, updated_by_actor_type, updated_by_actor_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6,$7,$8)`,
      [id, env.environment, code, meterId, currency, env.now, env.actorType, env.actorId],
    )
    const header = (await client.query(`SELECT * FROM fin.prices WHERE id = $1`, [id])).rows[0]
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'PRICE_CREATED',
      targetType: 'PRICE',
      targetId: id,
      afterState: { code, currency, meterId },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.price.created',
      dedupeKey: `price:${id}`,
      payload: { id, code, currency },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'CreatePrice',
      id,
      version: Number(header.version),
    })
  })
}

export async function draftPriceVersion(input) {
  const env = envelope(input)
  const priceId = input.priceId ?? input.price_id
  const model = input.model
  const unitRateMinor = input.unit_rate_minor ?? input.unitRateMinor ?? null
  const packageSizeUnits = input.package_size_units ?? input.packageSizeUnits ?? null
  const tiers = input.tiers || []
  const dimensions = input.dimensions || []
  const effectiveFrom = iso(input.effective_from ?? input.effectiveFrom)
  const effectiveTo = input.effective_to ?? input.effectiveTo ?? null
  validateModelShape({ model, unitRateMinor, packageSizeUnits, tiers, dimensions })
  const key = env.idempotencyKey || nextKey(`PRICE_DRAFT:${priceId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'DraftPriceVersion', priceId, model, unitRateMinor, packageSizeUnits,
      tiers, dimensions, effectiveFrom, effectiveTo,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const header = await lockHeader(client, 'prices', priceId)
    if (!header) throw finError('FIN_PRICE_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    if (header.environment !== env.environment) {
      throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
    }
    assertIfMatch(header, env.expectedVersion)

    const maxN = (await client.query(
      `SELECT COALESCE(MAX(version_n), 0) AS n FROM fin.price_versions WHERE price_id = $1`,
      [priceId],
    )).rows[0].n
    const versionId = randomUUID()
    const versionN = Number(maxN) + 1
    try {
      await client.query(
        `INSERT INTO fin.price_versions (
           id, price_id, environment, version_n, model, unit_rate_minor,
           package_size_units, effective_from, effective_to, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT')`,
        [
          versionId, priceId, header.environment, versionN, model, unitRateMinor,
          packageSizeUnits, effectiveFrom, effectiveTo,
        ],
      )
    } catch (error) {
      mapExclusion(error, 'FIN_PRICE_VERSION_OVERLAP')
    }

    if (TIER_MODELS.has(model)) {
      const rows = denseTiers(tiers)
      for (let i = 0; i < rows.length; i += 1) {
        if (Number(rows[i].tierNo) !== i + 1) {
          throw finError('FIN_PRICE_MODEL_INVALID', { category: CATEGORY.VALIDATION })
        }
        await client.query(
          `INSERT INTO fin.price_tiers (
             id, price_version_id, environment, tier_no, upto_units, rate_minor
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), versionId, header.environment, rows[i].tierNo, rows[i].uptoUnits, rows[i].rateMinor],
        )
      }
    }
    if (DIMENSION_MODELS.has(model)) {
      for (const dim of dimensions) {
        await client.query(
          `INSERT INTO fin.price_dimensions (
             id, price_version_id, environment, dimension_kind, dimension_value, unit_rate_minor
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            randomUUID(), versionId, header.environment,
            dim.dimension_kind ?? dim.dimensionKind,
            dim.dimension_value ?? dim.dimensionValue,
            dim.unit_rate_minor ?? dim.unitRateMinor,
          ],
        )
      }
    }

    const bumped = await bumpHeader(client, {
      table: 'prices',
      id: priceId,
      expectedVersion: header.version,
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'PRICE_VERSION_DRAFTED',
      targetType: 'PRICE_VERSION',
      targetId: versionId,
      afterState: { priceId, model, versionN },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.price.version',
      dedupeKey: `pv:${versionId}:DRAFT`,
      payload: { id: versionId, priceId, status: 'DRAFT' },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'DraftPriceVersion',
      id: versionId,
      priceId,
      version_n: versionN,
      version: Number(bumped.version),
    })
  })
}

async function supersedeActivePriceVersion(client, { priceId, successorFrom, now }) {
  const current = (await client.query(
    `SELECT * FROM fin.price_versions
      WHERE price_id = $1 AND status = 'ACTIVE'
      FOR UPDATE`,
    [priceId],
  )).rows[0]
  if (!current) return null
  if (new Date(successorFrom) <= new Date(current.effective_from)) {
    throw finError('FIN_PRICE_VERSION_OVERLAP', { category: CATEGORY.CONFLICT, httpStatus: 409 })
  }
  try {
    await client.query(
      `UPDATE fin.price_versions
          SET status = 'SUPERSEDED', effective_to = $2
        WHERE id = $1 AND status = 'ACTIVE'`,
      [current.id, successorFrom],
    )
  } catch (error) {
    mapExclusion(error, 'FIN_PRICE_VERSION_OVERLAP')
  }
  return current
}

export async function activatePriceVersion(input) {
  const env = envelope(input)
  const priceId = input.priceId ?? input.price_id
  const priceVersionId = input.priceVersionId ?? input.price_version_id
  const approvalRequestId = input.approvalRequestId ?? input.approval_request_id ?? null
  const key = env.idempotencyKey || nextKey(`PRICE_ACTIVATE:${priceVersionId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'ActivatePriceVersion', priceVersionId, approvalRequestId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const header = await lockHeader(client, 'prices', priceId)
    if (!header) throw finError('FIN_PRICE_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    assertIfMatch(header, env.expectedVersion)

    const version = (await client.query(
      `SELECT * FROM fin.price_versions WHERE id = $1 AND price_id = $2 FOR UPDATE`,
      [priceVersionId, priceId],
    )).rows[0]
    if (!version) {
      throw finError('FIN_PRICE_VERSION_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    }
    if (version.status !== 'DRAFT') {
      throw finError('FIN_PRICE_VERSION_NOT_DRAFT', { category: CATEGORY.PRECONDITION, httpStatus: 409 })
    }

    await requireBackdatedApproval(client, {
      approvalRequestId,
      now: env.now,
      effectiveFrom: version.effective_from,
    })
    await supersedeActivePriceVersion(client, {
      priceId,
      successorFrom: version.effective_from,
      now: env.now,
    })
    try {
      await client.query(
        `UPDATE fin.price_versions SET status = 'ACTIVE' WHERE id = $1 AND status = 'DRAFT'`,
        [priceVersionId],
      )
    } catch (error) {
      mapExclusion(error, 'FIN_PRICE_VERSION_OVERLAP')
    }

    const bumped = await bumpHeader(client, {
      table: 'prices',
      id: priceId,
      expectedVersion: header.version,
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'PRICE_VERSION_ACTIVATED',
      targetType: 'PRICE_VERSION',
      targetId: priceVersionId,
      afterState: { status: 'ACTIVE', approvalRequestId },
      reasonCode: env.reasonCode,
      approvalRequestId,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.price.version',
      dedupeKey: `pv:${priceVersionId}:ACTIVE`,
      payload: { id: priceVersionId, priceId, status: 'ACTIVE' },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'ActivatePriceVersion',
      id: priceVersionId,
      priceId,
      status: 'ACTIVE',
      version: Number(bumped.version),
    })
  })
}

export async function deprecatePriceVersion(input) {
  const env = envelope(input)
  const priceId = input.priceId ?? input.price_id
  const priceVersionId = input.priceVersionId ?? input.price_version_id
  const key = env.idempotencyKey || nextKey(`PRICE_DEPRECATE:${priceVersionId}`)
  return withRetry(async (client) => {
    const claimed = await claim(client, env, key, {
      cmd: 'DeprecatePriceVersion', priceVersionId,
    })
    if (claimed.kind === 'replay') return claimed.row.response_body

    const header = await lockHeader(client, 'prices', priceId)
    if (!header) throw finError('FIN_PRICE_NOT_FOUND', { category: CATEGORY.PRECONDITION, httpStatus: 404 })
    assertIfMatch(header, env.expectedVersion)

    const version = (await client.query(
      `SELECT * FROM fin.price_versions WHERE id = $1 AND price_id = $2 FOR UPDATE`,
      [priceVersionId, priceId],
    )).rows[0]
    if (!version || version.status !== 'ACTIVE') {
      throw finError('FIN_PRICE_VERSION_NOT_DRAFT', { category: CATEGORY.PRECONDITION, httpStatus: 409 })
    }
    await client.query(
      `UPDATE fin.price_versions
          SET effective_to = $2
        WHERE id = $1 AND status = 'ACTIVE'`,
      [priceVersionId, env.now],
    )
    const bumped = await bumpHeader(client, {
      table: 'prices',
      id: priceId,
      expectedVersion: header.version,
      now: env.now,
      actorType: env.actorType,
      actorId: env.actorId,
    })
    await insertAudit(client, {
      environment: env.environment,
      actorType: env.actorType,
      actorId: env.actorId,
      actorEmail: env.actorEmail,
      action: 'PRICE_VERSION_DEPRECATED',
      targetType: 'PRICE_VERSION',
      targetId: priceVersionId,
      afterState: { status: 'ACTIVE', effective_to: env.now },
      reasonCode: env.reasonCode,
      now: env.now,
    })
    await insertOutbox(client, {
      environment: env.environment,
      topic: 'fin.price.version',
      dedupeKey: `pv:${priceVersionId}:deprecated`,
      payload: { id: priceVersionId, priceId, effective_to: env.now },
      now: env.now,
    })
    return finish(client, claimed, env, {
      command: 'DeprecatePriceVersion',
      id: priceVersionId,
      priceId,
      status: 'ACTIVE',
      version: Number(bumped.version),
    })
  })
}

export async function getPrice(client, id) {
  const header = (await client.query(`SELECT * FROM fin.prices WHERE id = $1`, [id])).rows[0]
  if (!header) return null
  const versions = (await client.query(
    `SELECT * FROM fin.price_versions WHERE price_id = $1 ORDER BY version_n`,
    [id],
  )).rows
  return { ...header, versions }
}

export async function listPrices(client, { environment = 'LIVE' } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM fin.prices WHERE environment = $1 ORDER BY code`,
    [environment],
  )
  return rows
}
