import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { runReconciliation } from './runner.js'

finPostgresSuite('reconciliation R030–R039', {}, ({ pool }) => {
  it('R030 R032 R033 R034 R037 (and R031 R035 R036 R038 R039) are GREEN on an empty usage world', async () => {
    const run = await runReconciliation(pool(), { now: NOW })
    const byCode = Object.fromEntries(run.results.map((r) => [r.check_code, r]))
    for (const code of [
      'R030', 'R031', 'R032', 'R033', 'R034', 'R035', 'R036', 'R037', 'R038', 'R039',
    ]) {
      expect(byCode[code], code).toBeTruthy()
      expect(byCode[code].result, code).toBe('GREEN')
    }
  })

  it('R033 DRIFT when an open DLQ row is overdue', async () => {
    await pool().query(
      `INSERT INTO fin.usage_events_dlq (
         id, environment, residency_key, source_system, source_event_id,
         event_type, payload, error_code, error_message, attempts,
         next_retry_at, created_at, updated_at
       ) VALUES (
         $1, 'LIVE', 'ksa', 'orchestrator', $2,
         'message.out.whatsapp.utility', '{}'::jsonb, 'DB_ERROR', 'stale', 1,
         '2026-08-18T11:00:00.000Z', $3, $3
       )`,
      [randomUUID(), randomUUID(), NOW],
    )
    const run = await runReconciliation(pool(), { now: NOW })
    expect(run.results.find((r) => r.check_code === 'R033').result).toBe('DRIFT')
  })
})
