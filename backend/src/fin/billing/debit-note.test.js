import { expect, it } from 'vitest'
import { commandEnv, insertApproval } from '../testing/seed.js'
import { finPostgresSuite } from '../testing/suite.js'
import { seedIssuedInvoice } from './test-support.js'
import {
  approveDebitNote, draftDebitNote, issueDebitNote, voidIssuedDebitNote,
} from './debit-note.js'

finPostgresSuite('billing debit notes B §17', {}, ({ pool, world }) => {
  it('walks DRAFT → APPROVED → ISSUED; VOID keeps the note number', async () => {
    const issued = await seedIssuedInvoice(pool(), world(), { amountMinor: 80 })
    const env = commandEnv(world(), { reasonCode: 'TEST' })
    const drafted = await draftDebitNote({
      ...env, invoiceId: issued.invoiceId, amountMinor: 15,
    })
    await approveDebitNote({ ...env, noteId: drafted.noteId })
    const note = await issueDebitNote({ ...env, noteId: drafted.noteId })
    expect(note.status).toBe('ISSUED')
    expect(note.noteNumber).toMatch(/^DN-SA-2026-/)

    const approvalId = await insertApproval(pool(), {
      tenantId: world().tenantA.tenantId,
      actionKind: 'INVOICE_VOID',
      status: 'APPROVED',
    })
    const voided = await voidIssuedDebitNote({
      ...env, actorType: 'USER', noteId: drafted.noteId, approvalRequestId: approvalId,
    })
    expect(voided.status).toBe('VOID')
    expect(voided.noteNumber).toBe(note.noteNumber)
  })
})
