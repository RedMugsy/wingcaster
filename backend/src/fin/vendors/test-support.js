import { randomUUID } from 'node:crypto'
import { NOW } from '../testing/seed.js'
import {
  activateRateVersion, createRateCard, createVendor, draftRateVersion,
  mapMeterVendor, upsertVendorProduct,
} from './registry.js'
import { ingestVendorUsageEvent, upsertReportedUsage } from './usage-ingest.js'
import { addStatementLine, createStatement, receiveStatement } from './statement-ingest.js'
import { finalizeStatement, reconcileStatement } from './reconciliation.js'

export const PERIOD_KEY = '2026-08'

export function vendorEnv(world, extra = {}) {
  return {
    environment: 'LIVE',
    reasonCode: extra.reasonCode || 'TEST',
    actorType: extra.actorType || 'SYSTEM',
    now: world?.now || NOW,
    ...extra,
  }
}

export async function seedVendorWorld(world, {
  name = `vendor-${randomUUID()}`,
  productCode = 'sku.maps',
  productClass = 'GEO',
  unitCostMinor = 17,
  currency = 'USD',
  meterId = null,
  effectiveFrom = NOW,
} = {}) {
  const vendor = await createVendor(vendorEnv(world, { name, currency }))
  const product = await upsertVendorProduct(vendorEnv(world, {
    vendorId: vendor.id,
    productCode,
    productClass,
  }))
  const card = await createRateCard(vendorEnv(world, {
    vendorId: vendor.id,
    name: `${name}-card`,
  }))
  const draft = await draftRateVersion(vendorEnv(world, {
    rateCardId: card.id,
    rates: { [productCode]: { unit_cost_minor: unitCostMinor, currency } },
    effective_from: effectiveFrom,
  }))
  await activateRateVersion(vendorEnv(world, {
    rateCardId: card.id,
    rateVersionId: draft.id,
  }))
  let mapId = null
  if (meterId) {
    const mapped = await mapMeterVendor(vendorEnv(world, {
      meterId,
      vendorId: vendor.id,
      vendorProductCode: productCode,
    }))
    mapId = mapped.id
  }
  return {
    vendorId: vendor.id,
    productId: product.id,
    productCode,
    rateCardId: card.id,
    rateVersionId: draft.id,
    unitCostMinor,
    currency,
    mapId,
  }
}

export async function closeMatchingStatement(world, seeded, {
  quantityUnits,
  occurredAt = NOW,
  tenantId = null,
  holderId = null,
  sourceEventId = randomUUID(),
  hints,
  finalize = true,
} = {}) {
  const qty = quantityUnits
  const amount = BigInt(qty) * BigInt(seeded.unitCostMinor)
  await ingestVendorUsageEvent(vendorEnv(world, {
    vendorId: seeded.vendorId,
    vendorProductCode: seeded.productCode,
    quantityUnits: qty,
    occurredAt,
    sourceEventId,
    tenantId,
    holderId,
  }))
  await upsertReportedUsage(vendorEnv(world, {
    vendorId: seeded.vendorId,
    vendorProductCode: seeded.productCode,
    reportingPeriodKey: PERIOD_KEY,
    quantityUnits: qty,
    currency: seeded.currency,
  }))
  const statement = await createStatement(vendorEnv(world, {
    vendorId: seeded.vendorId,
    statementPeriodKey: PERIOD_KEY,
    currency: seeded.currency,
  }))
  await addStatementLine(vendorEnv(world, {
    statementId: statement.id,
    productCode: seeded.productCode,
    quantityUnits: qty,
    unitCostMinor: seeded.unitCostMinor,
    amountMinor: amount.toString(),
  }))
  await receiveStatement(vendorEnv(world, { statementId: statement.id }))
  const recon = await reconcileStatement(vendorEnv(world, {
    statementId: statement.id,
    hints,
  }))
  let final = null
  if (finalize) {
    final = await finalizeStatement(vendorEnv(world, { statementId: statement.id }))
  }
  return { statementId: statement.id, recon, final, amountMinor: amount.toString() }
}
