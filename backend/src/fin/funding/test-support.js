import { randomUUID } from 'node:crypto'
import { commandEnv, NOW } from '../testing/seed.js'
import { createCreditProduct } from './products.js'

export { NOW }

export function sampleProduct(overrides = {}) {
  return {
    id: overrides.id || randomUUID(),
    code: overrides.code || 'pack.100',
    name: overrides.name || 'Pack 100',
    units: overrides.units ?? 100,
    bonus_units: overrides.bonus_units ?? 10,
    price_minor: overrides.price_minor ?? 5000,
    currency: overrides.currency || 'USD',
    effective_from: overrides.effective_from || '2020-01-01T00:00:00.000Z',
    effective_to: overrides.effective_to ?? null,
    active: overrides.active !== false,
    ...overrides,
  }
}

export function fundingEnv(world, extra = {}) {
  return {
    ...commandEnv(world, extra),
    tenantId: world.tenantA.tenantId,
    holderId: extra.holderId || world.tenantA.holderId,
    billingAccountId: extra.billingAccountId || world.tenantA.billingAccountId,
    now: extra.now || world.now || NOW,
    reasonCode: extra.reasonCode || 'TEST',
    actorType: extra.actorType || 'USER',
  }
}

export async function seedProduct(world, extra = {}) {
  const code = extra.code || `pack.${randomUUID().slice(0, 8)}`
  const created = await createCreditProduct({
    ...fundingEnv(world),
    actorType: 'SYSTEM',
    reasonCode: extra.reasonCode || 'TEST',
    code,
    name: extra.name || code,
    units: extra.units ?? 100,
    bonus_units: extra.bonus_units ?? 10,
    price_minor: extra.price_minor ?? 5000,
    currency: extra.currency || 'USD',
    effective_from: extra.effective_from || '2020-01-01T00:00:00.000Z',
    effective_to: extra.effective_to ?? null,
  })
  return created.id
}

export async function insertControls(client, {
  environment = 'LIVE',
  subjectType,
  subjectId,
  allowPurchases = true,
  now = NOW,
}) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO fin.account_controls (
       id, environment, subject_type, subject_id,
       allow_prepaid_usage, allow_postpaid_usage, allow_purchases,
       allow_transfers, allow_refunds, allow_grants,
       reason_code, created_at, updated_at
     ) VALUES ($1,$2,$3,$4, true, true, $5, true, true, true, 'TEST', $6, $6)`,
    [id, environment, subjectType, subjectId, allowPurchases, now],
  )
  return id
}

export async function insertAutoTopupPolicy(client, {
  environment = 'LIVE', tenantId, billingAccountId, holderId, productId,
  thresholdUnits = 50, cooldownSeconds = 3600, dailyCap = 3, monthlyCap = 10,
  failureThreshold = 3, enabled = true, now = NOW, cooldownUntil = null,
}) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO fin.auto_topup_policies (
       id, environment, tenant_id, billing_account_id, holder_id, product_id,
       enabled, threshold_units, cooldown_seconds, cooldown_until,
       daily_cap, monthly_cap, failure_threshold,
       created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
    [
      id, environment, tenantId, billingAccountId, holderId, productId,
      enabled, thresholdUnits, cooldownSeconds, cooldownUntil,
      dailyCap, monthlyCap, failureThreshold, now,
    ],
  )
  return id
}
