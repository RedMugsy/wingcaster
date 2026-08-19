import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { seedIsolatedMeter } from '../metering/test-support.js'
import { activatePriceVersion, createPrice, draftPriceVersion } from '../pricing/prices.js'
import {
  activateContractVersion, createContract, draftContractVersion,
} from '../pricing/contracts.js'
import { commandEnv, NOW, seedBook } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { fundPurchase } from '../ledger/transactions.js'
import { seedIsolatedHolder } from '../rating/test-support.js'
import { spendCredits } from './spend.js'

async function seedSpendWorld(pool, world, {
  label, units = 100, skipContract = false,
} = {}) {
  const { holderId, billingAccountId } = await seedIsolatedHolder(pool, world, { label })
  const book = await seedBook(pool, {
    environment: 'LIVE',
    tenantId: world.tenantA.tenantId,
    billingAccountId,
  })
  const { meterId, meterVersionId, eventType } = await seedIsolatedMeter(pool, {
    label,
    aggregationType: 'SUM',
  })
  await fundPurchase({
    ...commandEnv(world, { holderId, bookId: book.bookId }),
    purchaseIntentId: randomUUID(),
    paidUnits: units,
    bonusUnits: 0,
    considerationMinor: 1,
  })

  const price = await createPrice({
    environment: 'LIVE', reasonCode: 'TEST', now: NOW, actorType: 'SYSTEM',
    code: `sp.${label}.${randomUUID()}`,
    currency: 'USD',
    meterId,
  })
  const pv = await draftPriceVersion({
    environment: 'LIVE', reasonCode: 'TEST', now: NOW,
    priceId: price.id, model: 'PER_UNIT', unit_rate_minor: 10, effective_from: NOW,
  })
  await activatePriceVersion({
    environment: 'LIVE', reasonCode: 'TEST', now: NOW,
    priceId: price.id, priceVersionId: pv.id,
  })

  let contractId = null
  if (!skipContract) {
    const contract = await createContract({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW,
      tenantId: world.tenantA.tenantId,
      billingAccountId,
      sellerLegalEntityId: world.legalEntityId,
      contractNumber: `SP-${label}-${randomUUID()}`,
      billingCurrency: 'USD',
      billingTimezone: 'Asia/Riyadh',
    })
    const cv = await draftContractVersion({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW,
      tenantId: world.tenantA.tenantId,
      contractId: contract.id,
      effective_from: NOW,
      components: [{ component_type: 'METER_PRICE', priceId: price.id, meterId }],
    })
    await activateContractVersion({
      environment: 'LIVE', reasonCode: 'TEST', now: NOW,
      tenantId: world.tenantA.tenantId,
      contractId: contract.id,
      contractVersionId: cv.id,
    })
    contractId = contract.id
  }

  return {
    holderId, billingAccountId, bookId: book.bookId,
    meterId, meterVersionId, eventType, contractId,
    tenantId: world.tenantA.tenantId,
  }
}

function spendInput(world, seeded, extra = {}) {
  return {
    environment: 'LIVE',
    tenantId: seeded.tenantId,
    holderId: seeded.holderId,
    bookId: seeded.bookId,
    meterId: seeded.meterId,
    meterVersionId: seeded.meterVersionId,
    sourceSystem: 'orchestrator',
    sourceEventId: randomUUID(),
    eventType: seeded.eventType,
    unitsRequested: 30,
    occurredAt: NOW,
    receivedAt: NOW,
    now: NOW,
    reasonCode: 'TEST',
    actorType: 'SYSTEM',
    actorEmail: 'spend@fin.local',
    ...extra,
  }
}

finPostgresSuite('spendCredits A/B-1', {}, ({ pool, world }) => {
  it('AUTHORIZE_AND_CAPTURE commits usage + metered + rated + hold + capture atomically', async () => {
    const seeded = await seedSpendWorld(pool(), world(), { label: 'spend-ac' })
    const result = await spendCredits(spendInput(world(), seeded, {
      strategy: 'AUTHORIZE_AND_CAPTURE',
      idempotencyKey: `SPEND:${randomUUID()}`,
    }))
    expect(result.ok).toBe(true)
    expect(result.holdId).toBeTruthy()
    expect(result.txId).toBeTruthy()
    expect(result.usageEventId).toBeTruthy()
    expect(result.ratedUsageId).toBeTruthy()

    const joined = await pool().query(
      `SELECT
         (SELECT count(*) FROM fin.usage_events WHERE id = $1)::int AS usage_n,
         (SELECT count(*) FROM fin.metered_usage_sources WHERE usage_event_id = $1)::int AS src_n,
         (SELECT count(*) FROM fin.rated_usage WHERE id = $2)::int AS rated_n,
         (SELECT count(*) FROM fin.holds WHERE id = $3 AND status = 'CAPTURED')::int AS hold_n
      `,
      [result.usageEventId, result.ratedUsageId, result.holdId],
    )
    expect(joined.rows[0]).toMatchObject({
      usage_n: 1, src_n: 1, rated_n: 1, hold_n: 1,
    })
  })

  it('rating FIN_NO_ACTIVE_CONTRACT rolls back ingest, meter, rate, holds, ledger', async () => {
    const seeded = await seedSpendWorld(pool(), world(), {
      label: 'spend-nocontract', skipContract: true,
    })
    const before = await pool().query(`
      SELECT
        (SELECT count(*) FROM fin.usage_events)::int AS usage_n,
        (SELECT count(*) FROM fin.metered_usage)::int AS metered_n,
        (SELECT count(*) FROM fin.rated_usage)::int AS rated_n,
        (SELECT count(*) FROM fin.holds)::int AS hold_n,
        (SELECT count(*) FROM fin.ledger_transactions)::int AS tx_n
    `)
    await expect(spendCredits(spendInput(world(), seeded, {
      strategy: 'AUTHORIZE_AND_CAPTURE',
      idempotencyKey: `SPEND:${randomUUID()}`,
    }))).rejects.toMatchObject({ code: 'FIN_NO_ACTIVE_CONTRACT' })
    const after = await pool().query(`
      SELECT
        (SELECT count(*) FROM fin.usage_events)::int AS usage_n,
        (SELECT count(*) FROM fin.metered_usage)::int AS metered_n,
        (SELECT count(*) FROM fin.rated_usage)::int AS rated_n,
        (SELECT count(*) FROM fin.holds)::int AS hold_n,
        (SELECT count(*) FROM fin.ledger_transactions)::int AS tx_n
    `)
    expect(after.rows[0]).toEqual(before.rows[0])
  })

  it('DIRECT_SPEND writes usage + rated + DIRECT_SPEND posting and no hold', async () => {
    const seeded = await seedSpendWorld(pool(), world(), { label: 'spend-direct' })
    const result = await spendCredits(spendInput(world(), seeded, {
      strategy: 'DIRECT_SPEND',
      idempotencyKey: `SPEND:${randomUUID()}`,
    }))
    expect(result.ok).toBe(true)
    expect(result.holdId).toBeNull()
    expect(result.txId).toBeTruthy()
    const tx = await pool().query(
      `SELECT shape FROM fin.ledger_transactions WHERE id = $1`,
      [result.txId],
    )
    expect(tx.rows[0].shape).toBe('DIRECT_SPEND')
    const holds = await pool().query(
      `SELECT count(*)::int AS n FROM fin.holds WHERE holder_id = $1`,
      [seeded.holderId],
    )
    expect(holds.rows[0].n).toBe(0)
    const usage = await pool().query(
      `SELECT count(*)::int AS n FROM fin.usage_events WHERE id = $1`,
      [result.usageEventId],
    )
    expect(usage.rows[0].n).toBe(1)
    const rated = await pool().query(
      `SELECT count(*)::int AS n FROM fin.rated_usage WHERE id = $1`,
      [result.ratedUsageId],
    )
    expect(rated.rows[0].n).toBe(1)
  })

  it('AUTHORIZE_ONLY leaves the hold OPEN and does not capture', async () => {
    const seeded = await seedSpendWorld(pool(), world(), { label: 'spend-authonly' })
    const result = await spendCredits(spendInput(world(), seeded, {
      strategy: 'AUTHORIZE_ONLY',
      idempotencyKey: `SPEND:${randomUUID()}`,
    }))
    expect(result.ok).toBe(true)
    const hold = await pool().query(
      `SELECT status, capture_tx_id FROM fin.holds WHERE id = $1`,
      [result.holdId],
    )
    expect(hold.rows[0].status).toBe('OPEN')
    expect(hold.rows[0].capture_tx_id).toBeNull()
    const captures = await pool().query(
      `SELECT count(*)::int AS n FROM fin.ledger_transactions
        WHERE shape = 'CAPTURE' AND economic_source_id = $1`,
      [result.holdId],
    )
    expect(captures.rows[0].n).toBe(0)
  })
})
