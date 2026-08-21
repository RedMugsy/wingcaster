import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { asRole, NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestVendorUsageEvent } from './usage-ingest.js'
import { createVendor } from './registry.js'
import { vendorEnv } from './test-support.js'

finPostgresSuite('fin.vendors usage-ingest', {}, ({ pool, world }) => {
  it('dedupes on (vendor_id, source_event_id) and never updates the first row', async () => {
    const vendor = await createVendor(vendorEnv(world(), { name: 'ingest', currency: 'USD' }))
    const sourceEventId = `evt-${randomUUID()}`
    const first = await ingestVendorUsageEvent(vendorEnv(world(), {
      vendorId: vendor.id,
      vendorProductCode: 'sku.a',
      quantityUnits: 3,
      occurredAt: NOW,
      sourceEventId,
    }))
    const second = await ingestVendorUsageEvent(vendorEnv(world(), {
      vendorId: vendor.id,
      vendorProductCode: 'sku.a',
      quantityUnits: 99,
      occurredAt: NOW,
      sourceEventId,
    }))
    expect(second.deduped).toBe(true)
    expect(second.id).toBe(first.id)
    const rows = await pool().query(
      `SELECT quantity_units FROM fin.vendor_usage_events WHERE vendor_id = $1`,
      [vendor.id],
    )
    expect(rows.rowCount).toBe(1)
    expect(Number(rows.rows[0].quantity_units)).toBe(3)
  })

  it('APPEND_ONLY: fin_app_role UPDATE and DELETE are rejected', async () => {
    const vendor = await createVendor(vendorEnv(world(), { name: 'ao', currency: 'USD' }))
    const ingested = await ingestVendorUsageEvent(vendorEnv(world(), {
      vendorId: vendor.id,
      vendorProductCode: 'sku.b',
      quantityUnits: 1,
      occurredAt: NOW,
      sourceEventId: randomUUID(),
    }))
    const gucs = { 'fin.environment': 'LIVE' }
    const client = await pool().connect()
    try {
      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `UPDATE fin.vendor_usage_events SET quantity_units = 8 WHERE id = $1`,
        [ingested.id],
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)
      await expect(asRole(client, 'fin_app_role', gucs, (c) => c.query(
        `DELETE FROM fin.vendor_usage_events WHERE id = $1`,
        [ingested.id],
      ))).rejects.toThrow(/permission denied|insufficient privilege/i)
    } finally {
      client.release()
    }
  })
})
