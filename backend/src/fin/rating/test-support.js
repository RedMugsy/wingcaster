import { randomUUID } from 'node:crypto'
import { NOW } from '../testing/seed.js'
import { ingestUsageEvent } from '../usage/ingest.js'
import { meterPeriod } from '../metering/pipeline.js'
import {
  countUsageByEventType, meterInput, seedIsolatedMeter, usagePayload,
} from '../metering/test-support.js'
import { activatePriceVersion, createPrice, draftPriceVersion } from '../pricing/prices.js'
import {
  activateContractVersion, createContract, draftContractVersion,
} from '../pricing/contracts.js'

export { countUsageByEventType, usagePayload }

function priceEnv(world, extra = {}) {
  return {
    environment: 'LIVE',
    reasonCode: 'TEST',
    actorType: 'SYSTEM',
    now: world.now || NOW,
    ...extra,
  }
}

export async function seedIsolatedHolder(client, world, { label } = {}) {
  const holderId = randomUUID()
  const billingAccountId = randomUUID()
  const suffix = label || randomUUID()
  await client.query(
    `INSERT INTO fin.holders (
       id, environment, tenant_id, holder_kind, display_name, parent_holder_id,
       created_at, updated_at
     ) VALUES ($1, 'LIVE', $2, 'ORGANISATIONAL_NODE', $3, $4, $5, $5)`,
    [holderId, world.tenantA.tenantId, `rating-${suffix}`, world.tenantA.holderId, NOW],
  )
  await client.query(
    `INSERT INTO fin.billing_accounts (
       id, environment, tenant_id, holder_id, seller_legal_entity_id,
       billing_currency, billing_timezone, invoice_delivery, created_at, updated_at
     ) VALUES ($1, 'LIVE', $2, $3, $4, 'USD', 'Asia/Riyadh', 'EMAIL', $5, $5)`,
    [billingAccountId, world.tenantA.tenantId, holderId, world.legalEntityId, NOW],
  )
  return { holderId, billingAccountId }
}

export async function seedRatedCase(pool, world, {
  label,
  aggregationType = 'COUNT',
  eventCount = 4,
  quantityUnits = 1,
  model = 'PER_UNIT',
  unitRateMinor = 10,
  packageSizeUnits = null,
  tiers = [],
  dimensions = [],
  includedUnits = 0,
  skipContract = false,
  skipPriceComponent = false,
  eventDimensions,
  extraComponents = [],
} = {}) {
  const { holderId, billingAccountId } = await seedIsolatedHolder(pool, world, { label })
  const { meterId, meterVersionId, eventType } = await seedIsolatedMeter(pool, {
    label,
    aggregationType,
  })
  for (let i = 0; i < eventCount; i += 1) {
    await ingestUsageEvent(usagePayload(world, {
      eventType,
      holderId,
      quantityUnits,
      ...(eventDimensions ? { dimensions: eventDimensions } : {}),
    }))
  }
  const n = await countUsageByEventType(pool, eventType)
  const metered = await meterPeriod(meterInput(world, {
    meterVersionId,
    extra: { holderId },
  }))

  const price = await createPrice(priceEnv(world, {
    code: `rt.${label}.${randomUUID()}`,
    currency: 'USD',
    meterId,
  }))
  const draftArgs = {
    priceId: price.id,
    model,
    effective_from: NOW,
  }
  if (unitRateMinor != null) draftArgs.unit_rate_minor = unitRateMinor
  if (packageSizeUnits != null) draftArgs.package_size_units = packageSizeUnits
  if (tiers.length) draftArgs.tiers = tiers
  if (dimensions.length) draftArgs.dimensions = dimensions
  const pv = await draftPriceVersion(priceEnv(world, draftArgs))
  await activatePriceVersion(priceEnv(world, {
    priceId: price.id,
    priceVersionId: pv.id,
  }))

  let contractId = null
  let contractVersionId = null
  if (!skipContract) {
    const contract = await createContract({
      ...priceEnv(world),
      tenantId: world.tenantA.tenantId,
      billingAccountId,
      sellerLegalEntityId: world.legalEntityId,
      contractNumber: `RT-${label}-${randomUUID()}`,
      billingCurrency: 'USD',
      billingTimezone: 'Asia/Riyadh',
    })
    const components = [...extraComponents]
    if (!skipPriceComponent) {
      components.push({
        component_type: 'METER_PRICE',
        priceId: price.id,
        meterId,
      })
    }
    if (includedUnits) {
      components.push({
        component_type: 'INCLUDED_ALLOWANCE',
        meterId,
        config: { included_units: includedUnits },
      })
    }
    const cv = await draftContractVersion({
      ...priceEnv(world),
      tenantId: world.tenantA.tenantId,
      contractId: contract.id,
      effective_from: NOW,
      components,
    })
    await activateContractVersion({
      ...priceEnv(world),
      tenantId: world.tenantA.tenantId,
      contractId: contract.id,
      contractVersionId: cv.id,
    })
    contractId = contract.id
    contractVersionId = cv.id
  }

  return {
    holderId,
    billingAccountId,
    meterId,
    meterVersionId,
    eventType,
    eventCount: n,
    meteredUsageId: metered.meteredUsageId,
    quantityUnits: metered.quantityUnits,
    priceId: price.id,
    priceVersionId: pv.id,
    contractId,
    contractVersionId,
  }
}

export function rateInput(seeded, extra = {}) {
  return {
    environment: 'LIVE',
    meteredUsageId: seeded.meteredUsageId,
    now: NOW,
    actorType: 'WORKER',
    actorEmail: 'rating@fin.local',
    ...extra,
  }
}
