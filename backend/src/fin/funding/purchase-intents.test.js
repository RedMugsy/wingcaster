import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FinError } from '../errors.js'
import { finPostgresSuite } from '../testing/suite.js'
import { seedIsolatedHolder } from '../rating/test-support.js'
import { requestFingerprint } from '../idempotency/fingerprint.js'
import {
  cancelPurchase, confirmPurchasePayment, createPurchaseIntent, failPurchase,
  refundPurchase, submitPurchasePayment,
} from './purchase-intents.js'
import { fundingEnv, insertControls, NOW, sampleProduct, seedProduct } from './test-support.js'

describe('purchase-intents validation (fast)', () => {
  it('unknown provider is rejected before a transaction opens', async () => {
    await expect(submitPurchasePayment({
      intentId: randomUUID(),
      provider: 'AIRWALLEX',
      reasonCode: 'TEST',
    })).rejects.toMatchObject({ code: 'UNKNOWN_PROVIDER' })
  })

  it('quote units/minor must be > 0', async () => {
    await expect(createPurchaseIntent({
      reasonCode: 'TEST',
      product: sampleProduct({ units: 0 }),
      holderId: randomUUID(),
      billingAccountId: randomUUID(),
      tenantId: randomUUID(),
    })).rejects.toMatchObject({ code: 'QUOTE_INVALID' })
  })

  it('missing reason_code is rejected', async () => {
    await expect(createPurchaseIntent({
      product: sampleProduct(),
      holderId: randomUUID(),
    })).rejects.toMatchObject({ code: 'REASON_CODE_REQUIRED' })
  })

  it('refundPurchase is reserved NOT_IMPLEMENTED', async () => {
    await expect(refundPurchase({ intentId: randomUUID() })).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    })
  })
})

finPostgresSuite('purchase-intents B §4', {}, ({ pool, world }) => {
  async function createdIntent(extra = {}) {
    const productId = extra.productId || await seedProduct(world())
    return createPurchaseIntent({
      ...fundingEnv(world(), extra),
      productId,
      provider: extra.provider || null,
    })
  }

  it('— → CREATED writes fin.purchase.status and no ledger', async () => {
    const created = await createdIntent()
    expect(created.status).toBe('CREATED')
    const outbox = await pool().query(
      `SELECT topic, dedupe_key FROM fin.outbox_events WHERE dedupe_key LIKE $1`,
      [`purchase:${created.id}:CREATED:%`],
    )
    expect(outbox.rows[0].topic).toBe('fin.purchase.status')
    const txs = await pool().query(
      `SELECT count(*)::int AS n FROM fin.ledger_transactions WHERE economic_source_id = $1`,
      [created.id],
    )
    expect(txs.rows[0].n).toBe(0)
  })

  it('allow_purchases=false → CONTROL_DENY', async () => {
    const { holderId, billingAccountId } = await seedIsolatedHolder(pool(), world(), {
      label: `deny-${randomUUID().slice(0, 6)}`,
    })
    await insertControls(pool(), {
      subjectType: 'HOLDER',
      subjectId: holderId,
      allowPurchases: false,
    })
    const productId = await seedProduct(world())
    await expect(createPurchaseIntent({
      ...fundingEnv(world(), { holderId, billingAccountId }),
      productId,
    })).rejects.toMatchObject({ code: 'CONTROL_DENY' })
  })

  it('CREATED → PAYMENT_PENDING writes webhook.stripe; PSP is not called inline', async () => {
    const created = await createdIntent()
    const submitted = await submitPurchasePayment({
      ...fundingEnv(world()),
      intentId: created.id,
      provider: 'STRIPE',
    })
    expect(submitted.status).toBe('PAYMENT_PENDING')
    const stripe = await pool().query(
      `SELECT payload FROM fin.outbox_events WHERE topic = 'webhook.stripe' AND dedupe_key LIKE $1`,
      [`stripe:${created.id}:%`],
    )
    expect(stripe.rowCount).toBe(1)
    expect(stripe.rows[0].payload.action).toBe('submit')
  })

  it('CREATED → PAID via MANUAL funds lots', async () => {
    const created = await createdIntent({ provider: 'MANUAL' })
    const paid = await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      provider: 'MANUAL',
    })
    expect(paid.status).toBe('PAID')
    expect(paid.lotIds.length).toBe(2)
    const row = await pool().query(`SELECT status FROM fin.purchase_intents WHERE id = $1`, [created.id])
    expect(row.rows[0].status).toBe('PAID')
  })

  it('CREATED → CANCELED', async () => {
    const created = await createdIntent()
    const canceled = await cancelPurchase({
      ...fundingEnv(world()),
      intentId: created.id,
    })
    expect(canceled.status).toBe('CANCELED')
  })

  it('PAYMENT_PENDING → PAID / FAILED / CANCELED', async () => {
    const a = await createdIntent()
    await submitPurchasePayment({ ...fundingEnv(world()), intentId: a.id, provider: 'STRIPE' })
    const paid = await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'PSP', reasonCode: 'PSP_CAPTURE' }),
      intentId: a.id,
      provider: 'STRIPE',
      providerEventId: `evt_${a.id}`,
    })
    expect(paid.status).toBe('PAID')

    const b = await createdIntent()
    await submitPurchasePayment({ ...fundingEnv(world()), intentId: b.id, provider: 'STRIPE' })
    const failed = await failPurchase({
      ...fundingEnv(world(), { actorType: 'PSP', reasonCode: 'PSP_DECLINE' }),
      intentId: b.id,
    })
    expect(failed.status).toBe('FAILED')

    const c = await createdIntent()
    await submitPurchasePayment({ ...fundingEnv(world()), intentId: c.id, provider: 'STRIPE' })
    const canceled = await cancelPurchase({ ...fundingEnv(world()), intentId: c.id })
    expect(canceled.status).toBe('CANCELED')
    const voidOutbox = await pool().query(
      `SELECT payload FROM fin.outbox_events WHERE topic = 'webhook.stripe' AND payload->>'action' = 'void' AND payload->>'intentId' = $1`,
      [c.id],
    )
    expect(voidOutbox.rowCount).toBe(1)
  })

  it('FAILED → PAYMENT_PENDING retry with a new idempotency key', async () => {
    const created = await createdIntent()
    await submitPurchasePayment({ ...fundingEnv(world()), intentId: created.id, provider: 'STRIPE' })
    await failPurchase({
      ...fundingEnv(world(), { actorType: 'PSP', reasonCode: 'PSP_DECLINE' }),
      intentId: created.id,
    })
    const retried = await submitPurchasePayment({
      ...fundingEnv(world()),
      intentId: created.id,
      provider: 'STRIPE',
      idempotencyKey: `PI:SUBMIT:${created.id}:2`,
    })
    expect(retried.status).toBe('PAYMENT_PENDING')
  })

  it('FAILED → CANCELED', async () => {
    const created = await createdIntent()
    await submitPurchasePayment({ ...fundingEnv(world()), intentId: created.id, provider: 'STRIPE' })
    await failPurchase({
      ...fundingEnv(world(), { actorType: 'PSP', reasonCode: 'PSP_DECLINE' }),
      intentId: created.id,
    })
    const canceled = await cancelPurchase({ ...fundingEnv(world()), intentId: created.id })
    expect(canceled.status).toBe('CANCELED')
  })

  it('illegal transitions throw PURCHASE_ILLEGAL_TRANSITION', async () => {
    const created = await createdIntent()
    await expect(failPurchase({
      ...fundingEnv(world(), { reasonCode: 'TEST' }),
      intentId: created.id,
    })).rejects.toMatchObject({ code: 'PURCHASE_ILLEGAL_TRANSITION' })

    const paid = await createdIntent({ provider: 'MANUAL' })
    await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: paid.id,
      provider: 'MANUAL',
    })
    await expect(submitPurchasePayment({
      ...fundingEnv(world()),
      intentId: paid.id,
      provider: 'STRIPE',
    })).rejects.toBeInstanceOf(FinError)
    await expect(cancelPurchase({
      ...fundingEnv(world()),
      intentId: paid.id,
    })).rejects.toMatchObject({ code: 'PURCHASE_ILLEGAL_TRANSITION' })
  })

  it('refundPurchase from PAID stays PAID and throws NOT_IMPLEMENTED', async () => {
    const created = await createdIntent({ provider: 'MANUAL' })
    await confirmPurchasePayment({
      ...fundingEnv(world(), { actorType: 'SYSTEM' }),
      intentId: created.id,
      provider: 'MANUAL',
    })
    await expect(refundPurchase({ intentId: created.id })).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    })
    const row = await pool().query(`SELECT status FROM fin.purchase_intents WHERE id = $1`, [created.id])
    expect(row.rows[0].status).toBe('PAID')
  })

  it('concurrent submitPurchasePayment: one wins, one IDEMPOTENCY_KEY_IN_FLIGHT', async () => {
    const created = await createdIntent()
    // Claim+complete share one tx, so a live winner never commits IN_FLIGHT.
    // A committed IN_FLIGHT row is how E §5 409 is observed (same as C12).
    await pool().query(
      `INSERT INTO fin.idempotency_keys (
         id, environment, tenant_id, key, request_fingerprint, status,
         expires_at, created_at, created_by_actor_type, updated_at
       ) VALUES ($1, 'LIVE', $2, $3, $4, 'IN_FLIGHT', $6, $5, 'USER', $5)`,
      [
        randomUUID(),
        world().tenantA.tenantId,
        `PI:SUBMIT:${created.id}`,
        requestFingerprint({
          cmd: 'SubmitPurchasePayment', intentId: created.id, provider: 'STRIPE',
        }),
        NOW,
        '2099-01-01T00:00:00.000Z',
      ],
    )
    await expect(submitPurchasePayment({
      ...fundingEnv(world()),
      intentId: created.id,
      provider: 'STRIPE',
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_IN_FLIGHT' })
  })
})
