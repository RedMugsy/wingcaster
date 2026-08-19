import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { finPostgresSuite } from '../testing/suite.js'
import { authorizeUsage } from './authorize.js'
import {
  authInput, insertApplicabilityRule, insertLimit, postingSum, seedAuthHolder,
} from './test-support.js'

describe('authorizeUsage validation', () => {
  it('throws IDEMPOTENCY_KEY_REQUIRED when no idempotency anchor is supplied', async () => {
    await expect(authorizeUsage({
      environment: 'LIVE',
      unitsRequested: 1,
      reasonCode: 'TEST',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' })
  })
})

finPostgresSuite('authorizeUsage', {}, ({ pool, world }) => {
  it('happy path: 30 of 100 units held with allocation -30', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'auth-ok', units: 100 })
    const result = await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 30,
      idempotencyKey: `AUTH:${randomUUID()}`,
    }))
    expect(result.ok).toBe(true)
    expect(result.holdId).toBeTruthy()
    expect(result.txId).toBeTruthy()
    expect(result.allocations).toEqual([{ lotId: seeded.lotId, units: '30' }])

    const hold = await pool().query(`SELECT units::text AS u, status FROM fin.holds WHERE id = $1`, [
      result.holdId,
    ])
    expect(hold.rows[0]).toMatchObject({ u: '30', status: 'OPEN' })
    expect(await postingSum(pool(), { transactionId: result.txId, accountType: 'HELD' })).toBe('30')

    const alloc = await pool().query(
      `SELECT units::text AS u FROM fin.lot_allocations WHERE hold_id = $1`,
      [result.holdId],
    )
    expect(alloc.rows[0].u).toBe('-30')
    const lot = await pool().query(
      `SELECT remaining_units::text AS rem FROM fin.lots WHERE id = $1`,
      [seeded.lotId],
    )
    expect(lot.rows[0].rem).toBe('70')
  })

  it('insufficient eligible credits writes DENIED attempt', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'auth-short', units: 5 })
    const result = await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 10,
      idempotencyKey: `AUTH:${randomUUID()}`,
    }))
    expect(result).toMatchObject({ ok: false, denialCode: 'INSUFFICIENT_ELIGIBLE_CREDITS' })
    expect(result.holdId).toBeFalsy()
    const attempt = await pool().query(
      `SELECT result, denial_code FROM fin.authorization_attempts WHERE id = $1`,
      [result.authorizationAttemptId],
    )
    expect(attempt.rows[0]).toMatchObject({
      result: 'DENIED', denial_code: 'INSUFFICIENT_ELIGIBLE_CREDITS',
    })
    const holds = await pool().query(
      `SELECT count(*)::int AS n FROM fin.holds WHERE holder_id = $1`,
      [seeded.holderId],
    )
    expect(holds.rows[0].n).toBe(0)
  })

  it('applicability DENY_METER yields insufficient (no eligible lots)', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'auth-deny', units: 100 })
    await insertApplicabilityRule(pool(), {
      lotId: seeded.lotId,
      ruleKind: 'DENY_METER',
      matcher: seeded.meterId,
    })
    const result = await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 10,
      idempotencyKey: `AUTH:${randomUUID()}`,
    }))
    expect(result).toMatchObject({
      ok: false, denialCode: 'INSUFFICIENT_ELIGIBLE_CREDITS',
    })
  })

  it('usage limit BLOCK returns LIMIT_BLOCKED and DENIED attempt', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'auth-limit', units: 100 })
    await insertLimit(pool(), {
      tenantId: seeded.tenantId,
      meterId: seeded.meterId,
      limitUnits: 100,
      consumedUnits: 95,
      periodKey: '2026-08',
    })
    const result = await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 10,
      idempotencyKey: `AUTH:${randomUUID()}`,
    }))
    expect(result).toMatchObject({ ok: false, denialCode: 'LIMIT_BLOCKED' })
    const attempt = await pool().query(
      `SELECT result, denial_code FROM fin.authorization_attempts WHERE id = $1`,
      [result.authorizationAttemptId],
    )
    expect(attempt.rows[0]).toMatchObject({ result: 'DENIED', denial_code: 'LIMIT_BLOCKED' })
  })

  it('concurrent authorize on the same holder: one succeeds, one denies', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'auth-race', units: 100 })
    const [a, b] = await Promise.all([
      authorizeUsage(authInput(world(), seeded, {
        unitsRequested: 60,
        idempotencyKey: `AUTH:${randomUUID()}`,
      })),
      authorizeUsage(authInput(world(), seeded, {
        unitsRequested: 60,
        idempotencyKey: `AUTH:${randomUUID()}`,
      })),
    ])
    const outcomes = [a, b]
    const ok = outcomes.filter((row) => row.ok)
    const denied = outcomes.filter((row) => !row.ok)
    expect(ok).toHaveLength(1)
    expect(denied).toHaveLength(1)
    expect(denied[0].denialCode).toBe('INSUFFICIENT_ELIGIBLE_CREDITS')
    const lot = await pool().query(
      `SELECT remaining_units::text AS rem FROM fin.lots WHERE id = $1`,
      [seeded.lotId],
    )
    expect(lot.rows[0].rem).toBe('40')
  })

  it('idempotent replay returns the same holdId', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'auth-idemp', units: 100 })
    const key = `AUTH:${randomUUID()}`
    const first = await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 12,
      idempotencyKey: key,
    }))
    const second = await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 12,
      idempotencyKey: key,
    }))
    expect(second.holdId).toBe(first.holdId)
    expect(second.txId).toBe(first.txId)
    const holds = await pool().query(
      `SELECT count(*)::int AS n FROM fin.holds WHERE holder_id = $1`,
      [seeded.holderId],
    )
    expect(holds.rows[0].n).toBe(1)
  })

  it('fingerprint conflict when actionKey differs on the same idempotency key', async () => {
    const seeded = await seedAuthHolder(pool(), world(), { label: 'auth-fp', units: 100 })
    const key = `AUTH:${randomUUID()}`
    await authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 10,
      idempotencyKey: key,
      actionKey: 'send',
    }))
    await expect(authorizeUsage(authInput(world(), seeded, {
      unitsRequested: 10,
      idempotencyKey: key,
      actionKey: 'read',
    }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_FINGERPRINT_CONFLICT' })
  })
})
