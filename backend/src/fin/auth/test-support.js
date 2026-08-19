import { randomUUID } from 'node:crypto'
import { fundPurchase } from '../ledger/transactions.js'
import { seedIsolatedHolder } from '../rating/test-support.js'
import { commandEnv, NOW, seedBook } from '../testing/seed.js'

export { NOW }

export async function seedAuthHolder(pool, world, {
  label,
  units = 100,
} = {}) {
  const { holderId, billingAccountId } = await seedIsolatedHolder(pool, world, { label })
  const book = await seedBook(pool, {
    environment: 'LIVE',
    tenantId: world.tenantA.tenantId,
    billingAccountId,
  })
  const funded = await fundPurchase({
    ...commandEnv(world, { holderId, bookId: book.bookId }),
    purchaseIntentId: randomUUID(),
    paidUnits: units,
    bonusUnits: 0,
    considerationMinor: 1,
  })
  return {
    holderId,
    billingAccountId,
    bookId: book.bookId,
    lotId: funded.lotIds[0],
    tenantId: world.tenantA.tenantId,
    meterId: randomUUID(),
  }
}

export function authInput(world, seeded, extra = {}) {
  return {
    ...commandEnv(world, {
      holderId: seeded.holderId,
      bookId: seeded.bookId,
    }),
    meterId: seeded.meterId,
    now: world.now || NOW,
    ...extra,
  }
}

export async function insertApplicabilityRule(client, {
  lotId, environment = 'LIVE', ruleKind, matcher, now = NOW,
}) {
  await client.query(
    `INSERT INTO fin.lot_applicability_rules (
       id, lot_id, environment, rule_kind, matcher, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
    [randomUUID(), lotId, environment, ruleKind, matcher, now],
  )
}

export async function insertLimit(client, {
  tenantId, meterId, environment = 'LIVE', periodKind = 'MONTH',
  limitUnits, breachBehavior = 'BLOCK', consumedUnits = 0, periodKey = '2026-08',
  now = NOW,
}) {
  const usageLimitId = randomUUID()
  await client.query(
    `INSERT INTO fin.usage_limits (
       id, environment, tenant_id, meter_id, period_kind, limit_units,
       breach_behavior, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
    [
      usageLimitId, environment, tenantId, meterId, periodKind, limitUnits,
      breachBehavior, now,
    ],
  )
  const counterId = randomUUID()
  await client.query(
    `INSERT INTO fin.limit_counters (
       id, usage_limit_id, environment, period_key, consumed_units
     ) VALUES ($1,$2,$3,$4,$5)`,
    [counterId, usageLimitId, environment, periodKey, consumedUnits],
  )
  return { usageLimitId, counterId }
}

export async function postingSum(client, { transactionId, accountType }) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(p.amount_units), 0)::text AS qty
       FROM fin.ledger_postings p
       JOIN fin.ledger_accounts a ON a.id = p.account_id
      WHERE p.transaction_id = $1 AND a.account_type = $2`,
    [transactionId, accountType],
  )
  return rows[0].qty
}
