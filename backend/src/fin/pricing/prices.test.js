import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { FinError } from '../errors.js'
import { insertApproval, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import {
  activatePriceVersion,
  createPrice,
  draftPriceVersion,
} from './prices.js'

function priceEnv(world, extra = {}) {
  return {
    environment: 'LIVE',
    reasonCode: extra.reasonCode || 'TEST',
    actorType: extra.actorType || 'SYSTEM',
    now: world.now,
    ...extra,
  }
}

async function seedMeter(pool, code) {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO fin.meters (id, environment, code, name, created_at, updated_at)
     VALUES ($1, 'LIVE', $2, $2, $3, $3)`,
    [id, code, NOW],
  )
  return id
}

finPostgresSuite('fin.pricing prices commands', {}, ({ pool, world }) => {
  it('createPrice writes header + audit + outbox', async () => {
    const created = await createPrice(priceEnv(world(), {
      code: 'msg.out.utility',
      currency: 'USD',
    }))
    expect(created.id).toBeTruthy()
    const row = await pool().query(`SELECT * FROM fin.prices WHERE id = $1`, [created.id])
    expect(row.rows[0].code).toBe('msg.out.utility')
    expect(row.rows[0].currency).toBe('USD')
    const audit = await pool().query(
      `SELECT action FROM fin.financial_audit_events WHERE target_id = $1`,
      [created.id],
    )
    expect(audit.rows.map((r) => r.action)).toContain('PRICE_CREATED')
    const outbox = await pool().query(
      `SELECT topic FROM fin.outbox_events WHERE dedupe_key = $1`,
      [`price:${created.id}`],
    )
    expect(outbox.rows[0].topic).toBe('fin.price.created')
    const txs = await pool().query(
      `SELECT COUNT(*)::int AS n FROM fin.ledger_transactions`,
    )
    expect(txs.rows[0].n).toBe(0)
  })

  it('draftPriceVersion PER_UNIT writes version without tiers or dimensions', async () => {
    const created = await createPrice(priceEnv(world(), { code: 'per.unit', currency: 'USD' }))
    const drafted = await draftPriceVersion(priceEnv(world(), {
      priceId: created.id,
      model: 'PER_UNIT',
      unit_rate_minor: 150,
      effective_from: NOW,
    }))
    const version = await pool().query(
      `SELECT * FROM fin.price_versions WHERE id = $1`,
      [drafted.id],
    )
    expect(version.rows[0].status).toBe('DRAFT')
    expect(version.rows[0].model).toBe('PER_UNIT')
    expect(Number(version.rows[0].unit_rate_minor)).toBe(150)
    const tiers = await pool().query(
      `SELECT COUNT(*)::int AS n FROM fin.price_tiers WHERE price_version_id = $1`,
      [drafted.id],
    )
    const dims = await pool().query(
      `SELECT COUNT(*)::int AS n FROM fin.price_dimensions WHERE price_version_id = $1`,
      [drafted.id],
    )
    expect(tiers.rows[0].n).toBe(0)
    expect(dims.rows[0].n).toBe(0)
  })

  it('draftPriceVersion GRADUATED_TIER writes dense tier_no 1..N', async () => {
    const created = await createPrice(priceEnv(world(), { code: 'grad', currency: 'USD' }))
    const drafted = await draftPriceVersion(priceEnv(world(), {
      priceId: created.id,
      model: 'GRADUATED_TIER',
      effective_from: NOW,
      tiers: [
        { upto_units: 10, rate_minor: 100 },
        { upto_units: null, rate_minor: 80 },
      ],
    }))
    const tiers = await pool().query(
      `SELECT tier_no, upto_units, rate_minor FROM fin.price_tiers
        WHERE price_version_id = $1 ORDER BY tier_no`,
      [drafted.id],
    )
    expect(tiers.rows.map((r) => Number(r.tier_no))).toEqual([1, 2])
    expect(Number(tiers.rows[0].rate_minor)).toBe(100)
    expect(tiers.rows[1].upto_units).toBeNull()
  })

  it('draftPriceVersion GRADUATED_TIER without tiers throws FIN_PRICE_MODEL_INVALID', async () => {
    const created = await createPrice(priceEnv(world(), { code: 'grad.bad', currency: 'USD' }))
    await expect(draftPriceVersion(priceEnv(world(), {
      priceId: created.id,
      model: 'GRADUATED_TIER',
      effective_from: NOW,
    }))).rejects.toMatchObject({ code: 'FIN_PRICE_MODEL_INVALID' })
  })

  it('draftPriceVersion DIMENSIONAL writes dimension rows', async () => {
    const created = await createPrice(priceEnv(world(), { code: 'dim', currency: 'USD' }))
    const drafted = await draftPriceVersion(priceEnv(world(), {
      priceId: created.id,
      model: 'DIMENSIONAL',
      effective_from: NOW,
      dimensions: [
        { dimension_kind: 'TERRITORY', dimension_value: 'ksa', unit_rate_minor: 200 },
        { dimension_kind: 'CHANNEL', dimension_value: 'whatsapp', unit_rate_minor: 250 },
      ],
    }))
    const dims = await pool().query(
      `SELECT dimension_kind, dimension_value FROM fin.price_dimensions
        WHERE price_version_id = $1 ORDER BY dimension_kind`,
      [drafted.id],
    )
    expect(dims.rowCount).toBe(2)
    expect(dims.rows.map((r) => r.dimension_kind).sort()).toEqual(['CHANNEL', 'TERRITORY'])
  })

  it('activatePriceVersion flips DRAFT→ACTIVE and supersedes the previous ACTIVE', async () => {
    const created = await createPrice(priceEnv(world(), { code: 'act', currency: 'USD' }))
    const v1 = await draftPriceVersion(priceEnv(world(), {
      priceId: created.id,
      model: 'PER_UNIT',
      unit_rate_minor: 10,
      effective_from: '2026-01-01T00:00:00.000Z',
    }))
    const first = await activatePriceVersion(priceEnv(world(), {
      priceId: created.id,
      priceVersionId: v1.id,
    }))
    expect(first.status).toBe('ACTIVE')
    const v2 = await draftPriceVersion(priceEnv(world(), {
      priceId: created.id,
      model: 'PER_UNIT',
      unit_rate_minor: 12,
      effective_from: NOW,
    }))
    const second = await activatePriceVersion(priceEnv(world(), {
      priceId: created.id,
      priceVersionId: v2.id,
    }))
    expect(second.status).toBe('ACTIVE')
    expect(second.version).toBeGreaterThan(first.version)
    const rows = await pool().query(
      `SELECT id, status, effective_to FROM fin.price_versions WHERE price_id = $1 ORDER BY version_n`,
      [created.id],
    )
    expect(rows.rows[0].status).toBe('SUPERSEDED')
    expect(rows.rows[0].effective_to).toBeTruthy()
    expect(rows.rows[1].status).toBe('ACTIVE')
  })

  it('overlap on activate surfaces FIN_PRICE_VERSION_OVERLAP from gist 23P01', async () => {
    const created = await createPrice(priceEnv(world(), { code: 'overlap', currency: 'USD' }))
    const v1 = await draftPriceVersion(priceEnv(world(), {
      priceId: created.id,
      model: 'PER_UNIT',
      unit_rate_minor: 10,
      effective_from: NOW,
    }))
    await activatePriceVersion(priceEnv(world(), {
      priceId: created.id,
      priceVersionId: v1.id,
    }))
    await pool().query(
      `UPDATE fin.price_versions SET status = 'SUPERSEDED' WHERE id = $1`,
      [v1.id],
    )
    const v2 = await draftPriceVersion(priceEnv(world(), {
      priceId: created.id,
      model: 'PER_UNIT',
      unit_rate_minor: 11,
      effective_from: NOW,
    }))
    await expect(activatePriceVersion(priceEnv(world(), {
      priceId: created.id,
      priceVersionId: v2.id,
    }))).rejects.toMatchObject({ code: 'FIN_PRICE_VERSION_OVERLAP' })
  })

  it('backdated activate without approval throws BACKDATED_AMENDMENT_REQUIRED', async () => {
    const created = await createPrice(priceEnv(world(), { code: 'back.no', currency: 'USD' }))
    const v1 = await draftPriceVersion(priceEnv(world(), {
      priceId: created.id,
      model: 'PER_UNIT',
      unit_rate_minor: 10,
      effective_from: '2020-01-01T00:00:00.000Z',
    }))
    await expect(activatePriceVersion(priceEnv(world(), {
      priceId: created.id,
      priceVersionId: v1.id,
    }))).rejects.toMatchObject({ code: 'BACKDATED_AMENDMENT_REQUIRED' })
  })

  it('backdated activate with EXECUTED approval succeeds', async () => {
    const approvalId = await insertApproval(pool(), {
      tenantId: world().tenantA.tenantId,
      actionKind: 'BACKDATED_AMENDMENT',
      status: 'EXECUTED',
    })
    const created = await createPrice(priceEnv(world(), { code: 'back.yes', currency: 'USD' }))
    const v1 = await draftPriceVersion(priceEnv(world(), {
      priceId: created.id,
      model: 'PER_UNIT',
      unit_rate_minor: 10,
      effective_from: '2020-01-01T00:00:00.000Z',
    }))
    const activated = await activatePriceVersion(priceEnv(world(), {
      priceId: created.id,
      priceVersionId: v1.id,
      approvalRequestId: approvalId,
    }))
    expect(activated.status).toBe('ACTIVE')
  })

  it('optional meter_id is stored when provided', async () => {
    const meterId = await seedMeter(pool(), 'opt.meter')
    const created = await createPrice(priceEnv(world(), {
      code: 'with.meter',
      currency: 'USD',
      meterId,
    }))
    const row = await pool().query(`SELECT meter_id FROM fin.prices WHERE id = $1`, [created.id])
    expect(row.rows[0].meter_id).toBe(meterId)
  })

  it('errors are FinError instances', async () => {
    try {
      await draftPriceVersion(priceEnv(world(), {
        priceId: randomUUID(),
        model: 'GRADUATED_TIER',
        effective_from: NOW,
      }))
    } catch (error) {
      expect(error).toBeInstanceOf(FinError)
    }
  })
})
