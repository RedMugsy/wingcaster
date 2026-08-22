/**
 * Fast suite — attestation hash determinism and 30-day GREEN eligibility.
 */
import { describe, expect, it } from 'vitest'
import {
  attestationEvidence, consecutiveGreenDays, hashAttestation,
} from './attestation.js'

const ENV = 'LIVE'

function daily(id, source, day, status = 'GREEN') {
  return {
    id,
    source,
    status,
    window_start: `${day}T00:00:00.000Z`,
    window_end: `${day.slice(0, 8)}${String(Number(day.slice(8, 10)) + 1).padStart(2, '0')}T00:00:00.000Z`,
    generated_at: `${day}T02:00:00.000Z`,
    rows_checked: 10,
    rows_drifted: 0,
  }
}

function thirtyGreen(source, endDay = '2026-08-17') {
  const rows = []
  const end = Date.parse(`${endDay}T00:00:00.000Z`)
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(end - i * 86400000)
    const day = d.toISOString().slice(0, 10)
    rows.push(daily(`r-${source}-${day}`, source, day))
  }
  return rows
}

describe('parity attestation', () => {
  it('hash is deterministic for the same evidence set', () => {
    const evidence = {
      environment: ENV,
      firstGreenAt: '2026-07-19T02:00:00.000Z',
      lastGreenAt: '2026-08-17T02:00:00.000Z',
      reportIds: ['b-id', 'a-id'],
      totalRowsChecked: 100,
      totalRowsDrifted: 0,
      outstandingCorrections: 2,
    }
    const a = hashAttestation(evidence)
    const b = hashAttestation({ ...evidence, reportIds: ['a-id', 'b-id'] })
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
    expect(hashAttestation({ ...evidence, totalRowsChecked: 101 })).not.toBe(a)
    expect(attestationEvidence(evidence).reports).toEqual(['a-id', 'b-id'])
  })

  it('eligibility requires 30 consecutive GREEN days', () => {
    const now = '2026-08-18T12:00:00.000Z'
    const full = thirtyGreen('commercial.usage_events')
    const streak = consecutiveGreenDays(full, now, { burnInDays: 30 })
    expect(streak.consecutive).toBe(30)
    expect(streak.gaps.filter((g) => g.day >= '2026-07-19')).toHaveLength(0)

    const short = full.slice(-10)
    const shortStreak = consecutiveGreenDays(short, now, { burnInDays: 30 })
    expect(shortStreak.consecutive).toBe(10)
    expect(shortStreak.consecutive >= 30).toBe(false)

    const withAmber = full.map((row) => (
      row.window_start.startsWith('2026-08-10') ? { ...row, status: 'AMBER' } : row
    ))
    const broken = consecutiveGreenDays(withAmber, now, { burnInDays: 30 })
    expect(broken.consecutive).toBeLessThan(30)
    expect(broken.gaps.some((g) => g.reason === 'AMBER')).toBe(true)
  })

  it('empty reports yield consecutive 0 (not eligible; recon R094 stays GREEN)', () => {
    const streak = consecutiveGreenDays([], '2026-08-18T12:00:00.000Z', { burnInDays: 30 })
    expect(streak.consecutive).toBe(0)
    expect(streak.gaps).toEqual([])
    expect(streak.reportIds).toEqual([])
  })
})
