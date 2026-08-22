/**
 * Lazy per-tenant rating scaffold so historical consumption can land as
 * fin.rated_usage without inventing a live meter/price/contract UI.
 * Direct SQL, no outbox.
 */
import { randomUUID } from 'node:crypto'

const cache = new Map()

function cacheKey(environment, tenantId) {
  return `${environment}:${tenantId}`
}

export async function ensureBackfillRatingScaffold(client, {
  environment,
  tenantId,
  holderId,
  billingAccountId,
  legalEntityId,
  currency = 'USD',
  now,
} = {}) {
  const key = cacheKey(environment, tenantId)
  if (cache.has(key)) return cache.get(key)

  const meterCode = `cutover.backfill.${environment}`
  let meter = (await client.query(
    `SELECT m.id AS meter_id, v.id AS meter_version_id
       FROM fin.meters m
       JOIN fin.meter_versions v ON v.meter_id = m.id
      WHERE m.environment = $1 AND m.code = $2
      ORDER BY v.version_n DESC LIMIT 1`,
    [environment, meterCode],
  )).rows[0]
  if (!meter) {
    const meterId = randomUUID()
    const meterVersionId = randomUUID()
    await client.query(
      `INSERT INTO fin.meters (id, environment, code, name, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$5)
       ON CONFLICT (environment, code) DO NOTHING`,
      [meterId, environment, meterCode, 'Cutover backfill meter', now],
    )
    const existingMeter = (await client.query(
      `SELECT id FROM fin.meters WHERE environment = $1 AND code = $2`,
      [environment, meterCode],
    )).rows[0]
    const resolvedMeterId = existingMeter.id
    await client.query(
      `INSERT INTO fin.meter_versions (
         id, meter_id, environment, version_n, aggregation_type, filter_definition,
         effective_from
       ) VALUES ($1,$2,$3,1,'COUNT','{}'::jsonb,$4)
       ON CONFLICT (meter_id, version_n) DO NOTHING`,
      [meterVersionId, resolvedMeterId, environment, '2000-01-01T00:00:00.000Z'],
    )
    const existingVersion = (await client.query(
      `SELECT id FROM fin.meter_versions WHERE meter_id = $1 ORDER BY version_n DESC LIMIT 1`,
      [resolvedMeterId],
    )).rows[0]
    meter = { meter_id: resolvedMeterId, meter_version_id: existingVersion.id }
  }

  const priceCode = `cutover.backfill.${environment}`
  let price = (await client.query(
    `SELECT p.id AS price_id, v.id AS price_version_id
       FROM fin.prices p
       JOIN fin.price_versions v ON v.price_id = p.id
      WHERE p.environment = $1 AND p.code = $2 AND v.status = 'ACTIVE'
      ORDER BY v.version_n DESC LIMIT 1`,
    [environment, priceCode],
  )).rows[0]
  if (!price) {
    const priceId = randomUUID()
    const priceVersionId = randomUUID()
    await client.query(
      `INSERT INTO fin.prices (
         id, environment, code, meter_id, currency, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (environment, code) DO NOTHING`,
      [priceId, environment, priceCode, meter.meter_id, currency, now],
    )
    const existingPrice = (await client.query(
      `SELECT id FROM fin.prices WHERE environment = $1 AND code = $2`,
      [environment, priceCode],
    )).rows[0]
    await client.query(
      `INSERT INTO fin.price_versions (
         id, price_id, environment, version_n, model, unit_rate_minor,
         effective_from, status
       ) VALUES ($1,$2,$3,1,'PER_UNIT',0,$4,'ACTIVE')
       ON CONFLICT (price_id, version_n) DO NOTHING`,
      [priceVersionId, existingPrice.id, environment, '2000-01-01T00:00:00.000Z'],
    )
    const existingPv = (await client.query(
      `SELECT id FROM fin.price_versions WHERE price_id = $1 AND status = 'ACTIVE'
        ORDER BY version_n DESC LIMIT 1`,
      [existingPrice.id],
    )).rows[0]
    price = { price_id: existingPrice.id, price_version_id: existingPv.id }
  }

  const contractNumber = `CUTOVER-BF-${tenantId}`
  let contract = (await client.query(
    `SELECT c.id AS contract_id, v.id AS contract_version_id, c.billing_currency
       FROM fin.contracts c
       JOIN fin.contract_versions v ON v.contract_id = c.id
      WHERE c.tenant_id = $1 AND c.contract_number = $2
        AND v.status = 'ACTIVE'
      ORDER BY v.version_n DESC LIMIT 1`,
    [tenantId, contractNumber],
  )).rows[0]
  if (!contract) {
    const contractId = randomUUID()
    const contractVersionId = randomUUID()
    await client.query(
      `INSERT INTO fin.contracts (
         id, environment, tenant_id, billing_account_id, seller_legal_entity_id,
         contract_number, status, billing_currency, billing_timezone,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'ACTIVE',$7,'UTC',$8,$8
       )
       ON CONFLICT (seller_legal_entity_id, contract_number) DO NOTHING`,
      [
        contractId, environment, tenantId, billingAccountId, legalEntityId,
        contractNumber, currency, now,
      ],
    )
    const existingContract = (await client.query(
      `SELECT id, billing_currency FROM fin.contracts
        WHERE seller_legal_entity_id = $1 AND contract_number = $2`,
      [legalEntityId, contractNumber],
    )).rows[0]
    await client.query(
      `INSERT INTO fin.contract_versions (
         id, contract_id, environment, version_n, effective_from, status
       ) VALUES ($1,$2,$3,1,$4,'ACTIVE')
       ON CONFLICT (contract_id, version_n) DO NOTHING`,
      [contractVersionId, existingContract.id, environment, '2000-01-01T00:00:00.000Z'],
    )
    const existingCv = (await client.query(
      `SELECT id FROM fin.contract_versions WHERE contract_id = $1 AND status = 'ACTIVE'
        ORDER BY version_n DESC LIMIT 1`,
      [existingContract.id],
    )).rows[0]
    contract = {
      contract_id: existingContract.id,
      contract_version_id: existingCv.id,
      billing_currency: existingContract.billing_currency,
    }
  }

  const scaffold = {
    meterId: meter.meter_id,
    meterVersionId: meter.meter_version_id,
    priceId: price.price_id,
    priceVersionId: price.price_version_id,
    contractId: contract.contract_id,
    contractVersionId: contract.contract_version_id,
    currency: contract.billing_currency || currency,
    holderId,
  }
  cache.set(key, scaffold)
  return scaffold
}

export function clearBackfillScaffoldCache() {
  cache.clear()
}
