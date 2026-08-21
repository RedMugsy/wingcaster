/**
 * Fast suite — start / complete / resume state machine (no Postgres).
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { startBatch, completeBatch, latestCompletedAt, latestCompletedCursor } from './progress.js'

function memoryDb() {
  const rows = []
  async function q(sql, params = []) {
    if (/INSERT INTO fin.cutover_backfill_progress/i.test(sql) && params.length === 7) {
      rows.push({
        id: params[0],
        environment: params[1],
        source: params[2],
        last_processed_at: null,
        last_processed_id: null,
        rows_processed: 0,
        rows_written: 0,
        rows_corrected: 0,
        batch_id: params[3],
        started_at: params[4],
        completed_at: null,
        actor_type: params[5],
        actor_id: params[6],
      })
      return []
    }
    if (/INSERT INTO fin.cutover_backfill_progress/i.test(sql) && params.length === 13) {
      rows.push({
        id: params[0],
        environment: params[1],
        source: params[2],
        last_processed_at: params[3],
        last_processed_id: params[4],
        rows_processed: params[5],
        rows_written: params[6],
        rows_corrected: params[7],
        batch_id: params[8],
        started_at: params[9],
        completed_at: params[10],
        actor_type: params[11],
        actor_id: params[12],
      })
      return []
    }
    if (/WHERE id = \$1/i.test(sql)) {
      return rows.filter((r) => r.id === params[0])
    }
    if (/MAX\(last_processed_at\)/i.test(sql)) {
      const completed = rows.filter((r) => r.source === params[0]
        && r.environment === params[1]
        && r.completed_at)
      const max = completed.reduce((acc, r) => {
        if (!r.last_processed_at) return acc
        if (!acc || r.last_processed_at > acc) return r.last_processed_at
        return acc
      }, null)
      return [{ last_processed_at: max }]
    }
    if (/ORDER BY last_processed_at DESC/i.test(sql)) {
      return rows
        .filter((r) => r.source === params[0]
          && r.environment === params[1]
          && r.completed_at
          && r.last_processed_at)
        .sort((a, b) => String(b.last_processed_at).localeCompare(String(a.last_processed_at)))
        .slice(0, 1)
    }
    return []
  }
  return { q, rows }
}

const SOURCE = 'commercial.usage_events'
const NOW = '2026-08-10T00:00:00.000Z'

describe('cutover backfill progress', () => {
  it('start then complete records resume point without updating the start row', async () => {
    const db = memoryDb()
    const started = await startBatch({
      source: SOURCE, environment: 'LIVE', now: NOW, query: db.q,
    })
    expect(started.id).toBeTruthy()
    expect(started.batchId).toBeTruthy()
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0].completed_at).toBeNull()

    const done = await completeBatch({
      id: started.id,
      rowsProcessed: 10,
      rowsWritten: 8,
      rowsCorrected: 2,
      lastProcessedAt: '2026-08-09T00:00:00.000Z',
      lastProcessedId: 'evt-10',
      now: '2026-08-10T01:00:00.000Z',
      query: db.q,
    })
    expect(done.batchId).toBe(started.batchId)
    expect(db.rows).toHaveLength(2)
    expect(db.rows[0].completed_at).toBeNull()
    expect(db.rows[0].last_processed_at).toBeNull()
    expect(db.rows[1].completed_at).toBe('2026-08-10T01:00:00.000Z')
    expect(db.rows[1].last_processed_at).toBe('2026-08-09T00:00:00.000Z')
    expect(db.rows[1].rows_written).toBe(8)
  })

  it('latestCompletedAt / cursor resume from the completed row', async () => {
    const db = memoryDb()
    const first = await startBatch({
      source: SOURCE, now: NOW, query: db.q, actorId: randomUUID(),
    })
    await completeBatch({
      id: first.id,
      lastProcessedAt: '2026-08-05T00:00:00.000Z',
      lastProcessedId: 'a',
      rowsProcessed: 5,
      now: '2026-08-05T01:00:00.000Z',
      query: db.q,
    })
    const second = await startBatch({
      source: SOURCE, now: '2026-08-06T00:00:00.000Z', query: db.q,
    })
    await completeBatch({
      id: second.id,
      lastProcessedAt: '2026-08-08T12:00:00.000Z',
      lastProcessedId: 'z',
      rowsProcessed: 3,
      now: '2026-08-08T13:00:00.000Z',
      query: db.q,
    })

    const at = await latestCompletedAt({ source: SOURCE, query: db.q })
    expect(String(at)).toBe('2026-08-08T12:00:00.000Z')
    const cursor = await latestCompletedCursor({ source: SOURCE, query: db.q })
    expect(cursor.last_processed_id).toBe('z')
    expect(Number(cursor.rows_processed)).toBe(3)
  })
})
