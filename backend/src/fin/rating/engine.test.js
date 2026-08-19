import { expect, it } from 'vitest'
import { FinError } from '../errors.js'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { activatePriceVersion, draftPriceVersion } from '../pricing/prices.js'
import { rateMeteredUsage } from './engine.js'
import { countUsageByEventType, rateInput, seedRatedCase } from './test-support.js'

finPostgresSuite('rating engine', {}, ({ pool, world }) => {
  it('PER_UNIT amount_minor is billable_units * unit_rate_minor', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'per-unit',
      eventCount: 4,
      unitRateMinor: 25,
    })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(4)
    const beforeTx = await pool().query('SELECT count(*)::int AS n FROM fin.ledger_transactions')
    const result = await rateMeteredUsage(rateInput(seeded))
    expect(result.ok).toBe(true)
    expect(result.billableUnits).toBe(4)
    expect(result.amountMinor).toBe(100)
    const row = await pool().query(
      `SELECT amount_minor::text AS amt, billable_units::text AS billable, late_class,
              billing_period_id, adjustment_of_id
         FROM fin.rated_usage WHERE id = $1`,
      [result.ratedUsageId],
    )
    expect(row.rows[0]).toMatchObject({
      amt: '100', billable: '4', late_class: 'OPEN_PERIOD',
      billing_period_id: null, adjustment_of_id: null,
    })
    const afterTx = await pool().query('SELECT count(*)::int AS n FROM fin.ledger_transactions')
    expect(afterTx.rows[0].n).toBe(beforeTx.rows[0].n)
    const outbox = await pool().query(
      `SELECT topic FROM fin.outbox_events WHERE topic = 'fin.rating.completed' AND dedupe_key = $1`,
      [`rating:${seeded.meteredUsageId}:${result.ratingHash}`],
    )
    expect(outbox.rowCount).toBe(1)
    const audit = await pool().query(
      `SELECT action, target_type FROM fin.financial_audit_events
        WHERE target_id = $1 AND action = 'RATED'`,
      [result.ratedUsageId],
    )
    expect(audit.rowCount).toBe(1)
    expect(audit.rows[0].target_type).toBe('RATED_USAGE')
    const hashProbe = await pool().query(
      `SELECT rating_hash = encode(sha256(convert_to(fin.canonical_json(explanation), 'UTF8')), 'hex') AS ok
         FROM fin.rated_usage WHERE id = $1`,
      [result.ratedUsageId],
    )
    expect(hashProbe.rows[0].ok).toBe(true)
  })

  it('FLAT amount_minor is unit_rate_minor regardless of units', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'flat',
      model: 'FLAT',
      eventCount: 4,
      unitRateMinor: 999,
    })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(4)
    const result = await rateMeteredUsage(rateInput(seeded))
    expect(result.amountMinor).toBe(999)
    expect(result.billableUnits).toBe(4)
  })

  it('PACKAGE amount_minor is ceil(billable / package_size) * unit_rate_minor', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'package',
      model: 'PACKAGE',
      eventCount: 10,
      unitRateMinor: 100,
      packageSizeUnits: 3,
    })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(10)
    const result = await rateMeteredUsage(rateInput(seeded))
    expect(result.billableUnits).toBe(10)
    expect(result.amountMinor).toBe(400)
  })

  it('GRADUATED_TIER sums slice * rate across tiers including open top', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'graduated',
      model: 'GRADUATED_TIER',
      eventCount: 12,
      unitRateMinor: null,
      tiers: [
        { upto_units: 5, rate_minor: 10 },
        { upto_units: 10, rate_minor: 5 },
        { upto_units: null, rate_minor: 1 },
      ],
    })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(12)
    const result = await rateMeteredUsage(rateInput(seeded))
    expect(result.amountMinor).toBe(77)
  })

  it('VOLUME_TIER uses the single containing tier rate', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'volume',
      model: 'VOLUME_TIER',
      eventCount: 4,
      unitRateMinor: null,
      tiers: [
        { upto_units: 5, rate_minor: 10 },
        { upto_units: 10, rate_minor: 5 },
        { upto_units: null, rate_minor: 2 },
      ],
    })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(4)
    const result = await rateMeteredUsage(rateInput(seeded))
    expect(result.amountMinor).toBe(40)
  })

  it('DIMENSIONAL picks CHANNEL/whatsapp; kind-then-value precedence', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'dimensional',
      model: 'DIMENSIONAL',
      eventCount: 10,
      unitRateMinor: 7,
      eventDimensions: { channel: 'whatsapp', territory: 'SA' },
      dimensions: [
        { dimension_kind: 'TERRITORY', dimension_value: 'SA', unit_rate_minor: 99 },
        { dimension_kind: 'CHANNEL', dimension_value: 'whatsapp', unit_rate_minor: 15 },
        { dimension_kind: 'CHANNEL', dimension_value: 'sms', unit_rate_minor: 3 },
      ],
    })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(10)
    const result = await rateMeteredUsage(rateInput(seeded))
    expect(result.amountMinor).toBe(150)
  })

  it('INCLUDED_QUANTITY first N units are free then PER_UNIT', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'included',
      model: 'INCLUDED_QUANTITY',
      eventCount: 10,
      unitRateMinor: 8,
      includedUnits: 3,
    })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(10)
    const result = await rateMeteredUsage(rateInput(seeded))
    expect(result.billableUnits).toBe(7)
    expect(result.amountMinor).toBe(56)
    const row = await pool().query(
      `SELECT measured_units::text AS measured, included_units::text AS included,
              billable_units::text AS billable
         FROM fin.rated_usage WHERE id = $1`,
      [result.ratedUsageId],
    )
    expect(row.rows[0]).toMatchObject({ measured: '10', included: '3', billable: '7' })
  })

  it('determinism: rating twice returns the same ratedUsageId with deduped true', async () => {
    const seeded = await seedRatedCase(pool(), world(), { label: 'dedupe', eventCount: 2 })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(2)
    const first = await rateMeteredUsage(rateInput(seeded))
    const second = await rateMeteredUsage(rateInput(seeded))
    expect(second).toMatchObject({
      ok: true,
      ratedUsageId: first.ratedUsageId,
      ratingHash: first.ratingHash,
      deduped: true,
      amountMinor: first.amountMinor,
    })
    const count = await pool().query(
      `SELECT count(*)::int AS n FROM fin.rated_usage WHERE metered_usage_id = $1`,
      [seeded.meteredUsageId],
    )
    expect(count.rows[0].n).toBe(1)
  })

  it('re-rate after a new ACTIVE price_version inserts adjustment_of_id chain', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'rerate',
      eventCount: 4,
      unitRateMinor: 10,
    })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(4)
    const first = await rateMeteredUsage(rateInput(seeded))
    expect(first.amountMinor).toBe(40)

    const v2 = await draftPriceVersion({
      environment: 'LIVE',
      reasonCode: 'TEST',
      now: NOW,
      priceId: seeded.priceId,
      model: 'PER_UNIT',
      unit_rate_minor: 50,
      effective_from: '2026-08-19T00:00:00.000Z',
    })
    await activatePriceVersion({
      environment: 'LIVE',
      reasonCode: 'TEST',
      now: NOW,
      priceId: seeded.priceId,
      priceVersionId: v2.id,
    })
    const second = await rateMeteredUsage(rateInput(seeded, { priceVersionId: v2.id }))
    expect(second.ok).toBe(true)
    expect(second.ratedUsageId).not.toBe(first.ratedUsageId)
    expect(second.adjustmentOf).toBe(first.ratedUsageId)
    expect(second.amountMinor).toBe(200)
    expect(second.deduped).toBeUndefined()
    const row = await pool().query(
      `SELECT adjustment_of_id FROM fin.rated_usage WHERE id = $1`,
      [second.ratedUsageId],
    )
    expect(row.rows[0].adjustment_of_id).toBe(first.ratedUsageId)
  })

  it('FIN_NO_ACTIVE_CONTRACT when the holder has no ACTIVE contract_version', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'nocontract',
      skipContract: true,
    })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(4)
    await expect(rateMeteredUsage(rateInput(seeded))).rejects.toMatchObject({
      code: 'FIN_NO_ACTIVE_CONTRACT',
    })
    expect(await pool().query(
      `SELECT count(*)::int AS n FROM fin.rated_usage WHERE metered_usage_id = $1`,
      [seeded.meteredUsageId],
    )).toMatchObject({ rows: [{ n: 0 }] })
  })

  it('FIN_NO_ACTIVE_PRICE when the contract has no METER_PRICE for the meter', async () => {
    const seeded = await seedRatedCase(pool(), world(), {
      label: 'noprice',
      skipPriceComponent: true,
    })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(4)
    try {
      await rateMeteredUsage(rateInput(seeded))
      throw new Error('expected FIN_NO_ACTIVE_PRICE')
    } catch (error) {
      expect(error).toBeInstanceOf(FinError)
      expect(error.code).toBe('FIN_NO_ACTIVE_PRICE')
    }
  })

  it('fingerprint-shaped guard: benign metadata does not change rating_hash', async () => {
    const seeded = await seedRatedCase(pool(), world(), { label: 'fingerprint', eventCount: 3 })
    expect(await countUsageByEventType(pool(), seeded.eventType)).toBe(3)
    const first = await rateMeteredUsage(rateInput(seeded, { actorEmail: 'one@fin.local' }))
    const second = await rateMeteredUsage(rateInput(seeded, { actorEmail: 'two@fin.local', actorId: null }))
    expect(second.ratingHash).toBe(first.ratingHash)
    expect(second.ratedUsageId).toBe(first.ratedUsageId)
    expect(second.deduped).toBe(true)
  })
})
