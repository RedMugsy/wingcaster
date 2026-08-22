/**
 * Real-Postgres — fin_public.* read views + 260b not auto-applied.
 */
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestUsageEvent } from '../usage/ingest.js'

finPostgresSuite('cutover/read-views', {}, ({ pool, world }) => {
  it('does not auto-apply the 260b thaw down-migration', async () => {
    const applied = await pool().query(
      `SELECT filename FROM schema_migrations WHERE filename LIKE '260b%'`,
    )
    expect(applied.rowCount).toBe(0)
    const freeze = await pool().query(
      `SELECT filename FROM schema_migrations
        WHERE filename IN (
          '260_fin_cutover_freeze_commercial.sql',
          '261_fin_cutover_read_views.sql',
          '262_fin_cutover_readiness_gate.sql'
        )
        ORDER BY filename`,
    )
    expect(freeze.rows.map((r) => r.filename)).toEqual([
      '260_fin_cutover_freeze_commercial.sql',
      '261_fin_cutover_read_views.sql',
      '262_fin_cutover_readiness_gate.sql',
    ])
  })

  it('SELECT from fin_public.usage_events matches fin.usage_events and respects RLS', async () => {
    await ingestUsageEvent({
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      holderId: world().tenantA.holderId,
      billingAccountId: world().tenantA.billingAccountId,
      sourceSystem: 'commercial.usage_events',
      sourceEventId: `view-${NOW}`,
      eventType: 'webhook.received',
      quantityUnits: 2,
      occurredAt: NOW,
      receivedAt: NOW,
      now: NOW,
      dimensions: { public_tenant_id: world().tenantA.publicTenantId },
    })

    const fromTable = await pool().query(
      `SELECT id, tenant_id, source_event_id, quantity_units
         FROM fin.usage_events
        WHERE source_event_id = $1`,
      [`view-${NOW}`],
    )
    const fromView = await pool().query(
      `SELECT id, tenant_id, source_event_id, quantity_units
         FROM fin_public.usage_events
        WHERE source_event_id = $1`,
      [`view-${NOW}`],
    )
    expect(fromView.rows).toEqual(fromTable.rows)
    expect(fromView.rowCount).toBe(1)

    const client = await pool().connect()
    try {
      await client.query('SET ROLE fin_app_role')
      await client.query(`SELECT set_config('fin.environment', 'LIVE', false)`)
      await client.query(
        `SELECT set_config('fin.tenant_id', $1, false)`,
        [world().tenantA.tenantId],
      )
      const allowed = await client.query(
        `SELECT source_event_id FROM fin_public.usage_events WHERE source_event_id = $1`,
        [`view-${NOW}`],
      )
      expect(allowed.rowCount).toBe(1)

      await client.query(
        `SELECT set_config('fin.tenant_id', $1, false)`,
        [world().tenantB.tenantId],
      )
      const denied = await client.query(
        `SELECT source_event_id FROM fin_public.usage_events WHERE source_event_id = $1`,
        [`view-${NOW}`],
      )
      expect(denied.rowCount).toBe(0)
    } finally {
      await client.query('RESET ROLE').catch(() => {})
      client.release()
    }
  })
})
