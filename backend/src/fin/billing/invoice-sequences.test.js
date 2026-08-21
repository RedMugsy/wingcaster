import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { commandEnv } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { approveInvoice, draftInvoice, issueInvoice } from './invoice-issuer.js'

finPostgresSuite('billing invoice sequences', {}, ({ pool, world }) => {
  async function approvedInvoice(suffix) {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const drafted = await draftInvoice({
      ...env,
      billingAccountId: world().tenantA.billingAccountId,
      legalEntityId: world().legalEntityId,
      currency: 'USD',
      clientKey: `${suffix}-${randomUUID()}`,
      lines: [{
        sourceType: 'ADJUSTMENT',
        sourceId: randomUUID(),
        quantity: 1,
        unit_rate_minor: 12,
        amount_minor: 12,
        description: suffix,
      }],
    })
    await approveInvoice({ ...env, invoiceId: drafted.invoiceId })
    return { env, invoiceId: drafted.invoiceId }
  }

  it('concurrent IssueInvoice on the same tuple gets distinct numbers', async () => {
    const a = await approvedInvoice('a')
    const b = await approvedInvoice('b')
    const [one, two] = await Promise.all([
      issueInvoice({ ...a.env, invoiceId: a.invoiceId, fiscalContext: '2026' }),
      issueInvoice({ ...b.env, invoiceId: b.invoiceId, fiscalContext: '2026' }),
    ])
    expect(one.invoiceNumber).not.toBe(two.invoiceNumber)
    expect(new Set([one.assigned, two.assigned]).size).toBe(2)
  })

  it('different fiscal_context uses a separate counter', async () => {
    const a = await approvedInvoice('fy')
    const b = await approvedInvoice('zatca')
    const std = await issueInvoice({
      ...a.env, invoiceId: a.invoiceId, fiscalContext: '2026',
    })
    const zatca = await issueInvoice({
      ...b.env, invoiceId: b.invoiceId, fiscalContext: '2026-ZATCA',
    })
    expect(std.invoiceNumber).toMatch(/INV-SA-2026-/)
    expect(zatca.invoiceNumber).toMatch(/INV-SA-2026-ZATCA-/)
    expect(std.invoiceNumber).not.toBe(zatca.invoiceNumber)
  })
})
