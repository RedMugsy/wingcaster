import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { transaction } from '../../db.js'
import { NOW } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { insertAudit } from './write.js'

finPostgresSuite('audit JCS boolean', {}, ({ pool }) => {
  it('accepts an audit payload with a JSON boolean', async () => {
    const targetId = randomUUID()
    await transaction(async (client) => {
      await insertAudit(client, {
        environment: 'LIVE',
        actorType: 'SYSTEM',
        actorId: null,
        actorEmail: 'test@fin.local',
        action: 'JCS_BOOLEAN_PROBE',
        targetType: 'TEST',
        targetId,
        afterState: { flag_true: true, flag_false: false, nested: { flag: true } },
        reasonCode: 'TEST',
        now: NOW,
      })
    })
    const stored = await pool().query(
      `SELECT after_state FROM fin.financial_audit_events
        WHERE action = 'JCS_BOOLEAN_PROBE' AND target_id = $1`,
      [targetId],
    )
    expect(stored.rowCount).toBe(1)
    expect(stored.rows[0].after_state.flag_true).toBe(true)
    expect(stored.rows[0].after_state.flag_false).toBe(false)
    expect(stored.rows[0].after_state.nested.flag).toBe(true)

    const canonical = await pool().query(
      `SELECT fin.json_canonical($1::jsonb) AS jcs`,
      [JSON.stringify({ flag_true: true, flag_false: false })],
    )
    expect(canonical.rows[0].jcs).toBe('{"flag_false":false,"flag_true":true}')
  })
})
