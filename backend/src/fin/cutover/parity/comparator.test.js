/**
 * Fast suite — per-source parity comparator. Every drift_kind branch.
 */
import { describe, expect, it } from 'vitest'
import {
  SOURCE_USAGE, SOURCE_CONSUMPTION, SOURCE_HOLDS, SOURCE_CAPTURES,
  compareUsageEvent, compareConsumption, compareHold, compareCapture,
  classifyMirror, compareForSource,
} from './comparator.js'

const NOW = '2026-08-18T12:00:00.000Z'
const SKEW = '2026-08-18T12:00:02.000Z'

const legacyUsage = {
  id: 'evt-1',
  tenant_id: 'pt-a',
  action_key: 'webhook.received',
  quantity: 3,
  occurred_at: NOW,
}

const finUsage = {
  id: 'fin-1',
  environment: 'LIVE',
  source_system: 'commercial',
  source_event_id: 'evt-1',
  event_type: 'webhook.received',
  quantity_units: 3,
  occurred_at: NOW,
  dimensions: { public_tenant_id: 'pt-a' },
}

describe('parity comparator', () => {
  it('usage_events matching pair is ok', () => {
    expect(compareUsageEvent(legacyUsage, finUsage, { environment: 'LIVE' })).toEqual({
      ok: true, drift_kind: null, field_diffs: {},
    })
  })

  it('MISSING_FIN when fin row is absent', () => {
    expect(compareUsageEvent(legacyUsage, null).drift_kind).toBe('MISSING_FIN')
    expect(classifyMirror(SOURCE_USAGE, legacyUsage, []).drift_kind).toBe('MISSING_FIN')
  })

  it('MISSING_LEGACY when legacy row is absent', () => {
    expect(compareUsageEvent(null, finUsage).drift_kind).toBe('MISSING_LEGACY')
    expect(classifyMirror(SOURCE_USAGE, null, [finUsage]).drift_kind).toBe('MISSING_LEGACY')
  })

  it('DUPLICATE_FIN when two fin mirrors exist', () => {
    const result = classifyMirror(SOURCE_USAGE, legacyUsage, [finUsage, { ...finUsage, id: 'fin-2' }])
    expect(result.drift_kind).toBe('DUPLICATE_FIN')
    expect(result.field_diffs.fin_count).toBe(2)
  })

  it('TIMESTAMP_SKEW when occurred_at differs by more than 1s', () => {
    const result = compareUsageEvent(legacyUsage, { ...finUsage, occurred_at: SKEW })
    expect(result.ok).toBe(false)
    expect(result.drift_kind).toBe('TIMESTAMP_SKEW')
    expect(result.field_diffs.occurred_at.skew_ms).toBeGreaterThan(1000)
  })

  it('AMOUNT_MISMATCH when quantity differs', () => {
    const result = compareUsageEvent(legacyUsage, { ...finUsage, quantity_units: 9 })
    expect(result.drift_kind).toBe('AMOUNT_MISMATCH')
  })

  it('FIELD_MISMATCH when event_type differs', () => {
    const result = compareUsageEvent(legacyUsage, { ...finUsage, event_type: 'other.action' })
    expect(result.drift_kind).toBe('FIELD_MISMATCH')
  })

  it('TENANT_MISMATCH when public tenant disagrees', () => {
    const result = compareUsageEvent(legacyUsage, {
      ...finUsage, dimensions: { public_tenant_id: 'pt-other' },
    })
    expect(result.drift_kind).toBe('TENANT_MISMATCH')
  })

  it('ENVIRONMENT_MISMATCH when fin environment disagrees', () => {
    const result = compareUsageEvent(legacyUsage, { ...finUsage, environment: 'TEST' }, {
      environment: 'LIVE',
    })
    expect(result.drift_kind).toBe('ENVIRONMENT_MISMATCH')
  })

  it('consumption CURRENCY_MISMATCH', () => {
    const result = compareConsumption(
      { id: 'le-1', tenant_id: 'pt-a', amount: 4, quota_key: 'outbound_whatsapp', currency: 'USD', created_at: NOW },
      {
        quantity_units: 4, currency: 'AED', event_type: 'outbound_whatsapp', occurred_at: NOW,
        dimensions: { public_tenant_id: 'pt-a' },
      },
    )
    expect(result.drift_kind).toBe('CURRENCY_MISMATCH')
  })

  it('consumption AMOUNT_MISMATCH', () => {
    const result = compareConsumption(
      { id: 'le-1', amount: 4, quota_key: 'outbound_whatsapp', created_at: NOW },
      { quantity_units: 9, event_type: 'outbound_whatsapp', occurred_at: NOW },
    )
    expect(result.drift_kind).toBe('AMOUNT_MISMATCH')
  })

  it('hold AMOUNT_MISMATCH and capture FIELD_MISMATCH', () => {
    expect(compareHold({ id: 'h1', units: 5, created_at: NOW }, { units: 2, created_at: NOW }).drift_kind)
      .toBe('AMOUNT_MISMATCH')
    expect(compareCapture(
      { id: 'c1', hold_id: 'h1', units: 3, created_at: NOW },
      { id: 'h2', units: 3, created_at: NOW },
    ).drift_kind).toBe('FIELD_MISMATCH')
  })

  it('OTHER for an unknown source', () => {
    expect(compareForSource('commercial.unknown', legacyUsage, finUsage).drift_kind).toBe('OTHER')
  })

  it('holds and captures matching pairs are ok', () => {
    expect(compareHold({ id: 'h1', units: 5, status: 'OPEN', created_at: NOW }, {
      units: 5, status: 'OPEN', created_at: NOW, environment: 'LIVE',
    }, { environment: 'LIVE' }).ok).toBe(true)
    expect(compareCapture({ id: 'c1', hold_id: 'h1', units: 3, created_at: NOW }, {
      id: 'h1', units: 3, created_at: NOW,
    }).ok).toBe(true)
    expect(classifyMirror(SOURCE_HOLDS, { id: 'h1', units: 1 }, []).drift_kind).toBe('MISSING_FIN')
    expect(classifyMirror(SOURCE_CAPTURES, { id: 'c1', units: 1 }, []).drift_kind).toBe('MISSING_FIN')
    expect(classifyMirror(SOURCE_CONSUMPTION, { id: 'le-1', amount: 1, created_at: NOW }, [{
      quantity_units: 1, occurred_at: NOW,
    }]).ok).toBe(true)
  })
})
