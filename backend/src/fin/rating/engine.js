/**
 * Rating engine: fin.metered_usage → fin.rated_usage.
 * Facts only (DL-007). APPEND_ONLY via adjustment_of_id (never UPDATE).
 * Does not write ledger_transactions / postings (C §6).
 */
import { randomUUID } from 'node:crypto'
import { transaction } from '../../db.js'
import { BusinessClock } from '../clock.js'
import { CATEGORY, finError } from '../errors.js'
import { FIN_RATING } from '../foundation/advisory-locks.js'
import { insertAudit, insertOutbox } from '../ledger/write.js'
import { sha256Canonical } from '../metering/hash.js'

const LATE_CLASS_STAGE_5 = 'OPEN_PERIOD'
const PRICE_COMPONENT_TYPES = ['METER_PRICE', 'OVERAGE_PRICE']
const DIMENSION_KEY = {
  CHANNEL: 'channel',
  TERRITORY: 'territory',
  SEGMENT: 'segment',
  WHATSAPP_CATEGORY: 'whatsapp_category',
}

function iso(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function asUnits(value) {
  if (value == null || value === '') return 0n
  return BigInt(value)
}

function maxUnits(a, b) {
  return a > b ? a : b
}

function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) return 0n
  if (numerator <= 0n) return 0n
  return (numerator + denominator - 1n) / denominator
}

function billedUnits(measured, included) {
  const delta = measured - included
  return delta > 0n ? delta : 0n
}

function sortTiers(tiers) {
  return [...tiers].sort((a, b) => Number(a.tier_no) - Number(b.tier_no))
}

function sortDimensions(dims) {
  return [...dims].sort((a, b) => {
    const kind = String(a.dimension_kind).localeCompare(String(b.dimension_kind))
    if (kind !== 0) return kind
    return String(a.dimension_value).localeCompare(String(b.dimension_value))
  })
}

export function computeAmountMinor(model, {
  billableUnits, unitRateMinor, packageSizeUnits, tiers, dimensions, eventDimensions,
}) {
  const billable = asUnits(billableUnits)
  const unitRate = unitRateMinor == null ? null : asUnits(unitRateMinor)
  const packageSize = packageSizeUnits == null ? null : asUnits(packageSizeUnits)

  if (model === 'PER_UNIT' || model === 'INCLUDED_QUANTITY') {
    return billable * (unitRate ?? 0n)
  }
  if (model === 'FLAT') {
    return unitRate ?? 0n
  }
  if (model === 'PACKAGE') {
    if (!packageSize || packageSize <= 0n) return 0n
    return ceilDiv(billable, packageSize) * (unitRate ?? 0n)
  }
  if (model === 'GRADUATED_TIER') {
    let remaining = billable
    let prev = 0n
    let total = 0n
    for (const tier of sortTiers(tiers)) {
      if (remaining <= 0n) break
      const upto = tier.upto_units == null ? null : asUnits(tier.upto_units)
      const width = upto == null ? remaining : maxUnits(0n, upto - prev)
      const slice = remaining < width ? remaining : width
      total += slice * asUnits(tier.rate_minor)
      remaining -= slice
      if (upto != null) prev = upto
      else break
    }
    return total
  }
  if (model === 'VOLUME_TIER') {
    const sorted = sortTiers(tiers)
    let chosen = null
    for (const tier of sorted) {
      if (tier.upto_units == null || billable <= asUnits(tier.upto_units)) {
        chosen = tier
        break
      }
    }
    if (!chosen) return 0n
    return billable * asUnits(chosen.rate_minor)
  }
  if (model === 'DIMENSIONAL') {
    const matches = []
    for (const dim of dimensions) {
      if (dimensionMatches(dim, eventDimensions)) matches.push(dim)
    }
    const ordered = sortDimensions(matches)
    if (ordered.length > 0) {
      return billable * asUnits(ordered[0].unit_rate_minor)
    }
    return billable * (unitRate ?? 0n)
  }
  throw finError('FIN_PRICE_MODEL_INVALID', { category: CATEGORY.VALIDATION })
}

function dimensionMatches(dim, eventDimensions) {
  const kind = dim.dimension_kind
  const want = String(dim.dimension_value)
  if (kind === 'RESIDENCY_KEY') {
    return String(eventDimensions.residency_key || '') === want
  }
  const key = DIMENSION_KEY[kind]
  if (!key) return false
  const got = eventDimensions.dimensions?.[key]
  return got != null && String(got) === want
}

function ratingPayload({
  meteredUsageId, meteredUsageStatus, contractVersionId, priceVersionId,
  priceVersionN, model, unitRateMinor, packageSizeUnits, tiers, dimensions,
  measuredUnits, includedUnits, billableUnits, amountMinor,
}) {
  const payload = {
    meteredUsageId: String(meteredUsageId),
    meteredUsageStatus: String(meteredUsageStatus),
    contractVersionId: String(contractVersionId),
    priceVersionId: String(priceVersionId),
    priceVersionN: Number(priceVersionN),
    model: String(model),
    tiers: sortTiers(tiers).map((tier) => ({
      rate_minor: asUnits(tier.rate_minor).toString(),
      tier_no: Number(tier.tier_no),
      upto_units: tier.upto_units == null ? null : asUnits(tier.upto_units).toString(),
    })),
    dimensions: sortDimensions(dimensions).map((dim) => ({
      dimension_kind: String(dim.dimension_kind),
      dimension_value: String(dim.dimension_value),
      unit_rate_minor: asUnits(dim.unit_rate_minor).toString(),
    })),
    measured_units: asUnits(measuredUnits).toString(),
    included_units: asUnits(includedUnits).toString(),
    billable_units: asUnits(billableUnits).toString(),
    amount_minor: asUnits(amountMinor).toString(),
  }
  if (unitRateMinor != null && unitRateMinor !== '') {
    payload.unit_rate_minor = asUnits(unitRateMinor).toString()
  }
  if (packageSizeUnits != null && packageSizeUnits !== '') {
    payload.package_size_units = asUnits(packageSizeUnits).toString()
  }
  return payload
}

async function loadMeteredUsage(client, meteredUsageId) {
  const { rows } = await client.query(
    `SELECT m.*, v.meter_id
       FROM fin.metered_usage m
       JOIN fin.meter_versions v ON v.id = m.meter_version_id
      WHERE m.id = $1
      FOR UPDATE OF m`,
    [meteredUsageId],
  )
  return rows[0] || null
}

async function loadEventContext(client, meteredUsageId) {
  const { rows } = await client.query(
    `SELECT e.occurred_at, e.received_at, e.dimensions, e.residency_key, e.id
       FROM fin.metered_usage_sources s
       JOIN fin.usage_events e
         ON e.id = s.usage_event_id AND e.residency_key = s.residency_key
      WHERE s.metered_usage_id = $1
      ORDER BY e.occurred_at DESC, e.id DESC`,
    [meteredUsageId],
  )
  if (!rows.length) {
    return {
      occurredAt: null,
      receivedAt: null,
      eventDimensions: { dimensions: {}, residency_key: null },
    }
  }
  let occurredAt = rows[0].occurred_at
  let receivedAt = rows[0].received_at
  for (const row of rows) {
    if (row.occurred_at < occurredAt) occurredAt = row.occurred_at
    if (row.received_at > receivedAt) receivedAt = row.received_at
  }
  const latest = rows[0]
  return {
    occurredAt,
    receivedAt,
    eventDimensions: {
      dimensions: latest.dimensions || {},
      residency_key: latest.residency_key,
    },
  }
}

async function resolveContractVersion(client, {
  environment, tenantId, holderId, meteredAt, meterId, contractVersionId,
}) {
  if (contractVersionId) {
    const { rows } = await client.query(
      `SELECT cv.*, c.billing_currency, c.tenant_id, c.id AS contract_id
         FROM fin.contract_versions cv
         JOIN fin.contracts c ON c.id = cv.contract_id
        WHERE cv.id = $1`,
      [contractVersionId],
    )
    const row = rows[0]
    if (!row || row.tenant_id !== tenantId || row.environment !== environment) {
      throw finError('FIN_NO_ACTIVE_CONTRACT', { category: CATEGORY.PRECONDITION })
    }
    if (row.status !== 'ACTIVE') {
      throw finError('FIN_NO_ACTIVE_CONTRACT', { category: CATEGORY.PRECONDITION })
    }
    return row
  }

  const { rows } = await client.query(
    `SELECT cv.*, c.billing_currency, c.tenant_id, c.id AS contract_id,
            EXISTS (
              SELECT 1 FROM fin.contract_components cc
               WHERE cc.contract_version_id = cv.id
                 AND cc.component_type = ANY($5::text[])
                 AND cc.meter_id = $6
            ) AS has_meter_price
       FROM fin.contract_versions cv
       JOIN fin.contracts c ON c.id = cv.contract_id
       JOIN fin.billing_accounts ba ON ba.id = c.billing_account_id
      WHERE cv.status = 'ACTIVE'
        AND c.tenant_id = $1
        AND c.environment = $2
        AND ba.holder_id = $3
        AND cv.effective_from <= $4::timestamptz
        AND (cv.effective_to IS NULL OR cv.effective_to > $4::timestamptz)
      ORDER BY has_meter_price DESC, c.id ASC, cv.id ASC`,
    [tenantId, environment, holderId, meteredAt, PRICE_COMPONENT_TYPES, meterId],
  )
  if (!rows.length) {
    throw finError('FIN_NO_ACTIVE_CONTRACT', { category: CATEGORY.PRECONDITION })
  }
  return rows[0]
}

async function resolveIncludedUnits(client, { contractVersionId, meterId, model, packageSizeUnits }) {
  const { rows } = await client.query(
    `SELECT config->>'included_units' AS included_units
       FROM fin.contract_components
      WHERE contract_version_id = $1
        AND component_type = 'INCLUDED_ALLOWANCE'
        AND meter_id = $2`,
    [contractVersionId, meterId],
  )
  let included = 0n
  for (const row of rows) {
    included = maxUnits(included, asUnits(row.included_units))
  }
  if (model === 'INCLUDED_QUANTITY' && packageSizeUnits != null && packageSizeUnits !== '') {
    included = maxUnits(included, asUnits(packageSizeUnits))
  }
  return included
}

async function resolvePriceVersion(client, {
  environment, contractVersionId, meterId, meteredAt, priceVersionId,
}) {
  if (priceVersionId) {
    const { rows } = await client.query(
      `SELECT pv.*, p.currency AS price_currency
         FROM fin.price_versions pv
         JOIN fin.prices p ON p.id = pv.price_id
        WHERE pv.id = $1`,
      [priceVersionId],
    )
    const row = rows[0]
    if (!row || row.environment !== environment || row.status !== 'ACTIVE') {
      throw finError('FIN_NO_ACTIVE_PRICE', { category: CATEGORY.PRECONDITION })
    }
    return row
  }

  const component = (await client.query(
    `SELECT cc.price_id, cc.component_type
       FROM fin.contract_components cc
      WHERE cc.contract_version_id = $1
        AND cc.component_type = ANY($2::text[])
        AND cc.meter_id = $3
      ORDER BY CASE cc.component_type WHEN 'METER_PRICE' THEN 0 ELSE 1 END, cc.id`,
    [contractVersionId, PRICE_COMPONENT_TYPES, meterId],
  )).rows[0]
  if (!component?.price_id) {
    throw finError('FIN_NO_ACTIVE_PRICE', { category: CATEGORY.PRECONDITION })
  }

  const { rows } = await client.query(
    `SELECT pv.*, p.currency AS price_currency
       FROM fin.price_versions pv
       JOIN fin.prices p ON p.id = pv.price_id
      WHERE pv.price_id = $1
        AND pv.status = 'ACTIVE'
        AND pv.environment = $2
        AND pv.effective_from <= $3::timestamptz
        AND (pv.effective_to IS NULL OR pv.effective_to > $3::timestamptz)`,
    [component.price_id, environment, meteredAt],
  )
  if (!rows.length) {
    throw finError('FIN_NO_ACTIVE_PRICE', { category: CATEGORY.PRECONDITION })
  }
  return rows[0]
}

async function loadPriceChildren(client, priceVersionId) {
  const tiers = (await client.query(
    `SELECT tier_no, upto_units, rate_minor
       FROM fin.price_tiers
      WHERE price_version_id = $1
      ORDER BY tier_no`,
    [priceVersionId],
  )).rows
  const dimensions = (await client.query(
    `SELECT dimension_kind, dimension_value, unit_rate_minor
       FROM fin.price_dimensions
      WHERE price_version_id = $1
      ORDER BY dimension_kind, dimension_value`,
    [priceVersionId],
  )).rows
  return { tiers, dimensions }
}

function successBody({
  row, amountMinor, billableUnits, ratingHash, priceVersionId, contractVersionId,
  adjustmentOf, deduped,
}) {
  return {
    ok: true,
    ratedUsageId: row,
    amountMinor: Number(amountMinor),
    billableUnits: Number(billableUnits),
    ratingHash,
    priceVersionId,
    contractVersionId,
    ...(adjustmentOf ? { adjustmentOf } : {}),
    ...(deduped ? { deduped: true } : {}),
  }
}

export async function rateMeteredUsage({
  environment,
  meteredUsageId,
  contractVersionId: contractVersionOverride,
  priceVersionId: priceVersionOverride,
  now,
  actorType,
  actorId,
  actorEmail,
} = {}) {
  const clock = iso(now || BusinessClock.now())
  const actor = actorType || 'WORKER'
  const email = actorEmail || 'system@fin.local'

  return transaction(async (client) => {
    const locked = await client.query(
      'SELECT pg_try_advisory_lock($1, hashtext($2::text)) AS ok',
      [FIN_RATING, meteredUsageId],
    )
    if (!locked.rows[0].ok) {
      return { ok: false, error_code: 'RATING_LOCK_HELD' }
    }

    try {
      const metered = await loadMeteredUsage(client, meteredUsageId)
      if (!metered) {
        throw finError('FIN_METERED_USAGE_NOT_FOUND', { category: CATEGORY.PRECONDITION })
      }
      if (metered.environment !== environment) {
        throw finError('ENV_MISMATCH', { category: CATEGORY.VALIDATION })
      }
      if (metered.status !== 'ACTIVE') {
        throw finError('FIN_METERED_USAGE_NOT_ACTIVE', { category: CATEGORY.PRECONDITION })
      }

      const contract = await resolveContractVersion(client, {
        environment,
        tenantId: metered.tenant_id,
        holderId: metered.holder_id,
        meteredAt: metered.metered_at,
        meterId: metered.meter_id,
        contractVersionId: contractVersionOverride,
      })
      const price = await resolvePriceVersion(client, {
        environment,
        contractVersionId: contract.id,
        meterId: metered.meter_id,
        meteredAt: metered.metered_at,
        priceVersionId: priceVersionOverride,
      })
      const { tiers, dimensions } = await loadPriceChildren(client, price.id)
      const { occurredAt, receivedAt, eventDimensions } = await loadEventContext(client, meteredUsageId)

      const measuredUnits = asUnits(metered.quantity_units)
      const includedUnits = await resolveIncludedUnits(client, {
        contractVersionId: contract.id,
        meterId: metered.meter_id,
        model: price.model,
        packageSizeUnits: price.package_size_units,
      })
      const billableUnits = billedUnits(measuredUnits, includedUnits)
      const amountMinor = computeAmountMinor(price.model, {
        billableUnits,
        unitRateMinor: price.unit_rate_minor,
        packageSizeUnits: price.package_size_units,
        tiers,
        dimensions,
        eventDimensions,
      })

      const payload = ratingPayload({
        meteredUsageId: metered.id,
        meteredUsageStatus: metered.status,
        contractVersionId: contract.id,
        priceVersionId: price.id,
        priceVersionN: price.version_n,
        model: price.model,
        unitRateMinor: price.unit_rate_minor,
        packageSizeUnits: price.package_size_units,
        tiers,
        dimensions,
        measuredUnits,
        includedUnits,
        billableUnits,
        amountMinor,
      })
      const ratingHash = sha256Canonical(payload)

      const existing = (await client.query(
        `SELECT id, rating_hash, adjustment_of_id
           FROM fin.rated_usage
          WHERE metered_usage_id = $1 AND environment = $2
          ORDER BY rated_at ASC, id ASC
          FOR UPDATE`,
        [meteredUsageId, environment],
      )).rows
      const original = existing.find((row) => row.adjustment_of_id == null) || null
      const hit = existing.find((row) => row.rating_hash === ratingHash)
      if (hit) {
        return successBody({
          row: hit.id,
          amountMinor,
          billableUnits,
          ratingHash,
          priceVersionId: price.id,
          contractVersionId: contract.id,
          adjustmentOf: hit.adjustment_of_id || undefined,
          deduped: true,
        })
      }

      const ratedUsageId = randomUUID()
      const adjustmentOf = original ? original.id : null
      await client.query(
        `INSERT INTO fin.rated_usage (
           id, environment, tenant_id, metered_usage_id, contract_version_id,
           price_version_id, billing_period_id, accounting_period_id,
           measured_units, included_units, billable_units, amount_minor, currency,
           rating_hash, explanation, late_class,
           occurred_at, received_at, metered_at, rated_at,
           accounting_effective_period, adjustment_of_id, created_at
         ) VALUES (
           $1,$2,$3,$4,$5,
           $6,NULL,NULL,
           $7,$8,$9,$10,$11,
           $12,$13::jsonb,$14,
           $15,$16,$17,$18,
           NULL,$19,$18
         )`,
        [
          ratedUsageId, environment, metered.tenant_id, metered.id, contract.id,
          price.id,
          measuredUnits.toString(), includedUnits.toString(), billableUnits.toString(),
          amountMinor.toString(), contract.billing_currency,
          ratingHash, JSON.stringify(payload), LATE_CLASS_STAGE_5,
          iso(occurredAt || metered.metered_at),
          iso(receivedAt || metered.metered_at),
          iso(metered.metered_at),
          clock,
          adjustmentOf,
        ],
      )

      await insertOutbox(client, {
        environment,
        topic: 'fin.rating.completed',
        dedupeKey: `rating:${meteredUsageId}:${ratingHash}`,
        payload: {
          rated_usage_id: ratedUsageId,
          metered_usage_id: meteredUsageId,
          amount_minor: amountMinor.toString(),
          billable_units: billableUnits.toString(),
          rating_hash: ratingHash,
          price_version_id: price.id,
          contract_version_id: contract.id,
          adjustment_of_id: adjustmentOf,
        },
        now: clock,
      })
      await insertAudit(client, {
        environment,
        actorType: actor,
        actorId: actorId || null,
        actorEmail: email,
        action: 'RATED',
        targetType: 'RATED_USAGE',
        targetId: ratedUsageId,
        afterState: {
          meteredUsageId,
          amountMinor: amountMinor.toString(),
          billableUnits: billableUnits.toString(),
          ratingHash,
          lateClass: LATE_CLASS_STAGE_5,
          ...(adjustmentOf ? { adjustmentOf } : {}),
        },
        reasonCode: 'RATED',
        now: clock,
      })

      return successBody({
        row: ratedUsageId,
        amountMinor,
        billableUnits,
        ratingHash,
        priceVersionId: price.id,
        contractVersionId: contract.id,
        adjustmentOf,
      })
    } finally {
      await client.query(
        'SELECT pg_advisory_unlock($1, hashtext($2::text))',
        [FIN_RATING, meteredUsageId],
      )
    }
  })
}
