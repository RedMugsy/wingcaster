import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { authorizeUsage } from './authorize.js'
import { captureUsage } from './capture.js'
import { authInput, postingSum, seedAuthHolder } from './test-support.js'
import { voidUsage } from './void.js'

finPostgresSuite('captureUsage / voidUsage', {}, ({ pool, world }) => {
  it('captureUsage on OPEN → CAPTURED with CAPTURE tx and HELD→CONSUMED', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'cap', units: 80 })
    const authorized = await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 20,
      idempotencyKey: `AUTH:${randomUUID()}`,
    }))
    const captured = await captureUsage({
      holdId: authorized.holdId,
      idempotencyKey: `CAPTURE:${authorized.holdId}`,
      now: world().now,
      reasonCode: 'TEST',
      actorType: 'SYSTEM',
    })
    const hold = await pool().query(
      `SELECT status, capture_tx_id FROM fin.holds WHERE id = $1`,
      [authorized.holdId],
    )
    expect(hold.rows[0].status).toBe('CAPTURED')
    expect(hold.rows[0].capture_tx_id).toBe(captured.txId)
    const tx = await pool().query(
      `SELECT shape FROM fin.ledger_transactions WHERE id = $1`,
      [captured.txId],
    )
    expect(tx.rows[0].shape).toBe('CAPTURE')
    expect(await postingSum(pool(), {
      transactionId: captured.txId, accountType: 'CONSUMED',
    })).toBe('20')
    expect(await postingSum(pool(), {
      transactionId: captured.txId, accountType: 'HELD',
    })).toBe('-20')
  })

  it('voidUsage on OPEN → VOIDED with VOID tx and HELD→AVAILABLE', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'void', units: 80 })
    const authorized = await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 15,
      idempotencyKey: `AUTH:${randomUUID()}`,
    }))
    const voided = await voidUsage({
      holdId: authorized.holdId,
      idempotencyKey: `VOID:${authorized.holdId}`,
      now: world().now,
      reasonCode: 'TEST',
      actorType: 'SYSTEM',
    })
    const hold = await pool().query(
      `SELECT status, release_tx_id FROM fin.holds WHERE id = $1`,
      [authorized.holdId],
    )
    expect(hold.rows[0].status).toBe('VOIDED')
    expect(hold.rows[0].release_tx_id).toBe(voided.txId)
    const tx = await pool().query(
      `SELECT shape FROM fin.ledger_transactions WHERE id = $1`,
      [voided.txId],
    )
    expect(tx.rows[0].shape).toBe('VOID')
    expect(await postingSum(pool(), {
      transactionId: voided.txId, accountType: 'AVAILABLE',
    })).toBe('15')
    expect(await postingSum(pool(), {
      transactionId: voided.txId, accountType: 'HELD',
    })).toBe('-15')
    const lot = await pool().query(
      `SELECT remaining_units::text AS rem FROM fin.lots WHERE id = $1`,
      [seeded.lotId],
    )
    expect(lot.rows[0].rem).toBe('80')
  })
})
