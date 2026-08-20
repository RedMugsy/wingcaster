import { expect, it } from 'vitest'
import { commandEnv, insertApproval } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import {
  approveInvoice, draftInvoice, issueInvoice, voidIssuedInvoice,
} from './invoice-issuer.js'
import { seedIssuedInvoice } from './test-support.js'

async function draftApproved(world, extra = {}) {
  const env = commandEnv(world, { reasonCode: 'TEST' })
  const drafted = await draftInvoice({
    ...env,
    billingAccountId: world.tenantA.billingAccountId,
    legalEntityId: world.legalEntityId,
    currency: 'USD',
    dueAt: extra.dueAt || '2027-01-01T00:00:00.000Z',
    clientKey: extra.clientKey,
    lines: extra.lines || [{
      sourceType: 'ADJUSTMENT',
      sourceId: extra.sourceId,
      quantity: 1,
      unit_rate_minor: extra.amountMinor || 50,
      amount_minor: extra.amountMinor || 50,
      description: 'line',
    }],
  })
  await approveInvoice({ ...env, invoiceId: drafted.invoiceId })
  return { env, invoiceId: drafted.invoiceId }
}

finPostgresSuite('billing invoices B §16', {}, ({ pool, world }) => {
  it('walks DRAFT → APPROVED → ISSUED; VOID keeps the number; next ISSUE is monotonic', async () => {
    const first = await seedIssuedInvoice(pool(), world(), { amountMinor: 40 })
    expect(first.status).toBe('ISSUED')
    expect(first.invoiceNumber).toBeTruthy()

    await expect(issueInvoice({
      ...commandEnv(world(), { reasonCode: 'TEST' }),
      invoiceId: first.invoiceId,
      idempotencyKey: `INV:ISSUE:again:${first.invoiceId}`,
    })).rejects.toMatchObject({ code: 'INVOICE_NOT_DRAFT' })

    const approvalId = await insertApproval(pool(), {
      tenantId: world().tenantA.tenantId,
      actionKind: 'INVOICE_VOID',
      status: 'APPROVED',
    })
    const voided = await voidIssuedInvoice({
      ...commandEnv(world(), { reasonCode: 'TEST', actorType: 'USER' }),
      invoiceId: first.invoiceId,
      approvalRequestId: approvalId,
    })
    expect(voided.status).toBe('VOID')
    expect(voided.invoiceNumber).toBe(first.invoiceNumber)

    const second = await seedIssuedInvoice(pool(), world(), { amountMinor: 41 })
    expect(second.invoiceNumber).not.toBe(first.invoiceNumber)
    expect(second.assigned).toBeGreaterThan(first.assigned)
  })

  it('rejects DRAFT → ISSUED and APPROVED → PAID', async () => {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const { randomUUID } = await import('node:crypto')
    const drafted = await draftInvoice({
      ...env,
      billingAccountId: world().tenantA.billingAccountId,
      legalEntityId: world().legalEntityId,
      currency: 'USD',
      clientKey: randomUUID(),
      lines: [{
        sourceType: 'ADJUSTMENT', sourceId: randomUUID(),
        quantity: 1, unit_rate_minor: 10, amount_minor: 10, description: 'x',
      }],
    })
    await expect(issueInvoice({
      ...env, invoiceId: drafted.invoiceId, idempotencyKey: `INV:SKIP:${drafted.invoiceId}`,
    })).rejects.toMatchObject({ code: 'INVOICE_NOT_DRAFT' })
    const { invoiceId } = await draftApproved(world(), { sourceId: randomUUID(), clientKey: randomUUID() })
    await expect(pool().query(
      `UPDATE fin.invoices SET status = 'PAID' WHERE id = $1`,
      [invoiceId],
    )).rejects.toBeTruthy()
  })
})
