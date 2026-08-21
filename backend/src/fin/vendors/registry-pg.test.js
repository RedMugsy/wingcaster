import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import {
  activateRateVersion, createRateCard, createVendor, deprecateRateVersion,
  draftRateVersion, upsertVendorProduct,
} from './registry.js'
import { vendorEnv } from './test-support.js'

finPostgresSuite('fin.vendors registry-pg', {}, ({ pool, world }) => {
  it('createVendor writes header + audit + outbox and no ledger_transactions', async () => {
    const created = await createVendor(vendorEnv(world(), { name: 'google_maps', currency: 'USD' }))
    const row = await pool().query(`SELECT * FROM fin.vendors WHERE id = $1`, [created.id])
    expect(row.rows[0].name).toBe('google_maps')
    expect(row.rows[0].currency).toBe('USD')
    const audit = await pool().query(
      `SELECT action FROM fin.financial_audit_events WHERE target_id = $1`,
      [created.id],
    )
    expect(audit.rows.map((r) => r.action)).toContain('VENDOR_CREATED')
    const txs = await pool().query(`SELECT COUNT(*)::int AS n FROM fin.ledger_transactions`)
    expect(txs.rows[0].n).toBe(0)
  })

  it('upsertVendorProduct is unique on (vendor_id, product_code)', async () => {
    const vendor = await createVendor(vendorEnv(world(), { name: 'meta', currency: 'USD' }))
    const first = await upsertVendorProduct(vendorEnv(world(), {
      vendorId: vendor.id, productCode: 'wa.marketing', productClass: 'MSG',
    }))
    const second = await upsertVendorProduct(vendorEnv(world(), {
      vendorId: vendor.id, productCode: 'wa.marketing', productClass: 'MSG2',
    }))
    expect(second.id).toBe(first.id)
    const rows = await pool().query(
      `SELECT product_class FROM fin.vendor_products WHERE vendor_id = $1`,
      [vendor.id],
    )
    expect(rows.rowCount).toBe(1)
    expect(rows.rows[0].product_class).toBe('MSG2')
  })

  it('DRAFT → ACTIVE gap-fills prior ACTIVE effective_to then DEPRECATED; illegal reopen throws', async () => {
    const vendor = await createVendor(vendorEnv(world(), { name: 'rates', currency: 'USD' }))
    const card = await createRateCard(vendorEnv(world(), { vendorId: vendor.id, name: 'card' }))
    const v1 = await draftRateVersion(vendorEnv(world(), {
      rateCardId: card.id,
      rates: { sku: { unit_cost_minor: 10, currency: 'USD' } },
      effective_from: NOW,
    }))
    await activateRateVersion(vendorEnv(world(), { rateCardId: card.id, rateVersionId: v1.id }))
    const v2 = await draftRateVersion(vendorEnv(world(), {
      rateCardId: card.id,
      rates: { sku: { unit_cost_minor: 20, currency: 'USD' } },
      effective_from: '2026-09-01T00:00:00.000Z',
    }))
    await activateRateVersion(vendorEnv(world(), { rateCardId: card.id, rateVersionId: v2.id }))

    const rows = await pool().query(
      `SELECT id, status, effective_from, effective_to FROM fin.vendor_rate_versions
        WHERE rate_card_id = $1 ORDER BY version_n`,
      [card.id],
    )
    expect(rows.rows[0].status).toBe('DEPRECATED')
    expect(new Date(rows.rows[0].effective_to).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(rows.rows[1].status).toBe('ACTIVE')

    await deprecateRateVersion(vendorEnv(world(), { rateCardId: card.id, rateVersionId: v2.id }))
    const after = await pool().query(
      `SELECT status FROM fin.vendor_rate_versions WHERE id = $1`,
      [v2.id],
    )
    expect(after.rows[0].status).toBe('DEPRECATED')

    await expect(activateRateVersion(vendorEnv(world(), {
      rateCardId: card.id, rateVersionId: v2.id,
    }))).rejects.toMatchObject({ code: 'VENDOR_RATE_VERSION_ILLEGAL_TRANSITION' })
  })
})
