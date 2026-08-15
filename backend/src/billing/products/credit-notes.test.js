import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { closeDb, configure, query } from '../../db.js'
import { skipIfNoPostgres, withTestDb } from '../../testing/postgres.js'
import {
  applyNote, issueNote, listNotes, pendingBalance, sweepExpiredNotes, voidNote,
} from './credit-notes.js'

skipIfNoPostgres()('credit-notes', () => {
  it('issue: happy path, positive credit stored as pending', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = randomUUID()
        const note = await issueNote({
          tenantId,
          type: 'courtesy',
          amountMinor: 500,
          currency: 'usd',
          reason: 'welcome credit',
          actorType: 'admin',
          actorId: 'admin-1',
        })
        expect(note.status).toBe('pending')
        expect(note.currency).toBe('USD')
        expect(note.amount_minor).toBe(500)
      } finally {
        await closeDb()
      }
    })
  })

  it('issue: rejects zero amount, invalid type, invalid currency, invalid actor', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const base = { tenantId: 'x', type: 'courtesy', amountMinor: 100, currency: 'USD' }
        await expect(issueNote({ ...base, amountMinor: 0 })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' })
        await expect(issueNote({ ...base, type: 'bogus' })).rejects.toMatchObject({ code: 'INVALID_TYPE' })
        await expect(issueNote({ ...base, currency: 'USDT' })).rejects.toMatchObject({ code: 'INVALID_CURRENCY' })
        await expect(issueNote({ ...base, actorType: 'nope' })).rejects.toMatchObject({ code: 'INVALID_ACTOR_TYPE' })
      } finally {
        await closeDb()
      }
    })
  })

  it('pendingBalance sums by currency across positive + negative notes', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = randomUUID()
        await issueNote({ tenantId, type: 'courtesy', amountMinor: 1000, currency: 'USD' })
        await issueNote({ tenantId, type: 'proration_debit', amountMinor: -300, currency: 'USD' })
        await issueNote({ tenantId, type: 'promo', amountMinor: 200, currency: 'LBP' })
        const balance = await pendingBalance(tenantId)
        expect(balance.USD).toBe(700)
        expect(balance.LBP).toBe(200)
      } finally {
        await closeDb()
      }
    })
  })

  it('voidNote: only pending notes can be voided', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = randomUUID()
        const note = await issueNote({ tenantId, type: 'courtesy', amountMinor: 100, currency: 'USD' })
        const voided = await voidNote(note.id, { reason: 'issued in error', actorId: 'admin-1' })
        expect(voided.status).toBe('voided')
        await expect(voidNote(note.id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
      } finally {
        await closeDb()
      }
    })
  })

  it('applyNote: sets status=applied + applied_at + invoice link', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = randomUUID()
        const note = await issueNote({ tenantId, type: 'refund', amountMinor: 500, currency: 'USD' })
        const applied = await applyNote(note.id, { invoiceId: 'inv-123', actorType: 'system' })
        expect(applied.status).toBe('applied')
        expect(applied.applied_to_invoice_id).toBe('inv-123')
        expect(applied.applied_at).not.toBeNull()
      } finally {
        await closeDb()
      }
    })
  })

  it('sweepExpiredNotes: flips only pending + past-expires_at rows', async () => {
    await withTestDb(async (databaseUrl) => {
      configure({ databaseUrl, force: true })
      try {
        const tenantId = randomUUID()
        const stale = await issueNote({ tenantId, type: 'promo', amountMinor: 100, currency: 'USD' })
        await query(
          `UPDATE commercial.billing_credit_notes
              SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
            WHERE id = $1`,
          [stale.id],
        )
        const fresh = await issueNote({ tenantId, type: 'promo', amountMinor: 100, currency: 'USD' })
        await query(
          `UPDATE commercial.billing_credit_notes
              SET expires_at = CURRENT_TIMESTAMP + INTERVAL '30 days'
            WHERE id = $1`,
          [fresh.id],
        )

        const summary = await sweepExpiredNotes()
        expect(summary.expired).toBe(1)

        const notes = await listNotes({ tenantId })
        const expired = notes.filter((n) => n.status === 'expired')
        const pending = notes.filter((n) => n.status === 'pending')
        expect(expired).toHaveLength(1)
        expect(pending).toHaveLength(1)
      } finally {
        await closeDb()
      }
    })
  })
})
