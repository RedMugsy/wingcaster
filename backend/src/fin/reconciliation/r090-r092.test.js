/**
 * Real-Postgres — R090–R092 contamination DRIFT then GREEN after cleanup.
 */
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { transaction } from '../../db.js'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { ingestUsageEvent } from '../usage/ingest.js'
import { insertAccountingEvent } from '../accounting/events.js'
import { runReconciliation } from '../runner.js'

async function dropUsageEnvCheck(pool) {
  const { rows } = await pool.query(
    `SELECT conname
       FROM pg_constraint
      WHERE conrelid = 'fin.usage_events'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%environment%'`,
  )
  for (const row of rows) {
    await pool.query(`ALTER TABLE fin.usage_events DROP CONSTRAINT IF EXISTS ${row.conname} CASCADE`)
  }
}

finPostgresSuite('reconciliation/r090-r092', {}, ({ pool, world }) => {
  it('R090 DRIFT on invalid environment then GREEN after delete', async () => {
    await dropUsageEnvCheck(pool())
    const badId = randomUUID()
    await pool().query(
      `INSERT INTO fin.usage_events (
         id, environment, residency_key, source_system, source_event_id,
         event_type, event_kind, quantity_units, dimensions,
         occurred_at, received_at, ingestion_version, created_at
       ) VALUES (
         $1, 'STAGE', '__platform__', 'test.r090', $2,
         'probe', 'ORIGINAL', 1, '{}'::jsonb,
         $3::timestamptz, $3::timestamptz, 1, $3::timestamptz
       )`,
      [badId, randomUUID(), NOW],
    )
    const drifted = await runReconciliation(pool(), { now: NOW })
    expect(drifted.results.find((r) => r.check_code === 'R090').result).toBe('DRIFT')
    await pool().query(`DELETE FROM fin.usage_events WHERE id = $1`, [badId])
    const clean = await runReconciliation(pool(), { now: NOW })
    expect(clean.results.find((r) => r.check_code === 'R090').result).toBe('GREEN')
  })

  it('R091 DRIFT on tenant mismatch then GREEN after delete', async () => {
    const usage = await ingestUsageEvent({
      environment: 'LIVE',
      tenantId: world().tenantA.tenantId,
      holderId: world().tenantA.holderId,
      sourceSystem: 'test.r091',
      sourceEventId: randomUUID(),
      eventType: 'probe',
      quantityUnits: 1,
      occurredAt: NOW,
      receivedAt: NOW,
    })
    let aeId
    await transaction(async (client) => {
      const inserted = await insertAccountingEvent(client, {
        environment: 'LIVE',
        tenantId: world().tenantB.tenantId,
        billingAccountId: world().tenantB.billingAccountId,
        legalEntityId: world().legalEntityId,
        eventKind: 'REVENUE_RECOGNIZED',
        eventAt: NOW,
        amountMinor: 0,
        currency: 'USD',
        sourceType: 'RATED_USAGE',
        sourceId: usage.id,
        now: NOW,
      })
      aeId = inserted.id
    })
    const drifted = await runReconciliation(pool(), { now: NOW })
    expect(drifted.results.find((r) => r.check_code === 'R091').result).toBe('DRIFT')
    await pool().query(`DELETE FROM fin.accounting_events WHERE id = $1`, [aeId])
    const clean = await runReconciliation(pool(), { now: NOW })
    expect(clean.results.find((r) => r.check_code === 'R091').result).toBe('GREEN')
  })

  it('R092 DRIFT when invoice issuer disagrees with seller then GREEN after delete', async () => {
    const otherLe = randomUUID()
    await pool().query(
      `INSERT INTO fin.platform_legal_entities (
         id, platform_id, code, legal_name, jurisdiction, tax_id,
         billing_currency, residency_key, created_at, updated_at
       ) VALUES ($1,$2,'WC-UAE','Wingcaster UAE','AE','1000000000',
                 'AED','uae',$3,$3)`,
      [otherLe, world().platformId, NOW],
    )
    const invoiceId = randomUUID()
    await pool().query(
      `INSERT INTO fin.invoices (
         id, environment, tenant_id, billing_account_id, legal_entity_id,
         status, currency, subtotal_minor, tax_minor, total_minor,
         created_at, updated_at, version
       ) VALUES (
         $1,'LIVE',$2,$3,$4,
         'DRAFT','USD',0,0,0,
         $5::timestamptz,$5::timestamptz,1
       )`,
      [
        invoiceId, world().tenantA.tenantId, world().tenantA.billingAccountId,
        otherLe, NOW,
      ],
    )
    const drifted = await runReconciliation(pool(), { now: NOW })
    expect(drifted.results.find((r) => r.check_code === 'R092').result).toBe('DRIFT')
    await pool().query(`DELETE FROM fin.invoices WHERE id = $1`, [invoiceId])
    const clean = await runReconciliation(pool(), { now: NOW })
    expect(clean.results.find((r) => r.check_code === 'R092').result).toBe('GREEN')
  })
})
