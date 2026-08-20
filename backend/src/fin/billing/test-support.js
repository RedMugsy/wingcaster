import { randomUUID } from 'node:crypto'
import { NOW, commandEnv } from '../testing/seed.js'
import { draftInvoice, approveInvoice, issueInvoice } from './invoice-issuer.js'
import { openBillingPeriod } from './periods.js'

export async function seedInvoiceSequences(client, {
  environment = 'LIVE',
  legalEntityId,
  jurisdiction = 'SA',
  fiscalContexts = ['2026', '2026-ZATCA'],
  now = NOW,
} = {}) {
  const ids = {}
  for (const docType of ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']) {
    for (const fiscal of fiscalContexts) {
      const id = randomUUID()
      const prefix = `${docType === 'INVOICE' ? 'INV' : docType === 'CREDIT_NOTE' ? 'CN' : 'DN'}-${jurisdiction}-${fiscal}-`
      await client.query(
        `INSERT INTO fin.invoice_sequences (
           id, environment, legal_entity_id, jurisdiction, doc_type,
           fiscal_context, prefix, next_n, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$8)
         ON CONFLICT (environment, legal_entity_id, jurisdiction, doc_type, fiscal_context)
         DO NOTHING`,
        [id, environment, legalEntityId, jurisdiction, docType, fiscal, prefix, now],
      )
      ids[`${docType}:${fiscal}`] = id
    }
  }
  return ids
}

export async function seedIssuedInvoice(pool, world, {
  amountMinor = 100,
  dueAt = '2020-01-01T00:00:00.000Z',
  currency = 'USD',
  now = NOW,
} = {}) {
  const env = commandEnv(world, { reasonCode: 'TEST', now })
  const sourceId = randomUUID()
  const drafted = await draftInvoice({
    ...env,
    billingAccountId: world.tenantA.billingAccountId,
    legalEntityId: world.legalEntityId,
    currency,
    dueAt,
    clientKey: sourceId,
    lines: [{
      sourceType: 'ADJUSTMENT',
      sourceId,
      quantity: 1,
      unit_rate_minor: amountMinor,
      amount_minor: amountMinor,
      description: 'fixture line',
    }],
  })
  await approveInvoice({ ...env, invoiceId: drafted.invoiceId })
  const issued = await issueInvoice({
    ...env,
    invoiceId: drafted.invoiceId,
    fiscalContext: '2026',
  })
  return { ...issued, invoiceId: drafted.invoiceId, dueAt, amountMinor }
}

export async function seedOpenEndedPeriod(world, extra = {}) {
  const env = commandEnv(world, { reasonCode: 'TEST', now: extra.now || NOW })
  return openBillingPeriod({
    ...env,
    billingAccountId: extra.billingAccountId || world.tenantA.billingAccountId,
    periodKey: extra.periodKey || `bp-${randomUUID().slice(0, 8)}`,
    startsAt: extra.startsAt || '2026-07-01T00:00:00.000Z',
    endsAt: extra.endsAt || '2026-08-01T00:00:00.000Z',
  })
}
