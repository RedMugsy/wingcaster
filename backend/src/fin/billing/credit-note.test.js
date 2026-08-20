import { expect, it } from 'vitest'
import { commandEnv, insertApproval } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { seedIssuedInvoice } from './test-support.js'
import {
  approveCreditNote, draftCreditNote, issueCreditNote, voidIssuedNote,
} from './credit-note.js'

finPostgresSuite('billing credit notes B §17', {}, ({ pool, world }) => {
  it('walks DRAFT → APPROVED → ISSUED; VOID keeps the note number', async () => {
    const issued = await seedIssuedInvoice(pool(), world(), { amountMinor: 80 })
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const drafted = await draftCreditNote({
      ...env, invoiceId: issued.invoiceId, amountMinor: 20,
    })
    expect(drafted.status).toBe('DRAFT')
    await approveCreditNote({ ...env, noteId: drafted.noteId })
    const note = await issueCreditNote({ ...env, noteId: drafted.noteId })
    expect(note.status).toBe('ISSUED')
    expect(note.noteNumber).toMatch(/^CN-SA-2026-/)

    const approvalId = await insertApproval(pool(), {
      tenantId: world().tenantA.tenantId,
      actionKind: 'INVOICE_VOID',
      status: 'APPROVED',
    })
    const voided = await voidIssuedNote({
      ...env, actorType: 'USER', noteId: drafted.noteId, approvalRequestId: approvalId,
    })
    expect(voided.status).toBe('VOID')
    expect(voided.noteNumber).toBe(note.noteNumber)
  })

  it('rejects a note against a non-issued invoice', async () => {
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    await expect(draftCreditNote({
      ...env, invoiceId: world().tenantA.billingAccountId, amountMinor: 1,
    })).rejects.toMatchObject({ code: 'NOTE_PARENT_NOT_ISSUED' })
  })
})
