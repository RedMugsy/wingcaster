import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { FinError } from '../errors.js'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { evaluateFilter, filterToSql, validateFilter } from './filter.js'

const EVENT_TYPES = [
  'message.out.whatsapp.utility',
  'message.out.whatsapp.marketing',
  'message.in.whatsapp',
  'sms.out',
  'ai.chat.turn',
]
const CHANNELS = ['whatsapp', 'sms', 'instagram', 'email']
const COUNTRIES = ['SA', 'AE', 'US', 'GB', 'EG']

function mulberry32(seed) {
  let a = seed
  return () => {
    a += 0x6D2B79F5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)]
}

const FILTER = {
  event_types: [
    'message.out.whatsapp.utility',
    'message.out.whatsapp.marketing',
    'sms.out',
  ],
  dimensions: {
    channel: ['whatsapp', 'sms'],
    destination_country: ['SA', 'AE', 'US'],
  },
  excludes: {
    dimensions: { destination_country: 'US' },
  },
}

finPostgresSuite('metering filter DSL', {}, ({ pool, world }) => {
  it('throws FIN_FILTER_INVALID on unknown keys', () => {
    expect(() => validateFilter({ event_types: ['x'], extra: true })).toThrow(FinError)
    expect(() => validateFilter({ event_types: ['x'], extra: true })).toThrowError(/FIN_FILTER_INVALID/)
    expect(() => validateFilter({ excludes: { foo: 1 } })).toThrowError(/FIN_FILTER_INVALID/)
  })

  it('evaluateFilter and filterToSql agree on 100 random events', async () => {
    const rng = mulberry32(20260819)
    const events = []
    for (let n = 0; n < 100; n += 1) {
      events.push({
        id: randomUUID(),
        event_type: pick(rng, EVENT_TYPES),
        dimensions: {
          channel: pick(rng, CHANNELS),
          destination_country: pick(rng, COUNTRIES),
        },
      })
    }

    const rowsSql = events.map((_, idx) => {
      const b = idx * 6
      return `($${b + 1},'LIVE','ksa',$${b + 2},$${b + 3},'orchestrator',$${b + 4},$${b + 5},'ORIGINAL',1000000,$${b + 6}::jsonb,'${NOW}'::timestamptz,'${NOW}'::timestamptz,1,'${NOW}'::timestamptz)`
    }).join(',')
    await pool().query(
      `INSERT INTO fin.usage_events (
         id, environment, residency_key, tenant_id, holder_id,
         source_system, source_event_id, event_type, event_kind,
         quantity_units, dimensions, occurred_at, received_at, ingestion_version, created_at
       ) VALUES ${rowsSql}`,
      events.flatMap((event) => [
        event.id,
        world().tenantA.tenantId,
        world().tenantA.holderId,
        event.id,
        event.event_type,
        JSON.stringify(event.dimensions),
      ]),
    )

    const jsMatched = new Set(
      events.filter((event) => evaluateFilter(event, FILTER)).map((event) => event.id),
    )
    const { where, params: filterParams } = filterToSql(FILTER, 'e', 1)
    const sqlMatched = await pool().query(
      `SELECT id FROM fin.usage_events e
        WHERE ${where} AND e.holder_id = $${filterParams.length + 1}`,
      [...filterParams, world().tenantA.holderId],
    )
    const sqlSet = new Set(sqlMatched.rows.map((row) => row.id))
    expect(sqlSet).toEqual(jsMatched)
    expect(jsMatched.size).toBeGreaterThan(0)
    expect(jsMatched.size).toBeLessThan(100)
  })
})
